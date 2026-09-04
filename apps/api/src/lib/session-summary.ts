import type { SupabaseClient } from '@supabase/supabase-js';

import { countEnrolledOn, tallyAttendance, type EnrollmentRange } from './session-roster';
import { countExamsBySession, sessionExamKey } from './session-exams';
import { isSubstituteSession } from './session-substitute';

/**
 * 課堂摘要的**唯一定義** —— select 字串與 row→摘要的映射都在這裡。
 *
 * 有兩個消費者：`/api/attendance/sessions`（分頁列表）與 `/api/workbench/today`
 * （作業台聚合）。**查詢條件可以不一樣，形狀不行** —— 兩邊各長一份的話，
 * 加欄位時會有一邊被忘記，而那一邊不會報錯、只會少一個欄位。
 * 這正是作業台需求單第二個理由要防的事（「兩套取數會各長一份，然後其中一份會忘記更新」）。
 */
/**
 * 需要**只留下有出勤事件的課堂**時用這一份（`events!event_id!inner`）。
 *
 * ⚠️ **對 embed 的欄位下條件，在 left join 上不會篩掉父列。** 本機 PostgREST 實測：
 *
 * | 查詢 | 回傳筆數 |
 * | --- | --- |
 * | 全部課堂 | 19 |
 * | `events!event_id(...)` + `events.attendance_taken_at=is.null` | **19（沒篩到）** |
 * | `events!event_id!inner(...)` + 同一個條件 | **18** |
 *
 * 也就是說少了 `!inner`，「未點名」的篩選會靜靜地什麼都不做 —— 而回傳的筆數
 * 看起來很正常。所以「有沒有點名」這條篩選必須配 inner join。
 *
 * **沒有 event 的課堂（停課）因此被排除，那是對的**：
 * `ensureAttendanceSessionEvents` 會在查詢前替 scheduled / completed 補建 event，
 * 只有停課的刻意不補（#123）—— 而停課本來就不算「忘了點名」。
 */
export function sessionSummarySelect(options: { requireEvent?: boolean } = {}): string {
  return options.requireEvent
    ? SESSION_SUMMARY_SELECT.replace('events!event_id(', 'events!event_id!inner(')
    : SESSION_SUMMARY_SELECT;
}

export const SESSION_SUMMARY_SELECT = `
        id,
        event_id,
        session_date,
        start_time,
        end_time,
        status,
        class_id,
        teacher_id,
        teacher:staff!teacher_id(display_name),
        schedules!schedule_id(teacher_id),
        classes!inner(name, course_id, campus_id, campuses(name), courses(name)),
        events!event_id(
          id,
          event_date,
          start_time,
          end_time,
          attendance_taken_at,
          campus_id,
          campuses(name)
        )
`;

export interface SessionSummary {
  sessionId: string;
  eventId: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  examCount: number;
  isSubstitute: boolean;
  classId: string;
  className: string;
  courseName: string | null;
  teacherName: string | null;
  campusId: string | null;
  campusName: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  enrolledCount: number;
  presentCount: number;
  onLeaveCount: number;
  absentCount: number;
  takenAt: string | null;
}

/**
 * 把 `SESSION_SUMMARY_SELECT` 撈回來的列，補上出勤統計、在籍人數與考試數。
 *
 * **三支批次查詢，不隨課堂數成長**（原本是每堂各兩支，見 #111）。
 */
