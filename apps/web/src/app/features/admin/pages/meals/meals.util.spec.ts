import {
  changedCount,
  chapterOrdered,
  draftSnapshot,
  mealDayChapters,
  unhandledCount,
  weekdayLabel,
  draftToBatchRows,
  draftTotals,
  mealChapters,
  monthDay,
  rosterToDraft,
} from './meals.util';
import type { MealRosterRow } from '@core/meals.service';

function row(overrides: Partial<MealRosterRow> = {}): MealRosterRow {
  return {
    studentId: 's1',
    studentName: '陳小明',
    classNames: [],
    mealDate: '2026-08-30',
    mealDefault: false,
    note: null,
    recordId: null,
    ordered: null,
    chargeable: null,
    unitPrice: null,
    settled: false,
    ...overrides,
  };
}

describe('rosterToDraft', () => {
  // 「還沒處理」的列要落在學生自己的 opt-in 預設上，那是候選名單的意義
  it('沒有記錄時用 mealDefault 當訂餐預設', () => {
    const [draft] = rosterToDraft([row({ mealDefault: true })], 60);

    expect(draft.ordered).toBe(true);
    expect(draft.unitPrice).toBe(60);
  });

  it('沒有記錄且不訂餐的預設是不勾', () => {
    const [draft] = rosterToDraft([row({ mealDefault: false })], 60);

    expect(draft.ordered).toBe(false);
  });

  // 有記錄就以記錄為準 —— mealDefault 只影響還沒處理過的
  it('有記錄時用記錄的值，不看 mealDefault', () => {
    const [draft] = rosterToDraft(
      [
        row({
          mealDefault: true,
          recordId: 'r1',
          ordered: false,
          chargeable: false,
          unitPrice: 55,
        }),
      ],
      60,
    );

    expect(draft.ordered).toBe(false);
    expect(draft.chargeable).toBe(false);
    expect(draft.unitPrice).toBe(55);
  });

  // 便當漲價不該改到歷史記錄 —— 單價存在每一筆上，只有新記錄才吃 org 預設
  it('已有單價時不被 org 預設覆蓋，即使是 0', () => {
    const [draft] = rosterToDraft([row({ recordId: 'r1', ordered: true, unitPrice: 0 })], 60);

    expect(draft.unitPrice).toBe(0);
  });

  it('收費預設是要收', () => {
    const [draft] = rosterToDraft([row()], 60);

    expect(draft.chargeable).toBe(true);
  });

  it('已結算的列標成鎖住', () => {
    const [draft] = rosterToDraft([row({ recordId: 'r1', ordered: true, settled: true })], 60);

    expect(draft.settled).toBe(true);
  });

  // 「沒訂」與「沒人處理」是行政真的會問的差別
  it('保留 recordId 以區分沒訂與沒處理', () => {
    const [untouched, declined] = rosterToDraft(
      [row({ studentId: 's1' }), row({ studentId: 's2', recordId: 'r2', ordered: false })],
      60,
    );

    expect(untouched.recordId).toBeNull();
    expect(declined.recordId).toBe('r2');
  });
});

describe('draftTotals', () => {
  it('空名單三個數字都是零', () => {
    expect(draftTotals([])).toEqual({ ordered: 0, chargeable: 0, amount: 0 });
  });

  it('只算訂了的份數', () => {
    const draft = rosterToDraft(
      [
        row({ studentId: 's1', mealDefault: true }),
        row({ studentId: 's2', mealDefault: true }),
        row({ studentId: 's3', mealDefault: false }),
      ],
      60,
    );

    expect(draftTotals(draft).ordered).toBe(2);
  });

  // 訂了但不收費（便當送到了才請假）—— 份數要算，金額不能算
  it('訂了但不收費的算份數不算金額', () => {
    const draft = rosterToDraft(
      [
        row({ studentId: 's1', recordId: 'r1', ordered: true, chargeable: true, unitPrice: 60 }),
        row({ studentId: 's2', recordId: 'r2', ordered: true, chargeable: false, unitPrice: 60 }),
      ],
      60,
    );

    expect(draftTotals(draft)).toEqual({ ordered: 2, chargeable: 1, amount: 60 });
  });

  // 沒訂的即使 chargeable 是 true 也不該算錢 —— 沒有便當就沒有費用
  it('沒訂的不算金額，即使收費開關是開的', () => {
    const draft = rosterToDraft(
      [row({ recordId: 'r1', ordered: false, chargeable: true, unitPrice: 60 })],
      60,
    );

    expect(draftTotals(draft)).toEqual({ ordered: 0, chargeable: 0, amount: 0 });
  });

  it('單價各自不同時金額分別加總', () => {
    const draft = rosterToDraft(
      [
        row({ studentId: 's1', recordId: 'r1', ordered: true, chargeable: true, unitPrice: 60 }),
        row({ studentId: 's2', recordId: 'r2', ordered: true, chargeable: true, unitPrice: 75 }),
      ],
      60,
    );

    expect(draftTotals(draft).amount).toBe(135);
  });
});

