import { isEnrolledOn } from './session-roster';
import { leaveCoversSession, type LeaveWindow } from './leave-covers-session';
import { checkinCoversSession } from './session-arrivals';

/**
 * 家長出缺席「列出還沒點名的堂」（#1810，設計見 kb/wiki/specs/parent/attendance.md 同名一節）。
 *
 * 路由把資料庫的列整理成下面這幾種平的輸入，組列的規則全在這裡 —— 兩條不變式
 * （窗內每筆出勤紀錄恰好出現一次、每一列都落在窗內）由這支的 spec 釘住。
 */

export interface DaysEnrollment {
  classId: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** 狀態最後一次改變的台北日期（暫停用它界定從哪天起不收） */
  statusChangedAt: string | null;
}

export interface DaysSession {
  sessionId: string;
  eventId: string | null;
  classId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  className: string | null;
  campusId: string | null;
  campusName: string | null;
  teacherName: string | null;
  classroomName: string | null;
}

export interface DaysRecord {
  id: string;
  eventId: string;
  status: 'present' | 'absent' | 'on_leave';
  note: string | null;
  /** 以下給「沒被課堂收到的紀錄」自己組列用 */
  date: string;
  startTime: string | null;
  endTime: string | null;
  sessionId: string | null;
  sessionStatus: 'scheduled' | 'completed' | 'cancelled' | null;
  className: string | null;
  campusId: string | null;
  campusName: string | null;
}

export interface DaysLeave {
  window: LeaveWindow;
  submittedByRole: string | null;
  reason: string | null;
}

export interface DaysCheckin {
  date: string;
  campusId: string | null;
}

export interface AttendanceDayRow {
  /** 列的穩定鍵：有課堂用課堂 id，沒有（非課堂事件）用出勤紀錄 id */
  id: string;
  sessionId: string | null;
  eventId: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  campusId: string | null;
  campusName: string | null;
  className: string | null;
  sessionStatus: 'scheduled' | 'completed' | 'cancelled' | null;
  /** 出勤紀錄上寫的；`null`＝沒有紀錄（永遠不等於缺席，rules §6） */
  status: 'present' | 'absent' | 'on_leave' | null;
  /**
   * 沒紀錄時的推導（計畫席 10-22 裁定 2、3）：
   * `leave`＝有假單蓋到這堂；`checkin`＝日到班分校、當天有涵蓋這堂的刷卡。有紀錄時一律 null
   */
  derived: 'leave' | 'checkin' | null;
  note: string | null;
  leaveSubmittedBy: 'parent' | 'school' | null;
  leaveReason: string | null;
  teacherName: string | null;
  classroomName: string | null;
}

/**
 * 這筆報名在 `date` 那天算不算在籍（裁定 1）：
 * active／退班看生效區間（退班會把 effective_to 寫成退班當天）；暫停另外要早於狀態改變那天；
 * 待繳費、作廢一律不算。
 */
export function onRosterOn(e: DaysEnrollment, date: string): boolean {
  const inRange = isEnrolledOn(
    { effectiveFrom: e.effectiveFrom, effectiveTo: e.effectiveTo },
    date,
  );
  if (e.status === 'active' || e.status === 'withdrawal') return inRange;
  if (e.status === 'suspended') return inRange && !!e.statusChangedAt && date < e.statusChangedAt;
  return false;
}