export async function summariseSessions(
  supabase: SupabaseClient,
  orgId: string,
  sessions: unknown[] | null,
): Promise<SessionSummary[]> {
  const sessionRows = (sessions ?? []) as any[];

  // ── 兩支批次查詢取代每堂各兩支 ─────────────────────────────
  //
  // 原本是 `sessions.map(async ...)` 裡各發一支 attendance_records 與一支
  // enrollments count —— 100 堂課就是 200 次往返，而儀表板一次要兩份列表。
  // 空 DB 感覺不到，有資料之後它隨課堂數線性成長。
  const eventIds = Array.from(
    new Set(
      sessionRows
        .map((session) => {
          const eventRow = Array.isArray(session.events) ? session.events[0] : session.events;
          return session.event_id ?? eventRow?.id ?? null;
        })
        .filter((id: string | null): id is string => Boolean(id)),
    ),
  );
  const rosterClassIds = Array.from(
    new Set(
      sessionRows
        .map((session) => session.class_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  // 考試掛在 (班級, 日期) 上，不是掛在 session 上 —— 所以用這一頁實際出現的班級與
  // 日期區間去撈，跟出勤/在籍一樣是一支批次查詢，不隨課堂數成長。
  const sessionDates = sessionRows
    .map((session) => session.session_date as string | null)
    .filter((date): date is string => Boolean(date))
    .sort();

  const [{ data: attendanceRows }, { data: enrollmentRows }, { data: examRows }] =
    await Promise.all([
      eventIds.length > 0
        ? supabase
            .from('attendance_records')
            .select('event_id, status')
            .eq('org_id', orgId)
            .in('event_id', eventIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      rosterClassIds.length > 0
        ? supabase
            .from('enrollments')
            .select('class_id, effective_from, effective_to')
            .eq('org_id', orgId)
            .eq('status', 'active')
            .in('class_id', rosterClassIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      rosterClassIds.length > 0 && sessionDates.length > 0
        ? supabase
            .from('academy_exam_classes')
            .select('class_id, academy_exams!inner(exam_date, org_id)')
            .eq('academy_exams.org_id', orgId)
            .in('class_id', rosterClassIds)
            .gte('academy_exams.exam_date', sessionDates[0])
            .lte('academy_exams.exam_date', sessionDates[sessionDates.length - 1])
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);

  const examCounts = countExamsBySession(
    ((examRows ?? []) as Array<Record<string, unknown>>).map((row) => {
      const exam = Array.isArray(row['academy_exams'])
        ? row['academy_exams'][0]
        : (row['academy_exams'] as { exam_date?: string } | null);
      return {
        class_id: (row['class_id'] as string) ?? '',
        exam_date: exam?.exam_date ?? '',
      };
    }),
  );

  const tally = tallyAttendance(
    ((attendanceRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      eventId: row['event_id'] as string,
      status: row['status'] as string,
    })),
  );
  const enrollmentRanges: EnrollmentRange[] = (
    (enrollmentRows ?? []) as Array<Record<string, unknown>>
  ).map((row) => ({
    classId: row['class_id'] as string,
    effectiveFrom: row['effective_from'] as string,
    effectiveTo: (row['effective_to'] as string | null) ?? null,
  }));

  const results = sessionRows.map((session: any) => {
    const classRow = session.classes;
    const courseRow = Array.isArray(classRow?.courses) ? classRow.courses[0] : classRow?.courses;
    const classCampusRow = Array.isArray(classRow?.campuses)
      ? classRow.campuses[0]
      : classRow?.campuses;
    const eventRow = Array.isArray(session.events) ? session.events[0] : session.events;
    const classId = session.class_id ?? null;
    const eventId = session.event_id ?? eventRow?.id ?? null;
    const sessionDate = eventRow?.event_date ?? session.session_date ?? null;

    // 沒有出勤記錄的課堂不會出現在 tally 裡 —— 那是「還沒點名」，不是「全缺席」
    const counts = (eventId ? tally.get(eventId) : undefined) ?? {
      presentCount: 0,
      onLeaveCount: 0,
      absentCount: 0,
    };

    const scheduleRow = Array.isArray(session.schedules) ? session.schedules[0] : session.schedules;
    const teacherRow = Array.isArray(session.teacher) ? session.teacher[0] : session.teacher;

    return {
      sessionId: session.id as string,
      // 停課的課堂沒有出勤事件（ensure 刻意跳過）—— 這裡誠實回 null，
      // 讓前端關掉點名入口，而不是給一個空字串讓它以為點得下去
      eventId: eventId ?? null,
      status: (session.status ?? 'scheduled') as 'scheduled' | 'completed' | 'cancelled',
      examCount:
        examCounts.get(sessionExamKey(classId ?? '', (session.session_date as string) ?? '')) ?? 0,
      isSubstitute: isSubstituteSession({
        sessionTeacherId: (session.teacher_id as string | null) ?? null,
        scheduleTeacherId: (scheduleRow?.teacher_id as string | null) ?? null,
      }),
      classId: classId ?? '',
      className: classRow?.name ?? '',
      courseName: courseRow?.name ?? null,
      // 實際上這堂課的老師（代課時就是代課老師）—— 原本寫死 null
      teacherName: (teacherRow?.display_name as string | null) ?? null,
      campusId: eventRow?.campus_id ?? classRow?.campus_id ?? null,
      campusName: eventRow?.campuses?.name ?? classCampusRow?.name ?? null,
      eventDate: sessionDate ?? '',
      startTime: (eventRow?.start_time ?? session.start_time)?.slice(0, 5) ?? null,
      endTime: (eventRow?.end_time ?? session.end_time)?.slice(0, 5) ?? null,
      enrolledCount: classId ? countEnrolledOn(enrollmentRanges, classId, sessionDate) : 0,
      presentCount: counts.presentCount,
      onLeaveCount: counts.onLeaveCount,
      absentCount: counts.absentCount,
      takenAt: eventRow?.attendance_taken_at ?? null,
    };
  });

  return results;
}
