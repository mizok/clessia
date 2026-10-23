import type { SupabaseClient } from '@supabase/supabase-js';
import type { Context } from 'hono';

import type { AppEnv } from '../index';
import type { ChangeType } from '../routes/sessions/change-log';
import {
  adminsForCampuses,
  notify,
  teachersForSessionGroups,
  type StaffNotification,
} from './notify';
import { fetchAllPages } from './fetch-all-pages';
import { isEnrolledOn } from './session-roster';
import { waitUntilFrom } from './wait-until';

/**
 * 課務異動 → 任課老師的站內通知（#1693 `schedule_change`）。
 *
 * - 輸入就是寫進 `schedule_changes` 的那幾列（不寫流水的換老師、班級批次復課自己湊同樣的形狀，Q3）
 * - **一批一班一則**：同一批（`batch_id`，單堂沒有就每次請求一顆）依班分組，每班的老師只收自己班的那則
 * - 收件人：該班那幾堂的老師（任課班 ∪ 實際上課 ∪ 代課／換老師的原老師與新老師），**做異動的人自己不收**
 * - **也發給管理員**（#1023，使用者 10-23）：範圍涵蓋該班分校、有 `basic_operations` 的管理員
 *   （同請假通知 leave_received，計畫席裁），種類跟老師同一組。設計見 kb/wiki/architecture/admin-schedule-change-notice.md
 * - **也發給該班家長**（#1100 #49，使用者 10-23）：見 `notifyParents`
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
export const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export interface ScheduleChangeClassGroup {
  readonly name: string;
  /** 班的分校；管理員依它挑（#1023）。班沒有分校時 null */
  readonly campusId: string | null;
  readonly dates: string[];
  readonly sessionIds: string[];
  readonly extraStaffIds: string[];
}

