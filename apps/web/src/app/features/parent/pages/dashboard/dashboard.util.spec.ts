import type { ParentCatalogClass } from '@core/parent-applications.service';
import type { ParentInvoice } from '@core/parent-billing.service';
import type { ParentScoreRecord } from '@core/parent-grades.service';
import type { ParentSession } from '@core/parent-sessions.service';
import {
  arrivalLine,
  dayLabel,
  examRows,
  latestLogs,
  payStrip,
  recommendations,
  shownSessions,
  slotsLabel,
  subLine,
} from './dashboard.util';

const TODAY = '2026-10-22'; // 週四

const ses = (date: string, over: Partial<ParentSession> = {}): ParentSession => ({
  sessionId: `s-${date}-${over.startTime ?? ''}`,
  date,
  startTime: '17:00:00',
  endTime: '19:00:00',
  status: 'scheduled',
  classId: 'c1',
  className: '國三數學',
  courseName: null,
  campusId: 'campus-1',
  campusName: '中正校',
  usesContactBook: false,
  campusPhone: null,
  classroomName: null,
  teacherName: '王老師',
  isSubstitute: false,
  originalTeacherName: null,
  examCount: 0,
  examNames: [],
  changes: [],
  attendance: null,
  ...over,
});

const score = (over: Partial<ParentScoreRecord> = {}): ParentScoreRecord => ({
  id: 'sc1',
  type: 'academy',
  examName: '第三次小考',
  examDate: '2026-10-20',
  subjectName: '數學',
  className: '國三數學',
  createdAt: '2026-10-21T10:00:00Z',
  score: 80,
  totalScore: 100,
  status: 'scored',
  description: null,
  teacherName: null,
  recordedByName: null,
  ...over,
});

