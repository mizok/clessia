import { inUseLabel, periodUsageLabel } from './fee-templates.util';

describe('fee-templates.util（#1314 F1／F4）', () => {
  it('inUseLabel：有引用寫筆數，沒有引用寫 —', () => {
    expect(inUseLabel(3)).toBe('3 筆報名');
    expect(inUseLabel(1001)).toBe('1001 筆報名');
    expect(inUseLabel(0)).toBe('—');
  });

  it('periodUsageLabel：有重疊寫「在此期間」，沒有重疊明講沒有；兩句都不提刪除', () => {
    expect(periodUsageLabel(2)).toBe('2 筆報名在此期間');
    expect(periodUsageLabel(0)).toBe('沒有報名在此期間');
    expect(periodUsageLabel(2) + periodUsageLabel(0)).not.toMatch(/刪|不能|無法/);
  });
});
