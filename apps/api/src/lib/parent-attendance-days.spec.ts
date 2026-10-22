import { describe, expect, it } from 'vitest';

import {
  buildAttendanceDays,
  onRosterOn,
  type DaysEnrollment,
  type DaysRecord,
  type DaysSession,
} from './parent-attendance-days';

const C1 = 'class-1';
const CAMPUS_A = 'campus-a';
const CAMPUS_B = 'campus-b';

const enrollment = (over: Partial<DaysEnrollment> = {}): DaysEnrollment => ({
  classId: C1,
  status: 'active',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  statusChangedAt: null,
  ...over,
});

const session = (id: string, date: string, over: Partial<DaysSession> = {}): DaysSession => ({
  sessionId: id,
  eventId: `ev-${id}`,
  classId: C1,
  date,
  startTime: '17:00',
  endTime: '18:30',
  status: 'scheduled',
  className: '國三數學',
  campusId: CAMPUS_A,
  campusName: '文山',
  teacherName: '王老師',
  classroomName: 'A 教室',
  ...over,
});

const record = (
  id: string,
  eventId: string,
  date: string,
  over: Partial<DaysRecord> = {},
): DaysRecord => ({
  id,
  eventId,
  status: 'present',
  note: null,
  date,
  startTime: '17:00',
  endTime: '18:30',
  sessionId: null,
  sessionStatus: null,
  className: null,
  campusId: CAMPUS_A,
  campusName: '文山',
  ...over,
});

const base = {
  dateFrom: '2026-10-13',
  dateTo: '2026-10-22',
  enrollments: [enrollment()],
  sessions: [] as DaysSession[],
  records: [] as DaysRecord[],
  leaves: [],
  checkins: [],
  dailyCampusIds: new Set<string>(),
};

describe('onRosterOn —— 那天在籍（裁定 1）', () => {
  it('active：看生效區間', () => {
    expect(onRosterOn(enrollment(), '2026-10-20')).toBe(true);
    expect(onRosterOn(enrollment({ effectiveFrom: '2026-10-21' }), '2026-10-20')).toBe(false);
  });

  it('退班：退班當天（effective_to）還算，之後不算', () => {
    const e = enrollment({ status: 'withdrawal', effectiveTo: '2026-10-18' });
    expect(onRosterOn(e, '2026-10-18')).toBe(true);
    expect(onRosterOn(e, '2026-10-19')).toBe(false);
  });

  it('暫停：早於暫停那天才算；沒有日期就不算', () => {
    const e = enrollment({ status: 'suspended', statusChangedAt: '2026-10-18' });
    expect(onRosterOn(e, '2026-10-17')).toBe(true);
    expect(onRosterOn(e, '2026-10-18')).toBe(false);
    expect(onRosterOn(enrollment({ status: 'suspended' }), '2026-10-17')).toBe(false);
  });

  it('待繳費、作廢：一律不算', () => {
    expect(onRosterOn(enrollment({ status: 'pending_payment' }), '2026-10-20')).toBe(false);
    expect(onRosterOn(enrollment({ status: 'void' }), '2026-10-20')).toBe(false);
  });
});

