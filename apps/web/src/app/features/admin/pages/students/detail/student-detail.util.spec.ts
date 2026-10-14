import type { StudentAttendanceDays } from '@core/students.service';
import {
  absentLine,
  absentTitle,
  attendanceRange,
  buildLog,
  classesLabel,
  dateWithWeekday,
  examScoreText,
  scoreSummaryText,
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

describe('absentLine：超過 3 天只列最近 3 天', () => {
  const days = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'];
  const a = att({ summary: { due: 20, came: 15, absentDates: days } });
  it('剛好 3 天：全列、不縮短（邊界）', () => {
    const three = att({ summary: { due: 20, came: 17, absentDates: days.slice(0, 3) } });
    expect(absentLine(three, '2026-10-10')).toBe('沒到 3 天：8/3、8/10、8/17');
    expect(absentTitle(three, '2026-10-10')).toBeNull();
  });
  it('4 天以上：最近 3 天＋「等 N 天」，完整日期給 title（不論傳入順序）', () => {
    expect(absentLine(a, '2026-10-10')).toBe('沒到 8/17、8/24、8/31 等 5 天');
    expect(absentTitle(a, '2026-10-10')).toBe('沒到 5 天：8/3、8/10、8/17、8/24、8/31');
    const shuffled = att({
      summary: { due: 20, came: 15, absentDates: [days[3], days[0], days[4], days[1], days[2]] },
    });
    expect(absentLine(shuffled, '2026-10-10')).toBe('沒到 8/17、8/24、8/31 等 5 天');
  });
});

describe('classesLabel', () => {
  it('0／1／多個班', () => {
    expect(classesLabel([])).toBe('');
    expect(classesLabel(['班A'])).toBe('班A');
    expect(classesLabel(['班A', '班B', '班C'])).toBe('班A 等 3 班');
  });
});

describe('scoreSummaryText／examScoreText', () => {
  const subj = (n: number) => ({
    subjectName: '英文',
    academySum: null,
    academyTotalSum: null,
    schoolAvg: null,
    totalRecords: n,
  });
  const latest = (over = {}) => ({
    examId: 'e',
    examName: '段考',
    examDate: '2026-10-01',
    score: 79,
    totalScore: 100,
    classAvg: 86,
    rank: 3,
    classSize: 20,
    ...over,
  });
  it('沒有紀錄 → 還沒有成績', () => {
    expect(scoreSummaryText([], null)).toBe('還沒有成績');
  });
  it('次數＝各科紀錄數加總（互質：2＋3），有最近一場寫分數與班平均', () => {
    expect(scoreSummaryText([subj(2), subj(3)], latest())).toBe('5 次 · 最近 79 分（班平均 86）');
  });
  it('班平均是 null 就不寫括號；沒有校內考只寫次數', () => {
    expect(scoreSummaryText([subj(3)], latest({ classAvg: null }))).toBe('3 次 · 最近 79 分');
    expect(scoreSummaryText([subj(3)], null)).toBe('3 次');
  });
  it('滿分不是 100 寫「40／50 分」，滿分 null 或 100 寫「N 分」', () => {
    expect(examScoreText({ score: 40, totalScore: 50 })).toBe('40／50 分');
    expect(examScoreText({ score: 40, totalScore: 100 })).toBe('40 分');
    expect(examScoreText({ score: 40, totalScore: null })).toBe('40 分');
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