describe('draftToBatchRows', () => {
  it('送出訂餐、收費與單價', () => {
    const draft = rosterToDraft([row({ mealDefault: true })], 60);

    expect(draftToBatchRows(draft)).toEqual([
      { studentId: 's1', ordered: true, chargeable: true, unitPrice: 60, note: null },
    ]);
  });

  // 已結算的後端本來就會擋（回 lockedStudentIds），前端先不送省一趟無效寫入
  it('已結算的不送出', () => {
    const draft = rosterToDraft(
      [
        row({ studentId: 's1', mealDefault: true }),
        row({ studentId: 's2', recordId: 'r2', ordered: true, settled: true }),
      ],
      60,
    );

    expect(draftToBatchRows(draft).map((r) => r.studentId)).toEqual(['s1']);
  });

  // 沒訂的也要送 —— 明確記一筆 ordered: false 比「沒有列」好查
  it('沒訂的也送出，不是略過', () => {
    const draft = rosterToDraft([row({ mealDefault: false })], 60);

    expect(draftToBatchRows(draft)).toEqual([
      { studentId: 's1', ordered: false, chargeable: true, unitPrice: 60, note: null },
    ]);
  });
});

describe('rosterToDraft —— 備註與班級', () => {
  it('沒有記錄時備註是空字串，不是 null', () => {
    const [draft] = rosterToDraft([row()], 60);

    expect(draft.note).toBe('');
  });

  it('有記錄時帶出既有備註', () => {
    const [draft] = rosterToDraft([row({ recordId: 'r1', ordered: true, note: '素食' })], 60);

    expect(draft.note).toBe('素食');
  });

  // 一天一筆便當不分班，班名只是脈絡 —— 跟聯絡簿的多班並列同一個道理
  it('多個班的班名並列', () => {
    const [draft] = rosterToDraft([row({ classNames: ['三年級數學', '三年級英文'] })], 60);

    expect(draft.classLabel).toBe('三年級數學、三年級英文');
  });

  // 區間模式後端刻意回空陣列（沒有「候選」的概念）—— 不要顯示成空白格
  it('沒有班級時給一個破折號，不是空字串', () => {
    const [draft] = rosterToDraft([row({ classNames: [] })], 60);

    expect(draft.classLabel).toBe('—');
  });
});

describe('draftToBatchRows —— 備註', () => {
  it('有備註就送出', () => {
    const draft = rosterToDraft([row({ recordId: 'r1', ordered: true, note: '素食' })], 60);

    expect(draftToBatchRows(draft)[0].note).toBe('素食');
  });

  // 清空備註要送 null 才清得掉；送 undefined 後端會當成「沒給」而保留原值
  it('清空的備註送 null 不是 undefined', () => {
    const draft = rosterToDraft([row({ recordId: 'r1', ordered: true, note: '素食' })], 60);
    draft[0].note = '   ';

    expect(draftToBatchRows(draft)[0].note).toBeNull();
  });
});

describe('mealChapters', () => {
  const draft = (id: string, classNames: string[]) =>
    rosterToDraft([row({ studentId: id, studentName: id, classNames })], 60)[0];

  it('一人多班只出現一次，歸在排序後第一個班', () => {
    const chapters = mealChapters([draft('a', ['英文', '數學'])]);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].name).toBe(
      ['英文', '數學'].sort((x, y) => x.localeCompare(y, 'zh-Hant'))[0],
    );
  });

  it('沒班級的章放最後，章內保留原順序', () => {
    const chapters = mealChapters([draft('x', []), draft('b', ['數學']), draft('c', ['數學'])]);
    expect(chapters.map((c) => c.name)).toEqual(['數學', '']);
    expect(chapters[0].rows.map((r) => r.studentId)).toEqual(['b', 'c']);
  });
});

