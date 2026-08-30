import { rosterToDraft, draftTotals, draftToBatchRows } from './meals.util';
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
