import { describe, expect, it } from 'vitest';

import {
  ENROLLMENT_EVENT_KINDS,
  buildPeriodFilter,
  buildSelect,
  eventFilter,
  sortColumn,
} from './list-query';

const TODAY = '2026-10-10';

describe('eventFilter（#1507：計數與列表共用的事件判準）', () => {
  it('新報名只看 effective_from，不論現在狀態 —— 報了又退也算一次新報名', () => {
    expect(eventFilter('joined', '2026-08-01', '2026-08-31', TODAY)).toBe(
      'and(effective_from.gte.2026-08-01,effective_from.lte.2026-08-31)',
    );
  });

  // 計畫席 10-10 裁：active 的 effective_to 過了就離開名冊（today-attendance 等同判準），到期也算退班
  it('退班＝effective_to 在期間內且不是作廢（辦理退班與到期結束都算）', () => {
    expect(eventFilter('left', '2026-08-01', '2026-08-31', TODAY)).toBe(
      'and(status.neq.void,effective_to.gte.2026-08-01,effective_to.lte.2026-08-31)',
    );
  });

  it('期間迄日在未來時，退班只算到今天 —— 排定日還沒到的人還沒走', () => {
    expect(eventFilter('left', '2026-10-01', '2026-10-31', TODAY)).toBe(
      'and(status.neq.void,effective_to.gte.2026-10-01,effective_to.lte.2026-10-10)',
    );
    expect(eventFilter('left', undefined, undefined, TODAY)).toBe(
      'and(status.neq.void,effective_to.lte.2026-10-10)',
    );
  });

  it('作廢看 effective_to、暫停看 status_changed_at，都要配狀態', () => {
    expect(eventFilter('voided', '2026-08-01', '2026-08-31', TODAY)).toBe(
      'and(status.eq.void,effective_to.gte.2026-08-01,effective_to.lte.2026-08-31)',
    );
    expect(eventFilter('paused', '2026-08-01', undefined, TODAY)).toBe(
      'and(status.eq.suspended,status_changed_at.gte.2026-08-01)',
    );
  });

  it('沒給期間時：新報名不篩，其他只比狀態', () => {
    expect(eventFilter('joined', undefined, undefined, TODAY)).toBeNull();
    expect(eventFilter('paused', undefined, undefined, TODAY)).toBe('status.eq.suspended');
  });
});

describe('buildPeriodFilter', () => {
  it('期間內的列＝四種事件的聯集', () => {
    expect(buildPeriodFilter('2026-08-01', '2026-08-31', TODAY)).toBe(
      ENROLLMENT_EVENT_KINDS.map((kind) =>
        eventFilter(kind, '2026-08-01', '2026-08-31', TODAY),
      ).join(','),
    );
  });

  // 原本結束分支不看狀態也不看今天：排定 effective_to 落在期間內的在籍生會被列進來、標成新報名
  it('排定日還沒到的在籍生不在進出總覽裡', () => {
    const filter = buildPeriodFilter('2026-10-01', '2026-10-31', TODAY) ?? '';

    // 唯一不配狀態、看 effective_to 的分支是退班，它的迄日要截到今天
    expect(filter).toContain(
      'and(status.neq.void,effective_to.gte.2026-10-01,effective_to.lte.2026-10-10)',
    );
    expect(filter).not.toMatch(/(^|,)and\(effective_to/);
  });

  it('只給起日時每個欄位都只比起日', () => {
    expect(buildPeriodFilter('2026-08-01', undefined, TODAY)).toBe(
      'effective_from.gte.2026-08-01,' +
        'and(status.neq.void,effective_to.gte.2026-08-01,effective_to.lte.2026-10-10),' +
        'and(status.eq.suspended,status_changed_at.gte.2026-08-01),' +
        'and(status.eq.void,effective_to.gte.2026-08-01)',
    );
  });

  // 期間清空 = 看全部在籍，不是看空清單
  it('沒有期間就不篩', () => {
    expect(buildPeriodFilter(undefined, undefined, TODAY)).toBeNull();
  });
});

describe('buildSelect', () => {
  // 少了 !inner 的話 campus 篩選不會排除任何列，只會讓班級欄位變成空白。
  // **參數是「這次會不會下分校條件」，不是「使用者有沒有傳 campusId」**（#815）
  it('會下分校條件時 classes 必須是 inner join', () => {
    expect(buildSelect(true)).toContain('classes!inner(');
  });

  it('沒有分校條件時維持一般關聯', () => {
    const select = buildSelect();

    expect(select).toContain('classes(');
    expect(select).not.toContain('!inner(');
  });

  it('兩種情況取得的欄位一樣', () => {
    expect(buildSelect(true).replace('classes!inner', 'classes')).toBe(buildSelect());
  });
});

describe('sortColumn', () => {
  // 班級花名冊與學生在籍清單都吃這支 API，預設不能改
  it('預設是 created_at', () => {
    expect(sortColumn()).toBe('created_at');
    expect(sortColumn('createdAt')).toBe('created_at');
  });

  it('進出總覽要 updated_at', () => {
    expect(sortColumn('updatedAt')).toBe('updated_at');
  });
});

/**
 * `hasInvoice` 的兩個方向用**不同的 join** —— 這是這條篩選唯一容易寫錯的地方：
 * `true` 用 `!inner`（只留下有帳單項目的），`false` 用 left join 再配
 * `invoice_items=is.null`。少了 `!inner`，`true` 會把所有報名都留下來，
 * 只是關聯欄位變成空陣列 —— 看起來像「篩選壞掉」但不會報錯。
 */
describe('buildSelect 的 hasInvoice', () => {
  it('不指定就完全不碰帳單關聯', () => {
    expect(buildSelect()).not.toContain('invoice_items');
  });

  it('要「有帳單」時用 inner join', () => {
    expect(buildSelect(false, true)).toContain(
      'invoice_items!inner(id, invoices!inner(voided_at))',
    );
  });

  it('要「沒帳單」時用 left join（過濾靠 is.null，不是 join）', () => {
    const select = buildSelect(false, false);
    expect(select).toContain('invoice_items(id, invoices!inner(voided_at))');
    expect(select).not.toContain('invoice_items!inner');
  });

  /**
   * #898：作廢單上的明細**不算開過帳** —— 作廢 = 收費項回到未開帳（裁決 B），
   * 所以「未開帳」清單要把它列回來。兩個方向都帶上帳單的 voided_at，
   * 過濾（`invoice_items.invoices.voided_at is null`）下在路由上。
   */
  it('兩個方向都帶上帳單的作廢狀態（#898）', () => {
    expect(buildSelect(false, true)).toContain('invoices!inner(voided_at)');
    expect(buildSelect(false, false)).toContain('invoices!inner(voided_at)');
  });

  it('跟 campusId 的 inner join 並存', () => {
    const select = buildSelect(true, true);
    expect(select).toContain('classes!inner');
    expect(select).toContain('invoice_items!inner');
  });
});
