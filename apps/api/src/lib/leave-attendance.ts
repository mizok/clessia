import { isCancelledSession, toSessionRows, type CancellableSession } from './cancelled-session';
import { leaveCoversSession, type LeaveWindow } from './leave-covers-session';

/**
 * 請假的**判準**（#1695）：管理端（`routes/leaves.ts`）與家長端（`routes/parent/leaves.ts`）共用。
 *
 * 共用的是「這張假蓋到哪幾堂、要寫哪些 `on_leave`」，**不是讀寫**：管理端用原始 client，
 * 家長端一律走 `childDb`（A19）。出勤連動已經有好幾條寫入路徑，判準要是兩邊各寫一份，
 * 「請假蓋到哪幾堂」不同步的症狀會出現在扣堂和月結，離原因很遠（`20260902020758` 檔頭）。
 */

export interface LeaveValidationInput {
  readonly startDate: string;
  readonly endDate: string;
  readonly startTime?: string | null;
  readonly endTime?: string | null;
}

export interface LeaveAttendanceSessionRow extends CancellableSession {
  /** 查詢有選就有；單元測試的 fixture 可以省略 */
  readonly id?: string;
  readonly class_id: string;
}

export interface LeaveAttendanceEventRow {
  readonly id: string;
  readonly event_date: string;
  readonly sessions: LeaveAttendanceSessionRow | LeaveAttendanceSessionRow[] | null;
}

export interface LeaveAttendanceEnrollmentRow {
  readonly class_id: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

export interface BuildLeaveAttendanceUpsertsInput {
  readonly orgId: string;
  readonly studentId: string;
  readonly recordedBy: string;
  readonly events: ReadonlyArray<LeaveAttendanceEventRow>;
  readonly enrollments: ReadonlyArray<LeaveAttendanceEnrollmentRow>;
}

export function getLeaveValidationError(input: LeaveValidationInput): string | null {
  if (input.endDate < input.startDate) {
    return '結束日期不可早於開始日期';
  }

  if (
    input.startDate === input.endDate &&
    input.startTime &&
    input.endTime &&
    input.endTime < input.startTime
  ) {
    return '同一天請假的結束時間不可早於開始時間';
  }

  return null;
}

export function buildLeaveAttendanceUpserts(input: BuildLeaveAttendanceUpsertsInput) {
  return input.events
    .filter((eventRow) =>
      input.enrollments.some((enrollment) => {
        const sessionRows = toSessionRows(eventRow.sessions);

        return sessionRows.some(
          (sessionRow) =>
            enrollment.class_id === sessionRow.class_id &&
            !isCancelledSession(sessionRow) &&
            enrollment.effective_from <= eventRow.event_date &&
            (!enrollment.effective_to || enrollment.effective_to >= eventRow.event_date),
        );
      }),
    )
    .map((eventRow) => ({
      org_id: input.orgId,
      student_id: input.studentId,
      event_id: eventRow.id,
      status: 'on_leave' as const,
      recorded_by: input.recordedBy,
      recorded_by_role: 'system',
    }));
}

/** 這張假蓋不蓋得到這個 event（跟 roster 推導同一支判斷：綁定堂次、單日時間窗） */
export function coversEvent(window: LeaveWindow, ev: Record<string, any>): boolean {
  return leaveCoversSession(window, {
    sessionId: toSessionRows(ev['sessions'] as { id: string } | null)[0]?.id ?? null,
    date: ev['event_date'] as string,
    startTime: (ev['start_time'] as string | null) ?? null,
    endTime: (ev['end_time'] as string | null) ?? null,
  });
}