/** 這幾列課堂依班分組（只算本 org 的課堂），帶班名、日期、代課／換老師的兩端 */
export async function groupByClass(
  supabase: SupabaseClient,
  orgId: string,
  rows: readonly Omit<ScheduleChangeNoticeRow, 'change_type' | 'batch_id'>[],
): Promise<Map<string, ScheduleChangeClassGroup>> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, class_id, session_date, classes(name, campus_id)')
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
    classes:
      | { name: string; campus_id: string | null }
      | Array<{ name: string; campus_id: string | null }>
      | null;
  }>) {
    const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
    const g = byClass.get(s.class_id) ?? {
      name: cls?.name ?? '',
      campusId: cls?.campus_id ?? null,
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

    const bodyOf = (g: ScheduleChangeClassGroup) => {
      const first = shortDate([...g.dates].sort()[0]!);
      const count = g.dates.length > 1 ? ` 等 ${g.dates.length} 堂` : '';
      return `${g.name} ${first}${count || ' '}${label}`;
    };

    const recipients = await teachersForSessionGroups(supabase, input.orgId, byClass, {
      excludeUserId: input.actorUserId,
    });
    await notify(
      supabase,
      [...byClass].flatMap(([classId, g]) =>
        (recipients.get(classId) ?? []).map((userId) => ({
          orgId: input.orgId,
          userId,
          role: 'teacher' as const,
          kind: 'schedule_change' as const,
          dedupeKey: `schedule_change:${eventKey}:${classId}`,
          title: `課務異動：${label}`,
          body: bodyOf(g),
          url: '/teacher/schedule',
        })),
      ),
    );

    // 管理員那批排在老師之後：這裡失敗由外層 catch 記 log，老師那批已經寫進去了
    // 一間分校查一次（整門課停課會跨很多班，每班查一次是 N 倍的查詢）
    const adminsByCampus = new Map<string, string[]>();
    for (const campusId of new Set([...byClass.values()].flatMap((g) => g.campusId ?? []))) {
      adminsByCampus.set(
        campusId,
        await adminsForCampuses(supabase, input.orgId, [campusId], {
          permission: 'basic_operations',
          excludeUserId: input.actorUserId,
        }),
      );
    }
    const rowsForAdmins: StaffNotification[] = [];
    for (const [classId, g] of byClass) {
      for (const userId of g.campusId ? (adminsByCampus.get(g.campusId) ?? []) : []) {
        rowsForAdmins.push({
          orgId: input.orgId,
          userId,
          role: 'admin' as const,
          kind: 'schedule_change' as const,
          // ⚠️ 要跟老師那則不同：UNIQUE(user_id, dedupe_key)，同時是老師和管理員的人會被吃掉一則
          dedupeKey: `schedule_change:admin:${eventKey}:${classId}`,
          title: `課務異動：${label}`,
          body: bodyOf(g),
          url: '/admin/changes',
        });
      }
    }
    await notify(supabase, rowsForAdmins);

    await notifyParents(supabase, input.orgId, input.actorUserId, eventKey, label, byClass);
  } catch (err) {
    console.error(
      '[notify] 課務異動通知失敗（異動已寫入）:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * 課務異動 → 該班家長（#1100 #49，使用者 10-23 選「存檔時自動發」，計畫席批准的設計見 #1100）。
 *
 * - 收件人＝那幾堂**當天在籍**的學生（`isEnrolledOn`，作廢的報名不算）的家長：本 org、`status = 'active'`
 * - **一批一班一位家長一則**；同一位家長兩個孩子在同班 → 一則、兩個名字都列（計畫席 10-23）
 * - 去重鍵跟老師、管理員分開（`schedule_change:parent:…`），同一人兼兩種身分不會被吃掉
 * - **v1 不推播**（計畫席 10-23）：寫成 `skipped`，排程不會撿；通知中心照樣看得到
 * - `payload.sessionIds`：展開「原本／改為」時用（即時從 `schedule_changes` 算，那支另做）
 * - 用**班級 id** 查在籍（URL 只有幾個班），不帶學生 id —— 整門課停課的學生可能上百位（`.in()` 414 坑）。
 *   這裡在 `waitUntil` 背景跑，請求的 pg pool 已經關了，不能改走 pool；用 `fetchAllPages` 翻到底
 */
async function notifyParents(
  supabase: SupabaseClient,
  orgId: string,
  actorUserId: string,
  eventKey: string,
  label: string,
  byClass: ReadonlyMap<string, ScheduleChangeClassGroup>,
): Promise<void> {
  const dates = [...byClass.values()].flatMap((g) => g.dates).sort();
  if (dates.length === 0) return;
  // 翻到底：一批（整門課停課）超過 PostgREST max_rows 1000 筆在籍時，一次撈會靜默截掉後面的家長（計畫席 10-23）
  const { rows: data, error } = await fetchAllPages((from, to) =>
    supabase
      .from('enrollments')
      .select(
        'id, class_id, effective_from, effective_to, students(name, parent_student_relations(parents(user_id, org_id, status)))',
      )
      .eq('org_id', orgId)
      .in('class_id', [...byClass.keys()])
      .neq('status', 'void')
      .lte('effective_from', dates.at(-1)!)
      .or(`effective_to.is.null,effective_to.gte.${dates[0]}`)
      .order('id')
      .range(from, to),
  );
  if (error) throw new Error((error as { message?: string }).message ?? String(error));

  type Parent = { user_id: string | null; org_id: string; status: string };
  type Row = {
    class_id: string;
    effective_from: string;
    effective_to: string | null;
    students: { name: string; parent_student_relations: { parents: Parent | null }[] } | null;
  };
  const rows: Record<string, unknown>[] = [];
  for (const [classId, g] of byClass) {
    // 家長 user_id → 這一班裡他的孩子（同一位孩子多筆報名只算一次）
    const children = new Map<string, Set<string>>();
    for (const e of data as unknown as Row[]) {
      if (e.class_id !== classId || !e.students) continue;
      const range = { effectiveFrom: e.effective_from, effectiveTo: e.effective_to };
      if (!g.dates.some((d) => isEnrolledOn(range, d))) continue;
      for (const { parents: p } of e.students.parent_student_relations ?? []) {
        if (!p?.user_id || p.org_id !== orgId || p.status !== 'active') continue;
        if (p.user_id === actorUserId) continue;
        children.set(p.user_id, (children.get(p.user_id) ?? new Set()).add(e.students.name));
      }
    }
    const first = shortDate([...g.dates].sort()[0]!);
    const count = g.dates.length > 1 ? ` 等 ${g.dates.length} 堂` : '';
    for (const [userId, names] of children) {
      rows.push({
        org_id: orgId,
        user_id: userId,
        role: 'parent',
        kind: 'schedule_change',
        dedupe_key: `schedule_change:parent:${eventKey}:${classId}`,
        payload: {
          title: `課務異動：${label}`,
          body: `${[...names].sort().join('、')} ${g.name} ${first}${count} ${label}`,
          url: '/parent/schedule',
          sessionIds: g.sessionIds,
        },
        push_status: 'skipped',
        push_error: 'KIND_PUSH_DISABLED',
      });
    }
  }
  if (rows.length === 0) return;
  const { error: writeError } = await supabase
    .from('notifications')
    .upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
  if (writeError) throw new Error(writeError.message);
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
