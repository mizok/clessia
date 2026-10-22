import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAttendanceModes, type AttendanceMode } from './attendance-mode';
import { isEnrolledOn } from './session-roster';

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
 */
export async function annotateArrivals<T extends ArrivalSession>(
  supabase: SupabaseClient,
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
  const { data: enrollmentRows, error: enrollmentError } = await supabase
    .from('enrollments')
    .select('student_id, class_id, effective_from, effective_to')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .in('class_id', classIds);
  if (enrollmentError) return { data: null, error: { message: enrollmentError.message } };

  const enrollments = (enrollmentRows ?? []) as Array<{
    student_id: string;
    class_id: string;
    effective_from: string;
    effective_to: string | null;
  }>;
  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
  const { data: checkinRows, error: checkinError } =
    studentIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('daily_checkins')
          .select('student_id, checkin_date, campus_id')
          .eq('org_id', orgId)
          .in('student_id', studentIds)
          .gte('checkin_date', dates[0])
          .lte('checkin_date', dates[dates.length - 1]);
  if (checkinError) return { data: null, error: { message: checkinError.message } };

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
