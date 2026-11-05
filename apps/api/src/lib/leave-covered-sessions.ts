import { isCancelledSession } from './cancelled-session';
import { leaveCoversSession, type LeaveWindow } from './leave-covers-session';
import { isEnrolledOn } from './session-roster';

/**
 * 請假列表每張假「蓋到哪幾堂」（#1314 LV2，使用者 11-05 裁定：只填日期區間的假也列）。
 *
 * **SQL 只粗篩候選，判準不在 SQL 重寫**（同 #2286）：綁定型撈綁的堂；沒綁定的撈「學生 active 報名的班、
 * 假的日期區間內」的堂，連同那筆報名的生效區間。蓋不蓋得到（時間窗、綁定）、在不在籍、停課，
 * 一律由 `coveredSessionsOf` 交給 `leaveCoversSession`／`isEnrolledOn`／`isCancelledSession` 判 ——
 * 跟點名面板、`planLeaveAttendance` 同一組。
 *
 * **一支 pg SQL，不把 id 清單放進 URL**（#1928）：`$2` 是這一頁的假單 id（≤ pageSize 100），走參數不走網址。
 * `$3` 是授權的分校範圍（c1）：受限的管理員只看得到範圍內分校的堂；`null`＝不受限。
 * 時間用 `HH24:MI:SS`：跟 `toLeaveWindow` 讀到的假單時間同格式，字串比大小才對（`'12:00' < '12:00:00'`）。
 */
export const LEAVE_COVERED_SESSIONS_SQL = `
with page as (
  select lr.id, lr.student_id, lr.start_date, lr.end_date
  from public.leave_requests lr
  where lr.org_id = $1 and lr.id = any($2::uuid[])
), cand as (
  select p.id as leave_id, b.session_id, true as bound, null::date as eff_from, null::date as eff_to
  from page p
  join public.leave_request_sessions b on b.leave_request_id = p.id and b.org_id = $1
  union all
  select p.id, s.id, false, e.effective_from, e.effective_to
  from page p
  join public.enrollments e on e.org_id = $1 and e.student_id = p.student_id and e.status = 'active'
  join public.sessions s on s.org_id = $1 and s.class_id = e.class_id
    and s.session_date between p.start_date and p.end_date
  where not exists (select 1 from public.leave_request_sessions b where b.leave_request_id = p.id)
)
select c.leave_id, c.bound, s.id as session_id, s.status,
  to_char(s.session_date, 'YYYY-MM-DD') as session_date,
  to_char(s.start_time, 'HH24:MI:SS') as start_time,
  to_char(s.end_time, 'HH24:MI:SS') as end_time,
  cl.name as class_name,
  to_char(c.eff_from, 'YYYY-MM-DD') as effective_from,
  to_char(c.eff_to, 'YYYY-MM-DD') as effective_to
from cand c
join public.sessions s on s.id = c.session_id and s.org_id = $1
join public.classes cl on cl.id = s.class_id and cl.org_id = $1
where $3::uuid[] is null or cl.campus_id = any($3::uuid[])
order by s.session_date, s.start_time, s.id`;

export interface CoveredSessionCandidate {
  leave_id: string;
  bound: boolean;
  session_id: string;
  status: string;
  session_date: string;
  start_time: string;
  end_time: string;
  class_name: string;
  effective_from: string | null;
  effective_to: string | null;
}

export interface CoveredSession {
  id: string;
  date: string;
  /** HH:MM */
  startTime: string;
  endTime: string;
  className: string;
}

/** 一張假的候選堂 → 真的蓋到的堂（依 SQL 的日期時間順序，同一堂只列一次） */
export function coveredSessionsOf(
  window: LeaveWindow,
  candidates: readonly CoveredSessionCandidate[],
): CoveredSession[] {
  const out = new Map<string, CoveredSession>();
  for (const row of candidates) {
    if (out.has(row.session_id) || isCancelledSession(row)) continue;
    if (
      !row.bound &&
      !isEnrolledOn(
        { effectiveFrom: row.effective_from ?? '', effectiveTo: row.effective_to },
        row.session_date,
      )
    )
      continue;
    const covers = leaveCoversSession(window, {
      sessionId: row.session_id,
      date: row.session_date,
      startTime: row.start_time,
      endTime: row.end_time,
    });
    if (!covers) continue;
    out.set(row.session_id, {
      id: row.session_id,
      date: row.session_date,
      startTime: row.start_time.slice(0, 5),
      endTime: row.end_time.slice(0, 5),
      className: row.class_name,
    });
  }
  return [...out.values()];
}
