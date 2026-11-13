import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAttendanceModes, type AttendanceMode } from './attendance-mode';
import type { Queryable } from './identity-sql';
import { ENROLLED_STATUS_SQL, isEnrolledOn } from './session-roster';

/**
 * 一筆到班打卡算不算到「這一堂」：打卡沒帶分校、或帶的就是這堂課的分校。
 *
 * 跟寫入那側（`writeDailyCheckin`）同一條：指名分校的打卡只替那個分校的課堂寫出勤，
 * 沒指名的寫當天全部。讀這側不照它走的話，A 校的卡會在 B 校老師的名單上變成「到了」，
 * 而 B 校那堂並沒有被寫成出席。
 */
export function checkinCoversSession(
  checkinCampusId: string | null,
  sessionCampusId: string | null,
): boolean {
  return checkinCampusId === null || checkinCampusId === sessionCampusId;
}

interface ArrivalSession {
  classId: string;
  campusId: string | null;
  eventDate: string;
}

/**
 * 課堂列表每一列補上出勤模式與日到班的到班數（#1314 TS3）。
 *
 * **到班數讀 `daily_checkins`，不拿 `presentCount` 代**：掃碼只替「打卡當下已存在的 event」
 * 寫出勤，而 event 是列表時才補建 —— 兩個數字會分岔，而到班名單讀的是打卡紀錄。
 * 卡片與名單要同一個來源。
 *
 * 只對日到班的列多查（兩支批次，不隨課堂數成長）；全是隨堂的頁面只多一輪模式查詢。
 *
 * 報名與打卡走 pg（#2230 ③，同 #2226 的乙′）：原本兩支 PostgREST `.in()`（班 id、學生 id），
 * 一頁課堂多（`endedOnly` 一頁最多 1000 堂）就 414，而且都沒分頁、被 max_rows 1000 截斷，到班數靜默少算。
 * SQL 只回原料，「誰算到班」仍由下面的 JS 判定一份。`classIds` 來自呼叫端已授權的課堂，`org_id` 只當防呆。
 */
export async function annotateArrivals<T extends ArrivalSession>(
  supabase: SupabaseClient,
  db: Queryable,
  orgId: string,
  sessions: readonly T[],
): Promise<
  | {
      data: Array<T & { attendanceMode: AttendanceMode; checkedInCount: number | null }>;
      error: null;
    }
  | { data: null; error: { message: string } }
> {
  const campusIds = [
    ...new Set(sessions.map((s) => s.campusId).filter((id): id is string => !!id)),
  ];
  const modes = await resolveAttendanceModes(supabase, orgId, campusIds);
  if (modes.error) return { data: null, error: modes.error };

  const withMode = sessions.map((s) => ({ ...s, attendanceMode: modes.modeOf(s.campusId) }));
  const daily = withMode.filter((s) => s.attendanceMode === 'daily_checkin');
  if (daily.length === 0) {
    return { data: withMode.map((s) => ({ ...s, checkedInCount: null })), error: null };
  }

  const classIds = [...new Set(daily.map((s) => s.classId))];
  const dates = daily.map((s) => s.eventDate).sort();
  let enrollments: Array<{
    student_id: string;
    class_id: string;
    effective_from: string;
    effective_to: string | null;
  }>;
  let checkinRows: unknown[];
  try {
    const params = [orgId, classIds, dates[0], dates[dates.length - 1]];
    const [enrollmentResult, checkinResult] = await Promise.all([
      db.query(
        `select e.student_id, e.class_id,
                e.effective_from::text as effective_from, e.effective_to::text as effective_to
           from public.enrollments e
          where e.org_id = $1::uuid and ${ENROLLED_STATUS_SQL} and e.class_id = any($2::uuid[])`,
        params.slice(0, 2),
      ),
      // 打卡只撈「這些班報名過的學生」—— 子查詢只是縮小撈的量，不等上一支回來再帶學生 id。
      // **不帶狀態條件**：算不算到班由上一支的報名（ENROLLED_STATUS_SQL＋isEnrolledOn）決定，
      // 這裡多撈幾筆作廢生的打卡也不會被算進去；在這裡再複製一份規則只會多一處要對齊（#953）
      db.query(
        `select d.student_id, d.checkin_date::text as checkin_date, d.campus_id
           from public.daily_checkins d
          where d.org_id = $1::uuid
            and d.checkin_date between $3::date and $4::date
            and d.student_id in (
              select e.student_id from public.enrollments e
               where e.org_id = $1::uuid and e.class_id = any($2::uuid[]))`,
        params,
      ),
    ]);
    enrollments = enrollmentResult.rows as typeof enrollments;
    checkinRows = checkinResult.rows;
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
  }

  const checkins = (checkinRows ?? []) as Array<{
    student_id: string;
    checkin_date: string;
    campus_id: string | null;
  }>;
  const checkinKey = (studentId: string, date: string) => `${studentId}|${date}`;
  const checkinCampus = new Map(
    checkins.map((row) => [checkinKey(row.student_id, row.checkin_date), row.campus_id]),
  );

  return {
    data: withMode.map((s) => {
      if (s.attendanceMode !== 'daily_checkin') return { ...s, checkedInCount: null };
      const arrived = enrollments.filter((e) => {
        if (e.class_id !== s.classId) return false;
        if (
          !isEnrolledOn(
            { effectiveFrom: e.effective_from, effectiveTo: e.effective_to },
            s.eventDate,
          )
        )
          return false;
        const key = checkinKey(e.student_id, s.eventDate);
        return (
          checkinCampus.has(key) && checkinCoversSession(checkinCampus.get(key) ?? null, s.campusId)
        );
      });
      // 同一個學生在同一班有兩筆在籍報名時只算一次
      return { ...s, checkedInCount: new Set(arrived.map((e) => e.student_id)).size };
    }),
    error: null,
  };
}
