import { describe, expect, it } from 'vitest';
import { computeColumnVisibility } from './responsive-table.utils';
import type { ResponsiveTableColumn } from './responsive-table.models';

describe('computeColumnVisibility', () => {
  const columns: readonly ResponsiveTableColumn[] = [
    { key: 'name', label: '姓名', minWidth: 160, priority: 1, collapsible: false },
    { key: 'grade', label: '年級', minWidth: 120, priority: 2, collapsible: true },
    { key: 'phone', label: '電話', minWidth: 160, priority: 3, collapsible: true },
    { key: 'address', label: '地址', minWidth: 220, priority: 4, collapsible: true },
  ];

  it('keeps all columns when container width is enough', () => {
    const result = computeColumnVisibility(columns, 900, 40);

    expect(result.visibleColumns.map((column) => column.key)).toEqual([
      'name',
      'grade',
      'phone',
      'address',
    ]);
    expect(result.collapsedColumns).toEqual([]);
  });

  it('collapses lowest-priority collapsible columns first', () => {
    const result = computeColumnVisibility(columns, 470, 40);

    expect(result.visibleColumns.map((column) => column.key)).toEqual(['name', 'grade']);
    expect(result.collapsedColumns.map((column) => column.key)).toEqual(['phone', 'address']);
  });

  it('preserves all non-collapsible columns even when width is insufficient', () => {
    const columns: readonly ResponsiveTableColumn[] = [
      { key: 'name', label: '姓名', minWidth: 260, priority: 1, collapsible: false },
      { key: 'class', label: '班級', minWidth: 240, priority: 2, collapsible: false },
      { key: 'phone', label: '電話', minWidth: 160, priority: 3, collapsible: true },
    ];

    const result = computeColumnVisibility(columns, 120, 40);

    expect(result.visibleColumns.map((column) => column.key)).toEqual(['name', 'class']);
    expect(result.collapsedColumns.map((column) => column.key)).toEqual(['phone']);
  });
});

/**
 * #848：390 寬下 `/admin/fee-templates` 的列上只剩「展開鍵＋定價＋⋮」，
 * **方案名稱被收進展開區** —— 使用者看到一排 4,500 / 24,000 / 6,000 不知道是哪個方案。
 *
 * 成因不是優先序寫錯，是**平手**：`name` 與 `amount` 都是 priority 1，
 * 而收合順序是「優先序由大到小」的穩定排序 —— 平手時**先宣告的先被收掉**，
 * 於是名稱走在定價前面。
 *
 * 修法是加一個「主欄」概念而不是去調那些 priority：
 * priority 講的是「誰比較不重要」，主欄講的是「哪一欄是這筆資料的身分」——
 * **後者不是前者的極端值**，用同一個數字軸表達會在下一張表再撞一次。
 */
describe('computeColumnVisibility —— 主欄永不收合（#848）', () => {
  const feeTemplates: readonly ResponsiveTableColumn[] = [
    { key: 'name', label: '方案名稱', minWidth: 180, priority: 1, collapsible: true },
    { key: 'mode', label: '收費方式', minWidth: 100, priority: 2, collapsible: true },
    { key: 'amount', label: '定價', minWidth: 110, priority: 1, collapsible: true },
    { key: 'status', label: '狀態', minWidth: 80, priority: 3, collapsible: true },
    { key: 'actions', label: '操作', minWidth: 56, priority: 0, collapsible: false },
  ];

  it('宣告順序的第一欄是預設主欄 —— 窄到只剩一欄時留下的是它', () => {
    const result = computeColumnVisibility(feeTemplates, 274, 48);

    expect(result.visibleColumns.map((column) => column.key)).toContain('name');
    expect(result.collapsedColumns.map((column) => column.key)).not.toContain('name');
  });

  it('明確標記的主欄勝過宣告順序 —— 聯絡簿的身分是學生不是日期', () => {
    // `/admin/contact-book` 的宣告順序第一欄是 `date`，而列上該留的是 `student`。
    // 這一列是「預設值會把它改壞」的反例，所以 opt-out 必須存在。
    const contactBook: readonly ResponsiveTableColumn[] = [
      { key: 'date', label: '日期', minWidth: 110, priority: 2, collapsible: true },
      {
        key: 'student',
        label: '學生',
        minWidth: 120,
        priority: 1,
        collapsible: true,
        primary: true,
      },
      { key: 'content', label: '內容', minWidth: 220, priority: 3, collapsible: true },
    ];

    const result = computeColumnVisibility(contactBook, 150, 48);

    expect(result.visibleColumns.map((column) => column.key)).toEqual(['student']);
    expect(result.collapsedColumns.map((column) => column.key)).toEqual(['date', 'content']);
  });

  it('主欄不影響「寬度夠就全部顯示」', () => {
    const result = computeColumnVisibility(feeTemplates, 900, 48);

    expect(result.collapsedColumns).toEqual([]);
  });

  it('第一欄本來就不可收合時，這條規則什麼都不做 —— 不會多釘一根', () => {
    // 操作欄／選取欄排在最前面的表（例如 `/admin/sessions`）走這條。
    // 沒有這一條的話，預設會去釘第一個「可收合」的欄，
    // 於是一個本該收合的欄會留在列上，把窄寬度的版面又撐開一次。
    const actionsFirst: readonly ResponsiveTableColumn[] = [
      { key: 'actions', label: '操作', minWidth: 56, priority: 0, collapsible: false },
      { key: 'name', label: '姓名', minWidth: 160, priority: 1, collapsible: true },
      { key: 'phone', label: '電話', minWidth: 160, priority: 2, collapsible: true },
    ];

    const result = computeColumnVisibility(actionsFirst, 100, 48);

    expect(result.visibleColumns.map((column) => column.key)).toEqual(['actions']);
    expect(result.collapsedColumns.map((column) => column.key)).toEqual(['name', 'phone']);
  });

  it('全部不可收合時主欄不會多做任何事', () => {
    const allPinned: readonly ResponsiveTableColumn[] = [
      { key: 'name', label: '姓名', minWidth: 260, priority: 1, collapsible: false },
      { key: 'class', label: '班級', minWidth: 240, priority: 2, collapsible: false },
    ];

    const result = computeColumnVisibility(allPinned, 100, 48);

    expect(result.visibleColumns.map((column) => column.key)).toEqual(['name', 'class']);
    expect(result.collapsedColumns).toEqual([]);
  });
});