export function buildAttendanceDays(input: {
  dateFrom: string;
  dateTo: string;
  enrollments: readonly DaysEnrollment[];
  sessions: readonly DaysSession[];
  records: readonly DaysRecord[];
  leaves: readonly DaysLeave[];
  checkins: readonly DaysCheckin[];
  /** 生效模式是日到班的分校 */
  dailyCampusIds: ReadonlySet<string>;
}): AttendanceDayRow[] {
  const inWindow = (d: string) => d >= input.dateFrom && d <= input.dateTo;
  const recordByEvent = new Map(input.records.map((r) => [r.eventId, r]));
  const used = new Set<string>();

  const leaveFor = (w: {
    sessionId: string | null;
    date: string;
    startTime: string | null;
    endTime: string | null;
  }) => input.leaves.find((l) => leaveCoversSession(l.window, w)) ?? null;
  const leaveFields = (leave: DaysLeave | null) => {
    const byParent = leave?.submittedByRole === 'parent';
    return {
      leaveSubmittedBy: leave ? (byParent ? ('parent' as const) : ('school' as const)) : null,
      // 補習班登記的不回原因（#1742、計畫席 10-19 裁 A）
      leaveReason: byParent ? (leave?.reason ?? null) : null,
    };
  };
  const checkinOn = new Map(input.checkins.map((k) => [k.date, k]));

  const rows: AttendanceDayRow[] = [];

  for (const s of input.sessions) {
    if (!inWindow(s.date)) continue;
    // 一筆紀錄只給第一堂：`sessions.event_id` 沒有唯一約束，萬一兩堂掛同一個 event，不讓同一筆紀錄出現兩次
    const hit = s.eventId ? recordByEvent.get(s.eventId) : undefined;
    const record = hit && !used.has(hit.id) ? hit : undefined;
    const enrolled = input.enrollments.some(
      (e) => e.classId === s.classId && onRosterOn(e, s.date),
    );
    // 不在籍又沒紀錄 → 不列；不在籍但有紀錄 → 照列（判準錯了也只多列、不吃紀錄）
    if (!enrolled && !record) continue;
    if (record) used.add(record.id);

    const window = {
      sessionId: s.sessionId,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
    };
    let derived: AttendanceDayRow['derived'] = null;
    let leave: DaysLeave | null = null;
    if (record) {
      if (record.status === 'on_leave') leave = leaveFor(window);
    } else if (s.status !== 'cancelled') {
      leave = leaveFor(window);
      if (leave) {
        derived = 'leave';
      } else {
        const card = checkinOn.get(s.date);
        if (
          card &&
          s.campusId &&
          input.dailyCampusIds.has(s.campusId) &&
          checkinCoversSession(card.campusId, s.campusId)
        ) {
          derived = 'checkin';
        }
      }
    }

    rows.push({
      id: s.sessionId,
      sessionId: s.sessionId,
      eventId: s.eventId,
      eventDate: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      campusId: s.campusId,
      campusName: s.campusName,
      className: s.className,
      sessionStatus: s.status,
      status: record?.status ?? null,
      derived,
      note: record?.note ?? null,
      ...leaveFields(leave),
      teacherName: s.teacherName,
      classroomName: s.classroomName,
    });
  }

  // 併回：窗內沒被課堂收到的紀錄（非課堂事件、課堂查詢收不到的）—— 保證每筆紀錄恰好一次
  for (const r of input.records) {
    if (used.has(r.id) || !inWindow(r.date)) continue;
    used.add(r.id);
    const leave =
      r.status === 'on_leave'
        ? leaveFor({
            sessionId: r.sessionId,
            date: r.date,
            startTime: r.startTime,
            endTime: r.endTime,
          })
        : null;
    rows.push({
      id: r.sessionId ?? r.id,
      sessionId: r.sessionId,
      eventId: r.eventId,
      eventDate: r.date,
      startTime: r.startTime,
      endTime: r.endTime,
      campusId: r.campusId,
      campusName: r.campusName,
      className: r.className,
      sessionStatus: r.sessionStatus,
      status: r.status,
      derived: null,
      note: r.note,
      ...leaveFields(leave),
      // ponytail: 併回的列不帶老師與教室（要多一支查詢）；這類列少見，多半是非課堂事件
      teacherName: null,
      classroomName: null,
    });
  }

  // 新到舊；同一天照開始時間
  return rows.sort((a, b) =>
    a.eventDate !== b.eventDate
      ? b.eventDate.localeCompare(a.eventDate)
      : (a.startTime ?? '').localeCompare(b.startTime ?? ''),
  );
}
