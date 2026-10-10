import { amountUnit, inUseLabel, overlappingNames, periodUsageLabel } from './fee-templates.util';

describe('fee-templates.util（#1314 F1／F4）', () => {
  it('inUseLabel：有引用寫「N 筆報名在用」，沒有引用寫「還沒有報名用它」', () => {
    expect(inUseLabel(3)).toBe('3 筆報名在用');
    expect(inUseLabel(1001)).toBe('1001 筆報名在用');
    expect(inUseLabel(0)).toBe('還沒有報名用它');
  });

  it('amountUnit：月繳／月、期繳／期、堂數制不加單位', () => {
    expect(amountUnit('monthly')).toBe('／月');
    expect(amountUnit('period')).toBe('／期');
    expect(amountUnit('session_pack')).toBe('');
  });

  /** F5：重疊只是提醒。邊界日也算重疊（同一天同時在兩個期間裡） */
  it('overlappingNames：區間有交集才算，頭尾同一天也算，不含自己', () => {
    const p = (id: string, startDate: string, endDate: string) => ({
      id,
      name: id,
      startDate,
      endDate,
    });
    const all = [
      p('上學期', '2026-09-01', '2027-01-31'),
      p('暑假', '2026-07-01', '2026-08-31'),
      p('合併期', '2026-07-01', '2027-01-31'),
      p('下學期', '2027-01-31', '2027-06-30'),
    ];
    expect(overlappingNames(all[0], all)).toEqual(['合併期', '下學期']);
    expect(overlappingNames(all[1], all)).toEqual(['合併期']);
    expect(overlappingNames(p('x', '2030-01-01', '2030-02-01'), all)).toEqual([]);
  });

  it('periodUsageLabel：有重疊寫「在此期間」，沒有重疊明講沒有；兩句都不提刪除', () => {
    expect(periodUsageLabel(2)).toBe('2 筆報名在此期間');
    expect(periodUsageLabel(0)).toBe('沒有報名在此期間');
    expect(periodUsageLabel(2) + periodUsageLabel(0)).not.toMatch(/刪|不能|無法/);
  });
});