describe('buildAttendanceDays —— 課堂為來源、左接出勤', () => {
  it('沒點名的堂也列出來，status 是 null（不是缺席）', () => {
    const rows = buildAttendanceDays({ ...base, sessions: [session('s1', '2026-10-20')] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 's1', status: null, derived: null, teacherName: '王老師' });
  });

  it('有紀錄的堂帶紀錄的狀態與備註', () => {
    const rows = buildAttendanceDays({
      ...base,
      sessions: [session('s1', '2026-10-20')],
      records: [record('r1', 'ev-s1', '2026-10-20', { status: 'absent', note: '發燒' })],
    });
    expect(rows[0]).toMatchObject({ status: 'absent', note: '發燒' });
  });

  it('停課的堂照列（家長最需要知道這堂不上了），不做任何推導', () => {
    const rows = buildAttendanceDays({
      ...base,
      sessions: [session('s1', '2026-10-20', { status: 'cancelled', eventId: null })],
      checkins: [{ date: '2026-10-20', campusId: null }],
      dailyCampusIds: new Set([CAMPUS_A]),
    });
    expect(rows[0]).toMatchObject({ sessionStatus: 'cancelled', status: null, derived: null });
  });

  it('不在籍又沒紀錄的堂不列（例如暫停之後、待繳費）', () => {
    const rows = buildAttendanceDays({
      ...base,
      enrollments: [enrollment({ status: 'suspended', statusChangedAt: '2026-10-18' })],
      sessions: [session('s1', '2026-10-17'), session('s2', '2026-10-20')],
    });
    expect(rows.map((r) => r.id)).toEqual(['s1']);
  });

  it('不在籍但有紀錄 → 照列（判準錯了只會多列，不會吃掉紀錄）', () => {
    const rows = buildAttendanceDays({
      ...base,
      enrollments: [enrollment({ status: 'pending_payment' })],
      sessions: [session('s1', '2026-10-20')],
      records: [record('r1', 'ev-s1', '2026-10-20')],
    });
    expect(rows.map((r) => r.status)).toEqual(['present']);
  });

  it('裁定 2：沒紀錄但有假單蓋到 → derived=leave，帶誰登記；補習班登記的不帶原因', () => {
    const leave = (role: string) => ({
      window: {
        startDate: '2026-10-20',
        endDate: '2026-10-20',
        startTime: null,
        endTime: null,
        boundSessions: [],
      },
      submittedByRole: role,
      reason: '家裡有事',
    });
    const byParent = buildAttendanceDays({
      ...base,
      sessions: [session('s1', '2026-10-20')],
      leaves: [leave('parent')],
    });
    expect(byParent[0]).toMatchObject({
      status: null,
      derived: 'leave',
      leaveSubmittedBy: 'parent',
      leaveReason: '家裡有事',
    });
    const bySchool = buildAttendanceDays({
      ...base,
      sessions: [session('s1', '2026-10-20')],
      leaves: [leave('admin')],
    });
    expect(bySchool[0]).toMatchObject({ leaveSubmittedBy: 'school', leaveReason: null });
  });

  it('裁定 3：日到班分校、當天有涵蓋這堂的刷卡、沒紀錄 → derived=checkin', () => {
    const rows = buildAttendanceDays({
      ...base,
      sessions: [session('s1', '2026-10-20')],
      checkins: [{ date: '2026-10-20', campusId: CAMPUS_A }],
      dailyCampusIds: new Set([CAMPUS_A]),
    });
    expect(rows[0]).toMatchObject({ status: null, derived: 'checkin' });
  });

  it('裁定 3 的邊界：卡在別校、分校是隨堂、別天的卡 → 都不推導', () => {
    const one = (over: Partial<typeof base>) =>
      buildAttendanceDays({ ...base, sessions: [session('s1', '2026-10-20')], ...over })[0]!
        .derived;
    expect(
      one({
        checkins: [{ date: '2026-10-20', campusId: CAMPUS_B }],
        dailyCampusIds: new Set([CAMPUS_A]),
      } as never),
    ).toBeNull();
    expect(one({ checkins: [{ date: '2026-10-20', campusId: CAMPUS_A }] } as never)).toBeNull();
    expect(
      one({
        checkins: [{ date: '2026-10-19', campusId: CAMPUS_A }],
        dailyCampusIds: new Set([CAMPUS_A]),
      } as never),
    ).toBeNull();
  });

  it('有紀錄就不推導（推導只補「沒有紀錄」）', () => {
    const rows = buildAttendanceDays({
      ...base,
      sessions: [session('s1', '2026-10-20')],
      records: [record('r1', 'ev-s1', '2026-10-20', { status: 'absent' })],
      checkins: [{ date: '2026-10-20', campusId: CAMPUS_A }],
      dailyCampusIds: new Set([CAMPUS_A]),
    });
    expect(rows[0]).toMatchObject({ status: 'absent', derived: null });
  });

  it('新到舊；同一天照開始時間', () => {
    const rows = buildAttendanceDays({
      ...base,
      sessions: [
        session('a', '2026-10-19', { startTime: '09:00' }),
        session('b', '2026-10-20', { startTime: '19:00' }),
        session('c', '2026-10-20', { startTime: '17:00' }),
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});

/** 審核席 #1818 二讀存活的突變（L6、L9、L16、L20 與 event 一對多），一條一條釘住 */
describe('審核席補強', () => {
  const coveringLeave = (role = 'parent') => ({
    window: {
      startDate: '2026-10-20',
      endDate: '2026-10-20',
      startTime: null,
      endTime: null,
      boundSessions: [],
    },
    submittedByRole: role,
    reason: '看醫生',
  });

  it('L6：在籍要比對班級 —— A 班已退班、B 班在籍，A 班退班後的堂不列', () => {
    const rows = buildAttendanceDays({
      ...base,
      enrollments: [
        enrollment({ classId: 'class-a', status: 'withdrawal', effectiveTo: '2026-10-15' }),
        enrollment({ classId: 'class-b' }),
      ],
      sessions: [
        session('a-after', '2026-10-20', { classId: 'class-a' }),
        session('b', '2026-10-20', { classId: 'class-b' }),
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });

  it('L9：有紀錄但不是請假（出席）→ 不帶假單來源與原因', () => {
    const rows = buildAttendanceDays({
      ...base,
      sessions: [session('s1', '2026-10-20')],
      records: [record('r1', 'ev-s1', '2026-10-20', { status: 'present' })],
      leaves: [coveringLeave()],
    });
    expect(rows[0]).toMatchObject({ status: 'present', leaveSubmittedBy: null, leaveReason: null });
  });

  it('L16：併回的列有 sessionId 時用它當 id（跟課堂列同一種鍵）', () => {
    const rows = buildAttendanceDays({
      ...base,
      records: [record('r1', 'ev-x', '2026-10-20', { sessionId: 'sess-x' })],
    });
    expect(rows[0]!.id).toBe('sess-x');
  });

  it('L20：併回的請假紀錄也找假單，帶出請假來源與原因', () => {
    const rows = buildAttendanceDays({
      ...base,
      records: [record('r1', 'ev-x', '2026-10-20', { status: 'on_leave', sessionId: null })],
      leaves: [coveringLeave()],
    });
    expect(rows[0]).toMatchObject({ leaveSubmittedBy: 'parent', leaveReason: '看醫生' });
  });

  it('兩堂掛同一個 event（event_id 沒有唯一約束）→ 那筆紀錄只出現一次', () => {
    const rows = buildAttendanceDays({
      ...base,
      sessions: [
        session('s1', '2026-10-20', { eventId: 'ev-shared' }),
        session('s2', '2026-10-20', { eventId: 'ev-shared', startTime: '19:00' }),
      ],
      records: [record('r1', 'ev-shared', '2026-10-20', { status: 'absent' })],
    });
    expect(rows.filter((r) => r.status === 'absent')).toHaveLength(1);
  });
});

/** 設計稿 §6 的兩條不變式 —— 用日期窗重建列表的陷阱就是「窗外的資料整筆消失」 */
describe('不變式', () => {
  const sessions = [
    session('s1', '2026-10-13'),
    session('s2', '2026-10-20', { eventId: 'ev-s2' }),
    session('s3', '2026-10-22'),
    // 窗外的課堂（呼叫端多撈了）
    session('out', '2026-10-25'),
  ];
  const records = [
    record('r1', 'ev-s2', '2026-10-20'),
    // 非課堂事件
    record('r2', 'ev-mock', '2026-10-21', { sessionId: null, sessionStatus: null }),
    // 課堂查詢收不到（班不在報名清單裡）但有紀錄
    record('r3', 'ev-other', '2026-10-15', { sessionId: 'other', sessionStatus: 'completed' }),
    // 窗外的紀錄
    record('r4', 'ev-old', '2026-10-01'),
  ];
  const rows = buildAttendanceDays({ ...base, sessions, records });

  it('每一列都落在窗內', () => {
    expect(rows.every((r) => r.eventDate >= base.dateFrom && r.eventDate <= base.dateTo)).toBe(
      true,
    );
  });

  it('窗內每筆出勤紀錄恰好出現一次（課堂收到的、非課堂的、課堂收不到的都在）', () => {
    const inWindow = records.filter((r) => r.date >= base.dateFrom && r.date <= base.dateTo);
    for (const r of inWindow) {
      const hits = rows.filter((row) => row.eventId === r.eventId && row.status === r.status);
      expect(hits, r.id).toHaveLength(1);
    }
  });

  it('列的 id 不重複（前端拿它當 track key）', () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
});
