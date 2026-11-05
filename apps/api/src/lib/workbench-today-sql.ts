import { pickAttendanceMode, type AttendanceMode } from './attendance-mode';
import type { Queryable } from './identity-sql';

/**
 * 作業台「今天」的第一波：點名模式＋當天課堂，一支 pg SQL（#1595 P2 ①）。
 *
 * 原本是 2–3 支 PostgREST（`organizations`、單一分校時的 `campuses`、`sessions` 帶
 * `SESSION_SUMMARY_SELECT`）。正式站每支 REST 23–443ms、請求裡的第一支還要付 TLS；
 * 整支請求不碰 REST 才省得掉。
 *
 * **課堂列的形狀跟 `SESSION_SUMMARY_SELECT` 一樣**（巢狀物件、時間欄位格式同 PostgREST），
 * 後面的 `summariseSessions` 一行都不用改。
 *
 * **分校範圍只吃參數**：`$3` 由 handler 用 `campusFilterIds` 算好（null＝不篩、空陣列＝零筆，同 courses），
 * 掛在 `classes.campus_id`，跟原本的 `.in('classes.campus_id', …)` 同一欄。每張表都帶 `org_id = $1`（c1）。
 * 排序照原本 `order('start_time')`，再補 `id` 當末鍵。
 */
export const WORKBENCH_TODAY_SQL = `
select json_build_object(
  'orgMode', (select o.attendance_mode from public.organizations o where o.id = $1),
  'campusMode', (select ca.attendance_mode from public.campuses ca where ca.id = $4 and ca.org_id = $1),
  'sessions', coalesce((
    select json_agg(json_build_object(
      'id', s.id, 'event_id', s.event_id, 'session_date', s.session_date,
      'start_time', s.start_time, 'end_time', s.end_time, 'status', s.status,
      'class_id', s.class_id, 'teacher_id', s.teacher_id,
      'teacher', (select json_build_object('display_name', st.display_name)
                  from public.staff st where st.id = s.teacher_id and st.org_id = $1),
      'schedules', (select json_build_object('teacher_id', sc.teacher_id)
                    from public.schedules sc where sc.id = s.schedule_id and sc.class_id = s.class_id),
      'classes', json_build_object(
        'name', c.name, 'course_id', c.course_id, 'campus_id', c.campus_id,
        'uses_contact_book', c.uses_contact_book,
        'campuses', (select json_build_object('name', cc.name)
                     from public.campuses cc where cc.id = c.campus_id and cc.org_id = $1),
        'courses', (select json_build_object('name', co.name)
                    from public.courses co where co.id = c.course_id and co.org_id = $1)
      ),
      'events', (select json_build_object(
                   'id', e.id, 'event_date', e.event_date, 'start_time', e.start_time,
                   'end_time', e.end_time, 'attendance_taken_at', e.attendance_taken_at,
                   'campus_id', e.campus_id,
                   'campuses', (select json_build_object('name', ec.name)
                                from public.campuses ec where ec.id = e.campus_id and ec.org_id = $1))
                 from public.events e where e.id = s.event_id and e.org_id = $1)
    ) order by s.start_time, s.id)
    from public.sessions s
    join public.classes c on c.id = s.class_id and c.org_id = $1
    where s.org_id = $1
      and s.session_date = $2::date
      and ($3::uuid[] is null or c.campus_id = any($3::uuid[]))
  ), '[]'::json)
) as result`;

export interface WorkbenchTodayBase {
  mode: AttendanceMode;
  /** `SESSION_SUMMARY_SELECT` 形狀的課堂列，直接交給 `summariseSessions` */
  sessions: unknown[];
}

/**
 * 模式判準照舊走 `pickAttendanceMode`（分校設定優先、沒有就機構預設，同 `resolveAttendanceMode`）。
 * 失敗或形狀不對就丟例外（→ 500），不退回 REST（#2230 (c)）。
 */
export async function loadWorkbenchTodayBase(
  db: Queryable,
  p: {
    orgId: string;
    date: string;
    campusIds: readonly string[] | null;
    singleCampus: string | null;
  },
): Promise<WorkbenchTodayBase> {
  const { rows } = await db.query(WORKBENCH_TODAY_SQL, [
    p.orgId,
    p.date,
    p.campusIds ? [...p.campusIds] : null,
    p.singleCampus,
  ]);
  const r = (rows[0] as { result?: Record<string, unknown> } | undefined)?.result;
  if (!r || !Array.isArray(r['sessions'])) throw new Error('[workbench-sql] 結果形狀不對');
  return {
    mode: pickAttendanceMode(
      r['campusMode'] as string | null | undefined,
      r['orgMode'] as string | undefined,
    ),
    sessions: r['sessions'] as unknown[],
  };
}