describe('chapterOrdered —— 章頭「訂 N／M」的分子', () => {
  const rows = (flags: boolean[]) =>
    rosterToDraft(
      flags.map((ordered, i) =>
        row({ studentId: `s${i}`, recordId: `r${i}`, ordered, chargeable: true, unitPrice: 60 }),
      ),
      60,
    );

  it('0 位／部分／全部訂（門檻 ±1）', () => {
    expect(chapterOrdered(rows([false, false]))).toBe(0);
    expect(chapterOrdered(rows([true, false]))).toBe(1);
    expect(chapterOrdered(rows([true, true]))).toBe(2);
    expect(chapterOrdered(rows([]))).toBe(0);
  });
});

describe('monthDay —— A6 不補零', () => {
  it('月日各一位／兩位四種組合', () => {
    expect(monthDay('2026-09-05')).toBe('9/5');
    expect(monthDay('2026-09-15')).toBe('9/15');
    expect(monthDay('2026-10-05')).toBe('10/5');
    expect(monthDay('2026-10-15')).toBe('10/15');
  });
});

describe('changedCount／draftSnapshot（確認列「改了 N 位」）', () => {
  const draft = () =>
    rosterToDraft(
      [
        row({ studentId: 'a', recordId: 'r', ordered: true, chargeable: true, unitPrice: 60 }),
        row({ studentId: 'b', recordId: 'r', ordered: true, chargeable: true, unitPrice: 60 }),
      ],
      60,
    );

  it('沒動 → 0；改一個欄位 → 1；兩列都改 → 2（門檻 ±1）', () => {
    const rows = draft();
    const base = draftSnapshot(rows);
    expect(changedCount(rows, base)).toBe(0);
    expect(changedCount([{ ...rows[0], unitPrice: 61 }, rows[1]], base)).toBe(1);
    expect(
      changedCount(
        rows.map((r) => ({ ...r, unitPrice: 61 })),
        base,
      ),
    ).toBe(2);
  });

  it.each([
    ['ordered', false],
    ['chargeable', false],
    ['unitPrice', 61],
    ['note', '素食'],
  ] as const)('四個可編輯欄位任一個改了都算：%s', (field, value) => {
    const rows = draft();
    expect(changedCount([{ ...rows[0], [field]: value }, rows[1]], draftSnapshot(rows))).toBe(1);
  });

  it('改回原值＝沒改；已結算的列不算', () => {
    const rows = draft();
    const base = draftSnapshot(rows);
    expect(
      changedCount(
        [{ ...rows[0], unitPrice: 61 }, rows[1]].map((r, i) =>
          i === 0 ? { ...r, unitPrice: 60 } : r,
        ),
        base,
      ),
    ).toBe(0);
    expect(changedCount([{ ...rows[0], unitPrice: 61, settled: true }, rows[1]], base)).toBe(0);
  });

  it('快照裡沒有的列（新出現的）算改過', () => {
    const rows = draft();
    expect(changedCount(rows, new Map())).toBe(2);
  });
});

describe('unhandledCount', () => {
  it('只數沒記錄且沒鎖住的', () => {
    const rows = rosterToDraft(
      [
        row({ studentId: 'a' }),
        row({ studentId: 'b', recordId: 'r', ordered: true }),
        row({ studentId: 'c', settled: true }),
      ],
      60,
    );
    expect(unhandledCount(rows)).toBe(1);
  });
});

describe('mealDayChapters／weekdayLabel（區間依日分章）', () => {
  it('依日期新到舊，同一天的列維持原順序', () => {
    const rows = rosterToDraft(
      [
        row({ studentId: 'a', mealDate: '2026-10-11' }),
        row({ studentId: 'b', mealDate: '2026-10-14' }),
        row({ studentId: 'c', mealDate: '2026-10-14' }),
      ],
      60,
    );
    const chapters = mealDayChapters(rows);
    expect(chapters.map((c) => c.date)).toEqual(['2026-10-14', '2026-10-11']);
    expect(chapters[0].rows.map((r) => r.studentId)).toEqual(['b', 'c']);
  });

  it('週幾：週日、週一邊界與跨年', () => {
    expect(weekdayLabel('2026-10-11')).toBe('日');
    expect(weekdayLabel('2026-10-12')).toBe('一');
    expect(weekdayLabel('2026-10-14')).toBe('三');
    expect(weekdayLabel('2027-01-01')).toBe('五');
  });
});
