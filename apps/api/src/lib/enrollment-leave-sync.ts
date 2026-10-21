import type { SupabaseClient } from '@supabase/supabase-js';

import { isCancelledSession, toSessionRows, type CancellableSession } from './cancelled-session';

/**
 * 報名轉成在籍時，把既有的整天假回補成 `on_leave`（從 `routes/enrollments.ts` 搬來，#1778）。
 * 轉在籍有兩條路 —— 報名建立／編輯／手動改狀態（`routes/enrollments.ts`）與第一筆收款
 * （`routes/invoices.ts`，`lib/record-payment.ts`）—— 兩條的副作用要一樣，所以放 lib 共用。
 */

interface EnrollmentLeaveRequestRow {
  start_date: string;
  end_date: string;
  /** 綁定堂次（#1114）。有綁定的假不回補 —— 它綁的是具體那幾堂，新報名班的堂不在意圖內 */
  leave_request_sessions?: ReadonlyArray<{ session_id: string }> | null;
}

interface EnrollmentEventRow {
  id: string;
  event_date: string;
  /** 停課的課堂不回補 `on_leave`（#568）—— 規則與退化方向見 `lib/cancelled-session.ts` */
  sessions?: CancellableSession | CancellableSession[] | null;
}

/**
 * 報名建立／編輯時，把既有假單回補成 `on_leave`。
 *
 * **停課的課堂不回補**（#568）：這是「停課只改一個欄位」那族的第三個寫入點 ——
 * 觸發路徑跟 `routes/leaves.ts` 不同（那邊是建立請假，這邊是建立報名），
 * 但寫出來的是同一種語意矛盾的紀錄。規則與「沒帶 status 就照舊寫」的理由
 * 都在 `lib/cancelled-session.ts`。
 */
export function buildEnrollmentLeaveAttendanceUpserts(input: {
  orgId: string;
  studentId: string;
  recordedBy: string | null;
  events: ReadonlyArray<EnrollmentEventRow>;
  leaves: ReadonlyArray<EnrollmentLeaveRequestRow>;
}) {
  return input.events
    .filter(
      (eventRow) =>
        !toSessionRows(eventRow.sessions).some(isCancelledSession) &&
        input.leaves.some(
          (leaveRow) =>
            (leaveRow.leave_request_sessions ?? []).length === 0 &&
            leaveRow.start_date <= eventRow.event_date &&
            leaveRow.end_date >= eventRow.event_date,
        ),
    )
    .map((eventRow) => ({
      org_id: input.orgId,
      student_id: input.studentId,
      event_id: eventRow.id,
      status: 'on_leave' as const,
      recorded_by: input.recordedBy,
      recorded_by_role: 'system' as const,
    }));
}

export async function syncLeaveAttendanceForEnrollment(params: {
  supabase: SupabaseClient;
  orgId: string;
  studentId: string;
  classId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  recordedBy: string | null;
}) {
  const { supabase, orgId, studentId, classId, effectiveFrom, effectiveTo, recordedBy } = params;

  let leaveQuery = supabase
    .from('leave_requests')
    .select('start_date, end_date, leave_request_sessions(session_id)')
    .eq('org_id', orgId)
    .eq('student_id', studentId)
    .gte('end_date', effectiveFrom);

  if (effectiveTo) {
    leaveQuery = leaveQuery.lte('start_date', effectiveTo);
  }

  const { data: leaves, error: leaveError } = await leaveQuery;
  if (leaveError || !leaves || leaves.length === 0) {
    return;
  }

  const overlappingLeaves = (leaves as EnrollmentLeaveRequestRow[]).filter(
    (leaveRow) => !effectiveTo || leaveRow.start_date <= effectiveTo,
  );
  if (overlappingLeaves.length === 0) {
    return;
  }

  const firstLeaveDate = overlappingLeaves.map((leaveRow) => leaveRow.start_date).sort()[0];
  const lastLeaveDate = overlappingLeaves
    .map((leaveRow) => leaveRow.end_date)
    .sort()
    .at(-1);

  const dateFrom = effectiveFrom > firstLeaveDate ? effectiveFrom : firstLeaveDate;
  const dateTo = effectiveTo
    ? effectiveTo < (lastLeaveDate ?? effectiveTo)
      ? effectiveTo
      : (lastLeaveDate ?? effectiveTo)
    : lastLeaveDate;

  if (!dateTo || dateFrom > dateTo) {
    return;
  }

  const { data: events, error: eventError } = await supabase
    .from('events')
    // `status` 是給 `isCancelledSession` 排除停課用的 —— 少撈它不會報錯，
    // 只會讓那道過濾靜靜地什麼都不做。理由見 `lib/cancelled-session.ts`。
    .select('id, event_date, sessions!inner(class_id, status)')
    .eq('org_id', orgId)
    .eq('event_type', 'session')
    .eq('sessions.class_id', classId)
    .gte('event_date', dateFrom)
    .lte('event_date', dateTo);

  if (eventError || !events || events.length === 0) {
    return;
  }

  const attendanceUpserts = buildEnrollmentLeaveAttendanceUpserts({
    orgId,
    studentId,
    recordedBy,
    // `sessions` 要一起傳下去 —— 這裡是最容易把 status 弄丟的地方
    events: events as EnrollmentEventRow[],
    leaves: overlappingLeaves,
  });

  if (attendanceUpserts.length === 0) {
    return;
  }

  const { error: attendanceError } = await supabase
    .from('attendance_records')
    .upsert(attendanceUpserts, {
      onConflict: 'event_id,student_id',
    });

  if (attendanceError) {
    throw attendanceError;
  }
}
