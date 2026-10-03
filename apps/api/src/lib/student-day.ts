import { isEnrolledOn } from './session-roster';
import { leaveCoversSession, type LeaveWindow } from './leave-covers-session';

/**
 * 「某個學生某一天」的預覽（#964：接到電話 → 不換頁請假）。純函式，不碰 DB。
 *
 * **這是預覽，不是承諾。** 實際把課堂標成請假的是 `POST /api/leaves` 裡的請假連動 ——
 * 那是保留類路徑，只能呼叫不能改，所以這裡**沒有**從 `leaves.ts` 抽任何東西。
 * 在籍與請假覆蓋改用既有的共用 helper（`isEnrolledOn`：點名名單與課堂列表的在籍規則；
 * `leaveCoversSession`：點名名單判斷「有沒有請假」的規則），讓預覽與點名名單講同一套話。
 * 前端送出後以 `GET /api/attendance` 顯示**實際寫入**的結果，兩者若有差以實際為準。
 */

export interface StudentDayEnrollment {
  classId: string;
  className: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface StudentDaySessionRow {
  sessionId: string;
  eventId: string | null;
  classId: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
}

export interface StudentDayInput {
  /** `YYYY-MM-DD`，台北日 */
  date: string;
  /** 這個學生的 active 報名（還沒依日期過濾） */
  enrollments: StudentDayEnrollment[];
  /** 這些班在 `date` 當天的課堂 */
  sessions: StudentDaySessionRow[];
  /** 這個學生在 `date` 當天的出勤紀錄 */
  records: Array<{ eventId: string; status: string }>;
  /** 這個學生涵蓋 `date` 的請假單 */
  leaves: LeaveWindow[];
  /** 這些班在 `date` 之後的課堂，依日期、時間遞增（給「那天沒課」時找下一堂） */
  upcoming: Array<{ classId: string; date: string; startTime: string | null; status: string }>;
}

export interface StudentDay {
  date: string;
  sessions: Array<{
    sessionId: string;
    eventId: string | null;
    startTime: string | null;
    endTime: string | null;
    className: string;
    /** 停課的那堂照列，但請假連動會跳過它 */
    cancelled: boolean;
    /** 目前的點名狀態；沒點過是 null */
    attendance: string | null;
    /** 已經有請假覆蓋這堂時的區間 —— 前端據此提前擋下重疊，而不是等送出後的 409 */
    existingLeave: { startDate: string; endDate: string } | null;
  }>;
  /** 只在那天沒有任何課時給 —— 家長常把日子說錯，給一個一鍵改日的出口 */
  nextSession: { date: string; startTime: string | null; className: string } | null;
}

const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);

/**
 * 只留下**至少蓋到一堂已推出課堂**的請假單（#970）。
 *
 * `leave_requests` 沒有分校欄位，查詢本身只能限到「範圍內的學生」。同一個學生若在兩校都有班，
 * 一張只蓋到他校課堂的假仍會被撈回來 —— 這裡在它進入任何變數之前就收掉，讓「範圍」不靠
 * 組裝端恰好只把它當查表（reviewer 在 #967 標的失效方向）。
 */
export function leavesTouchingSessions<L extends StudentDayInput['leaves'][number]>(
  leaves: L[],
  sessions: ReadonlyArray<Pick<StudentDaySessionRow, 'sessionId' | 'startTime' | 'endTime'>>,
  date: string,
): L[] {
  return leaves.filter((leave) =>
    sessions.some((s) =>
      leaveCoversSession(leave, {
        sessionId: s.sessionId,
        date,
        startTime: s.startTime,
        endTime: s.endTime,
      }),
    ),
  );
}

export function buildStudentDay(input: StudentDayInput): StudentDay {
  const classNameById = new Map(input.enrollments.map((e) => [e.classId, e.className]));
  const enrolledOn = (classId: string, date: string) =>
    input.enrollments.some((e) => e.classId === classId && isEnrolledOn(e, date));

  const statusByEvent = new Map(input.records.map((r) => [r.eventId, r.status]));

  const sessions = input.sessions
    .filter((s) => enrolledOn(s.classId, input.date))
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
    .map((s) => {
      const leave = input.leaves.find((l) =>
        leaveCoversSession(l, {
          sessionId: s.sessionId,
          date: input.date,
          startTime: s.startTime,
          endTime: s.endTime,
        }),
      );
      return {
        sessionId: s.sessionId,
        eventId: s.eventId,
        startTime: hhmm(s.startTime),
        endTime: hhmm(s.endTime),
        className: classNameById.get(s.classId) ?? '',
        cancelled: s.status === 'cancelled',
        attendance: (s.eventId && statusByEvent.get(s.eventId)) || null,
        existingLeave: leave ? { startDate: leave.startDate, endDate: leave.endDate } : null,
      };
    });

  const next =
    sessions.length === 0
      ? input.upcoming.find((u) => u.status !== 'cancelled' && enrolledOn(u.classId, u.date))
      : undefined;

  return {
    date: input.date,
    sessions,
    nextSession: next
      ? {
          date: next.date,
          startTime: hhmm(next.startTime),
          className: classNameById.get(next.classId) ?? '',
        }
      : null,
  };
}