describe('dashboard.util', () => {
  it('dayLabel', () => {
    expect(dayLabel('2026-10-22')).toBe('10/22（四）');
  });

  describe('arrivalLine（A6 開場句）', () => {
    const daily = new Set(['campus-1']);
    it('沒課／到了／請假／還沒到（還沒上課）／還沒到班（已經開始）', () => {
      expect(arrivalLine([], undefined, daily, '15:00')).toBe('今天沒有課。');
      expect(arrivalLine([ses(TODAY)], '16:41', daily, '17:10')).toBe('16:41 到班了。');
      expect(
        arrivalLine(
          [ses(TODAY, { attendance: { status: 'on_leave', checkedInAt: null } })],
          undefined,
          daily,
          '15:00',
        ),
      ).toBe('今天請假。');
      expect(arrivalLine([ses(TODAY)], undefined, daily, '15:00')).toBe('還沒到，17:00 有課。');
      expect(arrivalLine([ses(TODAY)], undefined, daily, '17:30')).toBe('還沒到班。');
    });
    it('停課的不算課；分校沒有日到班 → null（不知道到了沒）', () => {
      expect(arrivalLine([ses(TODAY, { status: 'cancelled' })], undefined, daily, '15:00')).toBe(
        '今天沒有課。',
      );
      expect(arrivalLine([ses(TODAY)], undefined, new Set(), '15:00')).toBeNull();
    });
  });

  it('subLine：今天的堂；沒有就下一堂（跳過停課）', () => {
    expect(
      subLine([ses(TODAY), ses(TODAY, { startTime: '19:10:00', className: '國三英文' })], TODAY),
    ).toBe('今天 2 堂：17:00 國三數學、19:10 國三英文');
    expect(subLine([ses('2026-10-23', { status: 'cancelled' }), ses('2026-10-24')], TODAY)).toBe(
      '下一堂 10/24（六）17:00 國三數學',
    );
  });

  it('shownSessions：今天 → 3 天內 → 接下來 3 堂', () => {
    expect(shownSessions([ses(TODAY), ses('2026-10-23')], TODAY)).toMatchObject({ today: true });
    expect(shownSessions([ses('2026-10-23'), ses('2026-10-30')], TODAY).rows).toHaveLength(1);
    expect(
      shownSessions(
        [ses('2026-10-28'), ses('2026-10-29'), ses('2026-10-30'), ses('2026-11-02')],
        TODAY,
      ).rows,
    ).toHaveLength(3);
  });

  describe('examRows', () => {
    it('要考的在前：今天考／N 天後考，標題是班名 · 考試名；8 天後的不列', () => {
      const rows = examRows(
        [],
        [
          ses('2026-10-24', { examNames: ['第四次小考'] }),
          ses(TODAY, { examNames: ['單字測驗'] }),
          ses('2026-10-30', { examNames: ['太遠'] }),
        ],
        TODAY,
      );
      expect(rows.map((r) => [r.title, r.tags[0].label])).toEqual([
        ['國三數學 · 單字測驗', '今天考'],
        ['國三數學 · 第四次小考', '2 天後考'],
      ]);
    });

    it('考過的：滿分、不及格（滿分的六成）附鼓勵語；7 天內登錄的標新成績；缺考', () => {
      const [full, fail, absent] = examRows(
        [
          score({ id: 'a', score: 100, examDate: '2026-10-21' }),
          score({ id: 'b', score: 29, totalScore: 50, examDate: '2026-10-20' }),
          score({
            id: 'c',
            score: null,
            status: 'absent',
            examDate: '2026-10-19',
            createdAt: '2026-10-01T00:00:00Z',
          }),
        ],
        [],
        TODAY,
      );
      expect(full).toMatchObject({ score: 100, cheer: '太厲害了，繼續保持！' });
      expect(full.tags.map((t) => t.label)).toEqual(['滿分', '新成績']);
      expect(fail).toMatchObject({ meta: '及格 30 分', cheer: '這次差一點，下次會更好。' });
      expect(fail.tags[0]).toEqual({ tone: 'error', label: '不及格' });
      expect(absent.tags.map((t) => t.label)).toEqual(['缺考']);
    });
  });

  describe('payStrip', () => {
    const inv = (over: Partial<ParentInvoice>): ParentInvoice => ({
      id: 'i',
      invoiceNo: null,
      issuedAt: '2026-10-01',
      dueDate: '2026-10-30',
      status: 'unpaid',
      voidedAt: null,
      total: 5000,
      netPaid: 0,
      items: [],
      payments: [],
      createdAt: '2026-10-01',
      ...over,
    });
    it('沒有待繳 → null；取最近期限那張；3 天內琥珀、逾期紅', () => {
      expect(payStrip([inv({ status: 'paid' })], TODAY)).toBeNull();
      expect(
        payStrip([inv({ dueDate: '2026-11-30' }), inv({ dueDate: '2026-10-24' })], TODAY),
      ).toEqual({
        due: '2026-10-24',
        items: 0,
        tag: { tone: 'warn', label: '2 天後到期' },
      });
      expect(payStrip([inv({ dueDate: '2026-10-20' })], TODAY)?.tag).toEqual({
        tone: 'error',
        label: '逾期 2 天',
      });
      expect(payStrip([inv({ dueDate: '2026-10-30' })], TODAY)?.tag).toBeNull();
    });
  });

  it('latestLogs：每班最新一篇，新到舊', () => {
    const logs = latestLogs([
      { id: '1', classId: 'a', className: 'A', logDate: '2026-10-20', homework: 'x' },
      { id: '2', classId: 'a', className: 'A', logDate: '2026-10-21', homework: 'y' },
      { id: '3', classId: 'b', className: 'B', logDate: '2026-10-19', homework: 'z' },
    ]);
    expect(logs.map((l) => l.id)).toEqual(['2', '3']);
  });

  it('recommendations：同年級沒報的取 3；同年級的沒有就補別的；slotsLabel', () => {
    const c = (id: string, over: Partial<ParentCatalogClass> = {}): ParentCatalogClass => ({
      classId: id,
      className: id,
      gradeLevels: [],
      courseId: null,
      courseName: null,
      subject: null,
      courseDescription: null,
      campusName: null,
      slots: [{ weekday: 3, startTime: '18:00:00', endTime: '20:00:00' }],
      maxStudents: 20,
      remainingSeats: 5,
      fee: null,
      isRecommended: false,
      teacherNames: [],
      matchesGrade: true,
      enrolled: false,
      conflictsWith: null,
      ...over,
    });
    expect(
      recommendations([c('a', { enrolled: true }), c('b'), c('c'), c('d'), c('e')]).map(
        (x) => x.classId,
      ),
    ).toEqual(['b', 'c', 'd']);
    expect(recommendations([c('x', { matchesGrade: false })]).map((x) => x.classId)).toEqual(['x']);
    expect(slotsLabel(c('a'))).toBe('週三 18:00–20:00');
  });
});

