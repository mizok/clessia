import { pickAttendanceMode, type AttendanceMode } from './attendance-mode';
import type { Queryable } from './identity-sql';

/**
 * 學生名冊「今日到班」的前置：點名模式＋當天課堂，一支 pg（#1595 P2 ② 刀 2）。
 *
 * 原本是 2–3 支 REST（`organizations`、單一分校時的 `campuses`、`sessions` 帶 `TODAY_SESSION_SELECT`），
 * 跟作業台的第一波（`lib/workbench-today-sql.ts`，#2303）同一個模式，但課堂形狀不同、多一個任課班條件，所以另一支。
 *
 * - **課堂列的形狀跟 `TODAY_SESSION_SELECT` 一樣**，`toTodaySession` 照用；陣列不排序，同 PostgREST
 * - **範圍只吃參數**：`$3` 分校（`campusFilterIds`，null 不篩、`[]` 零筆）掛 `classes.campus_id`，
 *   `$4` 老師任課班（null＝管理員不篩、`[]` 零筆）掛 `sessions.class_id` —— 同原本的兩個 `.in()`
 * - 模式判準照舊 `pickAttendanceMode`（分校設定優先、沒有就機構預設，同 `resolveAttendanceMode`）
 * - 失敗或形狀不對丟例外 → 500，不退回 REST（#2230 (c)）。原本讀模式失敗會被當成逐堂點名（吞錯），這裡不再吞
 */
export const STUDENT_TODAY_SQL = `
select json_build_object(
  'orgMode', (select o.attendance_mode from public.organizations o where o.id = $1::uuid),
  'campusMode', (select ca.attendance_mode from public.campuses ca where ca.id = $5::uuid and ca.org_id = $1::uuid),
  'sessions', coalesce((
    select json_agg(json_build_object(
      'class_id', s.class_id, 'start_time', s.start_time, 'status', s.status,
      'events', (select json_build_object(
                   'start_time', e.start_time, 'campus_id', e.campus_id,
                   'campuses', (select json_build_object('name', ec.name) from public.campuses ec where ec.id = e.campus_id))
                 from public.events e where e.id = s.event_id),
      'classes', json_build_object(
        'name', c.name, 'campus_id', c.campus_id,
        'campuses', (select json_build_object('name', cc.name) from public.campuses cc where cc.id = c.campus_id)
      )
    ))
    from public.sessions s
    join public.classes c on c.id = s.class_id
    where s.org_id = $1::uuid
      and s.session_date = $2::date
      and ($3::uuid[] is null or c.campus_id = any($3::uuid[]))
      and ($4::uuid[] is null or s.class_id = any($4::uuid[]))
  ), '[]'::json)
) as result`;

export interface StudentTodayBase {
  readonly mode: AttendanceMode;
  /** `TODAY_SESSION_SELECT` 形狀的課堂列，交給 `toTodaySession` */
  readonly sessions: Record<string, unknown>[];
}

export async function loadStudentTodayBase(
  db: Queryable,
  p: {
    orgId: string;
    date: string;
    campusIds: readonly string[] | null;
    classIds: readonly string[] | null;
    singleCampus: string | null;
  },
): Promise<StudentTodayBase> {
  try {
    const { rows } = await db.query(STUDENT_TODAY_SQL, [
      p.orgId,
      p.date,
      p.campusIds,
      p.classIds,
      p.singleCampus,
    ]);
    const r = (rows[0] as { result?: Record<string, unknown> } | undefined)?.result;
    if (rows.length !== 1 || !r || !Array.isArray(r['sessions']))
      throw new Error('[students-sql] 今日到班結果形狀不對');
    return {
      mode: pickAttendanceMode(
        r['campusMode'] as string | null | undefined,
        r['orgMode'] as string | null | undefined,
      ),
      sessions: r['sessions'] as Record<string, unknown>[],
    };
  } catch (err) {
    console.error(
      `[students-sql] 今日到班查詢失敗：${(err as { code?: string })?.code ?? 'unknown'}`,
    );
    throw err;
  }
}
