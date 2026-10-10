import type { StudentAttendanceDays } from '@core/students.service';
import {
  absentLine,
  attendanceRange,
  buildLog,
  dateWithWeekday,
  situationLine,
  subjectScoreText,
} from './student-detail.util';

const att = (over: Partial<StudentAttendanceDays> = {}): StudentAttendanceDays => ({
  days: [],
  summary: { due: 0, came: 0, absentDates: [] },
  today: null,
  nextSession: null,
  ...over,
});

describe('attendanceRange', () => {
  it('沒有報名 → null', () => {
    expect(attendanceRange([], '2026-10-10')).toBeNull();
  });
  it('起＝最早報名日、迄＝今天＋21', () => {
    expect(attendanceRange(['2026-08-10', '2026-07-31'], '2026-10-10')).toEqual({
      from: '2026-07-31',
      to: '2026-10-31',
    });
  });
  it('超過 API 上限時起日被夾到「迄」往前 365 天（含頭尾 366 天）', () => {
    expect(attendanceRange(['2020-01-01'], '2026-10-10')).toEqual({
      from: '2025-10-31',
      to: '2026-10-31',
    });
  });
});

describe('situationLine', () => {
  it('今天有課＋下一堂', () => {
    expect(
      situationLine(
        att({
          today: { startTime: '15:30:00' },
          nextSession: { date: '2026-10-10', startTime: '15:00:00', className: 'A' },
        }),
      ),
    ).toEqual({ today: '今天 15:30 有課', next: '下一堂 10/10（六） 15:00' });
  });
  it('沒課、沒下一堂 → 只有今天那句', () => {
    expect(situationLine(att())).toEqual({ today: '今天沒有他的課', next: '' });
  });
  it('還沒載入 → 空', () => {
    expect(situationLine(null)).toEqual({ today: '', next: '' });
  });
});

describe('absentLine', () => {
  it('列出沒到日期（今年省略年份）', () => {
    expect(
      absentLine(att({ summary: { due: 10, came: 9, absentDates: ['2026-08-22'] } }), '2026-10-10'),
    ).toBe('沒到 1 天：8/22');
  });
  it('都有到／沒有該到的天', () => {
    expect(absentLine(att({ summary: { due: 3, came: 3, absentDates: [] } }), '2026-10-10')).toBe(
      '這段期間該到的都有到',
    );
    expect(absentLine(att(), '2026-10-10')).toBe('');
  });
});

describe('subjectScoreText', () => {
  it('補習班考算累計得分率、學校考算平均', () => {
    expect(
      subjectScoreText({
        subjectName: '英文',
        academySum: 92,
        academyTotalSum: 100,
        schoolAvg: 84.6,
        totalRecords: 3,
      }),
    ).toBe('補習班考 92% · 學校考平均 85');
  });
});

describe('dateWithWeekday', () => {
  it('2026-10-10 是週六', () => {
    expect(dateWithWeekday('2026-10-10')).toBe('10/10（六）');
  });
});

describe('buildLog', () => {
  it('五類事件依日期新→舊；UTC 晚上的時間戳換成台北日期', () => {
    const log = buildLog({
      today: '2026-10-10',
      // UTC 10-01 16:30 ＝ 台北 10-02 00:30
      createdAt: '2026-10-01T16:30:00Z',
      enrollments: [
        { createdAt: '2026-08-01T02:00:00Z', className: '數學班', statusLabel: '在學' },
      ],
      attendance: att({
        days: [
          {
            date: '2026-08-22',
            state: 'absent',
            sessions: [{ sessionId: 's', className: '數學班', startTime: null, status: 'x' }],
          },
          { date: '2026-08-29', state: 'came', sessions: [] },
        ],
      }),
      invoices: [{ issuedAt: '2026-10-04T02:00:00Z', total: 4050 }],
      leaves: [
        {
          createdAt: '2026-09-01T02:00:00Z',
          startDate: '2026-09-05',
          endDate: '2026-09-05',
          reason: '感冒',
          submittedByRole: 'parent',
        },
      ],
    });
    expect(log).toEqual([
      { date: '2026-10-04', text: '開立帳單 NT$ 4,050' },
      { date: '2026-10-02', text: '加入補習班' },
      { date: '2026-09-01', text: '家長請假 9/5：感冒' },
      { date: '2026-08-22', text: '沒到（數學班）' },
      { date: '2026-08-01', text: '報名 數學班（在學）' },
    ]);
  });
});