/** #1837 二讀：邊界照 ±1 給 fixture —— 每一條都對應一個原本存活的突變 */
describe('dashboard.util 邊界（#1837 二讀）', () => {
  const inv = (dueDate: string): ParentInvoice => ({
    id: 'i',
    invoiceNo: null,
    issuedAt: '2026-10-01',
    dueDate,
    status: 'unpaid',
    voidedAt: null,
    total: 5000,
    netPaid: 0,
    items: [],
    payments: [],
    createdAt: '2026-10-01',
  });
  const labels = (r: { tags: readonly { label: string }[] }) => r.tags.map((t) => t.label);

  it('剛好及格線（60／100）不是不及格；59 才是', () => {
    const [ok] = examRows([score({ score: 60 })], [], TODAY);
    const [fail] = examRows([score({ score: 59 })], [], TODAY);
    expect(labels(ok)).not.toContain('不及格');
    expect(labels(fail)).toContain('不及格');
  });

  it('及格線是滿分六成「進位」：7 分制及格 5 分，考 4 分不及格', () => {
    const [row] = examRows([score({ score: 4, totalScore: 7 })], [], TODAY);
    expect(row.meta).toBe('及格 5 分');
    expect(labels(row)).toContain('不及格');
  });

  it('今天到期是「今天到期」琥珀，不是逾期；昨天才是逾期 1 天', () => {
    expect(payStrip([inv(TODAY)], TODAY)?.tag).toEqual({ tone: 'warn', label: '今天到期' });
    expect(payStrip([inv('2026-10-21')], TODAY)?.tag).toEqual({
      tone: 'error',
      label: '逾期 1 天',
    });
  });

  it('第 3 天到期有琥珀；第 4 天沒有', () => {
    expect(payStrip([inv('2026-10-25')], TODAY)?.tag).toEqual({
      tone: 'warn',
      label: '3 天後到期',
    });
    expect(payStrip([inv('2026-10-26')], TODAY)?.tag).toBeNull();
  });

  it('第 7 天登錄的成績還是「新成績」；第 8 天不是', () => {
    const [d7] = examRows([score({ createdAt: '2026-10-15T04:00:00Z' })], [], TODAY);
    const [d8] = examRows([score({ createdAt: '2026-10-14T04:00:00Z' })], [], TODAY);
    expect(labels(d7)).toContain('新成績');
    expect(labels(d8)).not.toContain('新成績');
  });

  it('「新成績」用台北日期：台北 10-15 早上 7 點（UTC 10-14）登錄的，第 7 天仍是新成績', () => {
    const [row] = examRows([score({ createdAt: '2026-10-14T23:00:00Z' })], [], TODAY);
    expect(labels(row)).toContain('新成績');
  });

  it('第 7 天要考的會列；第 8 天不列', () => {
    const rows = examRows(
      [],
      [
        ses('2026-10-29', { examNames: ['第 7 天'] }),
        ses('2026-10-30', { examNames: ['第 8 天'] }),
      ],
      TODAY,
    );
    expect(rows.map((r) => r.title)).toEqual(['國三數學 · 第 7 天']);
  });

  it('停課那堂的考試不列', () => {
    const rows = examRows(
      [],
      [ses('2026-10-24', { status: 'cancelled', examNames: ['小考'] })],
      TODAY,
    );
    expect(rows).toEqual([]);
  });

  it('今天沒課：第 3 天的課要列，第 4 天的不列', () => {
    const { rows } = shownSessions([ses('2026-10-25'), ses('2026-10-26')], TODAY);
    expect(rows.map((s) => s.date)).toEqual(['2026-10-25']);
  });

  it('兩堂只請了一堂 → 不是「今天請假」', () => {
    const daily = new Set(['campus-1']);
    const leave = { status: 'on_leave' as const, checkedInAt: null };
    expect(
      arrivalLine(
        [ses(TODAY, { attendance: leave }), ses(TODAY, { startTime: '19:00:00' })],
        undefined,
        daily,
        '15:00',
      ),
    ).toBe('還沒到，17:00 有課。');
  });

  it('剛好上課那分鐘還沒刷卡 → 「還沒到班。」，不是「還沒到，17:00 有課」', () => {
    expect(arrivalLine([ses(TODAY)], undefined, new Set(['campus-1']), '17:00')).toBe('還沒到班。');
  });

  it('推薦：同年級只有 1 班就只給 1 班，不補別的年級（同 A6）；一班都沒有才給別的', () => {
    const c = (id: string, matchesGrade: boolean) =>
      ({ classId: id, matchesGrade, enrolled: false }) as ParentCatalogClass;
    expect(
      recommendations([c('a', true), c('x', false), c('y', false)]).map((r) => r.classId),
    ).toEqual(['a']);
    expect(recommendations([c('x', false), c('y', false)]).map((r) => r.classId)).toEqual([
      'x',
      'y',
    ]);
  });
});
