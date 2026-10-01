import { describe, expect, it } from 'vitest';

import { buildStudentDay, type StudentDayInput } from './student-day';

/**
 * #964「接到電話 → 不換頁請假」的送出前預覽：這個學生某一天有哪些課、各自的點名狀態、
 * 是不是已經請過假，以及（那天沒課時）下一堂是哪天。
 *
 * **這是預覽不是承諾** —— 實際標成請假的是 `POST /api/leaves` 的請假連動（保留類，只呼叫不改），
 * 前端送出後會用 `GET /api/attendance` 顯示實際寫入的結果。這裡的在籍與請假覆蓋判定
 * 刻意沿用既有的共用 helper（`isEnrolledOn`、`leaveCoversSession`），讓預覽跟點名名單同一套規則。
 */

const base: StudentDayInput = {
  date: '2026-10-01',
  enrollments: [
    { classId: 'math', className: '國三數學 A', effectiveFrom: '2026-09-01', effectiveTo: null },
    { classId: 'eng', className: '國三英文', effectiveFrom: '2026-09-01', effectiveTo: null },
  ],
  sessions: [
    {
      sessionId: 's-eng',
      eventId: 'e-eng',
      classId: 'eng',
      startTime: '16:00:00',
      endTime: '17:30:00',
      status: 'scheduled',
    },
    {
      sessionId: 's-math',
      eventId: 'e-math',
      classId: 'math',
      startTime: '14:00:00',
      endTime: '15:30:00',
      status: 'scheduled',
    },
  ],
  records: [],
  leaves: [],
  upcoming: [],
};

describe('buildStudentDay', () => {
  it('列出那天的課，依開始時間排序，帶班名與時間（秒去掉）', () => {
    const day = buildStudentDay(base);

    expect(day.sessions.map((s) => [s.startTime, s.endTime, s.className])).toEqual([
      ['14:00', '15:30', '國三數學 A'],
      ['16:00', '17:30', '國三英文'],
    ]);
  });

  it('帶出目前的點名狀態；沒點過是 null', () => {
    const day = buildStudentDay({ ...base, records: [{ eventId: 'e-eng', status: 'absent' }] });

    expect(day.sessions.map((s) => s.attendance)).toEqual([null, 'absent']);
  });

  // 在籍判定跟點名名單同一套（isEnrolledOn）：報名還沒生效的那個班不算他的課
  it('報名在那天還沒生效 / 已經結束的班，不列', () => {
    const day = buildStudentDay({
      ...base,
      enrollments: [
        {
          classId: 'math',
          className: '國三數學 A',
          effectiveFrom: '2026-10-02',
          effectiveTo: null,
        },
        {
          classId: 'eng',
          className: '國三英文',
          effectiveFrom: '2026-09-01',
          effectiveTo: '2026-09-30',
        },
      ],
    });

    expect(day.sessions).toEqual([]);
  });

  it('停課的那堂照列但標 cancelled —— 預覽要說「這堂不會被標」', () => {
    const day = buildStudentDay({
      ...base,
      sessions: [{ ...base.sessions[1], status: 'cancelled' }],
    });

    expect(day.sessions[0]).toMatchObject({ className: '國三數學 A', cancelled: true });
  });

  it('已經有請假覆蓋那堂 → 帶出請假區間（前端據此停用送出）', () => {
    const day = buildStudentDay({
      ...base,
      leaves: [{ startDate: '2026-09-30', endDate: '2026-10-03', startTime: null, endTime: null }],
    });

    expect(day.sessions.map((s) => s.existingLeave)).toEqual([
      { startDate: '2026-09-30', endDate: '2026-10-03' },
      { startDate: '2026-09-30', endDate: '2026-10-03' },
    ]);
  });

  // 單日、有時段的請假只覆蓋時段重疊的那堂（leaveCoversSession 的規則）
  it('單日時段假只覆蓋重疊的那堂', () => {
    const day = buildStudentDay({
      ...base,
      leaves: [
        { startDate: '2026-10-01', endDate: '2026-10-01', startTime: '13:00', endTime: '15:00' },
      ],
    });

    expect(day.sessions.map((s) => s.existingLeave !== null)).toEqual([true, false]);
  });

  describe('那天沒課時的「下一堂」', () => {
    const noClassToday = { ...base, sessions: [] };

    it('給出最早的一堂未停課、且那天在籍的課', () => {
      const day = buildStudentDay({
        ...noClassToday,
        upcoming: [
          { classId: 'eng', date: '2026-10-02', startTime: '16:00:00', status: 'cancelled' },
          { classId: 'math', date: '2026-10-03', startTime: '14:00:00', status: 'scheduled' },
          { classId: 'eng', date: '2026-10-04', startTime: '16:00:00', status: 'scheduled' },
        ],
      });

      expect(day.nextSession).toEqual({
        date: '2026-10-03',
        startTime: '14:00',
        className: '國三數學 A',
      });
    });

    it('下一堂那天報名已經結束的不算', () => {
      const day = buildStudentDay({
        ...noClassToday,
        enrollments: [
          {
            classId: 'math',
            className: '國三數學 A',
            effectiveFrom: '2026-09-01',
            effectiveTo: '2026-10-02',
          },
        ],
        upcoming: [
          { classId: 'math', date: '2026-10-03', startTime: '14:00:00', status: 'scheduled' },
        ],
      });

      expect(day.nextSession).toBeNull();
    });

    it('那天有課時不給下一堂（前端不需要它）', () => {
      const day = buildStudentDay({
        ...base,
        upcoming: [
          { classId: 'math', date: '2026-10-03', startTime: '14:00:00', status: 'scheduled' },
        ],
      });

      expect(day.nextSession).toBeNull();
    });
  });
});
