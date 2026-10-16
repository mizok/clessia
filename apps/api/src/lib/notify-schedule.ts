import type { SupabaseClient } from '@supabase/supabase-js';
import type { Context } from 'hono';

import type { AppEnv } from '../index';
import type { ChangeType } from '../routes/sessions/change-log';
import { notify, teachersForSessionGroups } from './notify';
import { waitUntilFrom } from './wait-until';

/**
 * 課務異動 → 任課老師的站內通知（#1693 `schedule_change`）。
 *
 * - 輸入就是寫進 `schedule_changes` 的那幾列（不寫流水的換老師、班級批次復課自己湊同樣的形狀，Q3）
 * - **一批一班一則**：同一批（`batch_id`，單堂沒有就每次請求一顆）依班分組，每班的老師只收自己班的那則
 * - 收件人：該班那幾堂的老師（任課班 ∪ 實際上課 ∪ 代課／換老師的原老師與新老師），**做異動的人自己不收**
 * - 不丟例外：業務寫入已經成功了，失敗只記 `[notify]` log
 */

export type ScheduleNoticeKind = ChangeType | 'assign_teacher';

export interface ScheduleChangeNoticeRow {
  readonly session_id: string;
  readonly change_type: ScheduleNoticeKind;
  readonly batch_id?: string | null;
  /** 代課／換老師：原本上這堂的人 */
  readonly original_teacher_id?: string | null;
  /** 代課／換老師：接手的人 */
  readonly substitute_teacher_id?: string | null;
}

const LABEL: Record<ScheduleNoticeKind, string> = {
  reschedule: '調課',
  substitute: '代課',
  cancellation: '停課',
  uncancel: '復課',
  time_change: '改時間',
  makeup: '補課',
  creation: '加開課堂',
  assign_teacher: '換老師',
};

/** `2026-10-20` → `10/20` */
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export interface ScheduleChangeClassGroup {
  readonly name: string;
  readonly dates: string[];
  readonly sessionIds: string[];
  readonly extraStaffIds: string[];
}

/** 這幾列課堂依班分組（只算本 org 的課堂），帶班名、日期、代課／換老師的兩端 */
export async function groupByClass(
  supabase: SupabaseClient,
  orgId: string,
  rows: readonly ScheduleChangeNoticeRow[],
): Promise<Map<string, ScheduleChangeClassGroup>> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, class_id, session_date, classes(name)')
    .eq('org_id', orgId)
    .in(
      'id',
      rows.map((r) => r.session_id),
    );
  if (error) throw new Error(error.message);

  const byClass = new Map<string, ScheduleChangeClassGroup>();
  const rowBySession = new Map(rows.map((r) => [r.session_id, r]));
  for (const s of (data ?? []) as Array<{
    id: string;
    class_id: string;
    session_date: string;
    classes: { name: string } | Array<{ name: string }> | null;
  }>) {
    const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
    const g = byClass.get(s.class_id) ?? {
      name: cls?.name ?? '',
      dates: [],
      sessionIds: [],
      extraStaffIds: [],
    };
    g.dates.push(s.session_date);
    g.sessionIds.push(s.id);
    const r = rowBySession.get(s.id);
    for (const t of [r?.original_teacher_id, r?.substitute_teacher_id]) {
      if (t) g.extraStaffIds.push(t);
    }
    byClass.set(s.class_id, g);
  }
  return byClass;
}

export async function notifyScheduleChange(
  supabase: SupabaseClient,
  input: {
    readonly orgId: string;
    readonly actorUserId: string;
    readonly rows: readonly ScheduleChangeNoticeRow[];
  },
): Promise<void> {
  try {
    const { rows } = input;
    if (rows.length === 0) return;
    const eventKey = rows[0]!.batch_id ?? crypto.randomUUID();
    const label = LABEL[rows[0]!.change_type];

    const byClass = await groupByClass(supabase, input.orgId, rows);
    if (byClass.size === 0) return;

    const recipients = await teachersForSessionGroups(supabase, input.orgId, byClass, {
      excludeUserId: input.actorUserId,
    });
    await notify(
      supabase,
      [...byClass].flatMap(([classId, g]) => {
        const first = shortDate([...g.dates].sort()[0]!);
        const count = g.dates.length > 1 ? ` 等 ${g.dates.length} 堂` : '';
        return (recipients.get(classId) ?? []).map((userId) => ({
          orgId: input.orgId,
          userId,
          role: 'teacher' as const,
          kind: 'schedule_change' as const,
          dedupeKey: `schedule_change:${eventKey}:${classId}`,
          title: `課務異動：${label}`,
          body: `${g.name} ${first}${count || ' '}${label}`,
          url: '/teacher/schedule',
        }));
      }),
    );
  } catch (err) {
    console.error(
      '[notify] 課務異動通知失敗（異動已寫入）:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * 路由用：背景跑（`waitUntil`），沒有 ExecutionContext（測試）時才等它跑完。
 * 一律在業務寫入（含 `schedule_changes`）成功之後呼叫。
 */
export function queueScheduleChangeNotice(
  c: Context<AppEnv>,
  rows: readonly ScheduleChangeNoticeRow[],
): Promise<void> {
  const job = notifyScheduleChange(c.get('supabase'), {
    orgId: c.get('orgId'),
    actorUserId: c.get('userId'),
    rows,
  });
  const wu = waitUntilFrom(c);
  if (!wu) return job;
  wu(job);
  return Promise.resolve();
}
