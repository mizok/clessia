import {
  AMBIGUOUS_GROUP_KEYS,
  isAmbiguousKey,
  defaultRange,
  groupKeyLabel,
  splitBilled,
} from './reports.util';

describe('isAmbiguousKey', () => {
  // 這三個字串是跟後端的契約（routes/reports.ts 的常數），寫在一個地方才改得動
  it('認得三個明標模糊的桶', () => {
    expect(isAmbiguousKey('（跨分校）')).toBe(true);
    expect(isAmbiguousKey('（跨課程）')).toBe(true);
    expect(isAmbiguousKey('（未分類）')).toBe(true);
  });

  it('三個常數與判斷一致', () => {
    for (const key of AMBIGUOUS_GROUP_KEYS) {
      expect(isAmbiguousKey(key)).toBe(true);
    }
  });

  it('一般的分校名不是模糊桶', () => {
    expect(isAmbiguousKey('中山校')).toBe(false);
  });

  // 月份分組不會有模糊桶 —— 一張帳單只有一個開帳日
  it('月份不是模糊桶', () => {
    expect(isAmbiguousKey('2026-08')).toBe(false);
  });

  // 半形括號的同名分校不該被誤判成系統桶
  it('半形括號的同名字串不算', () => {
    expect(isAmbiguousKey('(跨分校)')).toBe(false);
  });
});

describe('groupKeyLabel', () => {
  it('月份補上「月」讓它讀起來像日期不是代碼', () => {
    expect(groupKeyLabel('2026-08', 'month')).toBe('2026 年 8 月');
  });

  it('跨年的月份也對', () => {
    expect(groupKeyLabel('2027-01', 'month')).toBe('2027 年 1 月');
  });

  it('分校與課程照原樣顯示', () => {
    expect(groupKeyLabel('中山校', 'campus')).toBe('中山校');
    expect(groupKeyLabel('國三數學', 'course')).toBe('國三數學');
  });

  // 模糊桶在月份分組不會出現，但別的分組下要原樣顯示不要被加工
  it('模糊桶原樣顯示', () => {
    expect(groupKeyLabel('（跨分校）', 'campus')).toBe('（跨分校）');
  });

  // 後端若回了非預期格式，原樣顯示比爆掉或顯示 NaN 好
  it('不是月份格式的字串在 month 分組下原樣顯示', () => {
    expect(groupKeyLabel('（未分類）', 'month')).toBe('（未分類）');
  });
});

describe('defaultRange', () => {
  it('這個月一號到今天', () => {
    expect(defaultRange('2026-08-30')).toEqual({ from: '2026-08-01', to: '2026-08-30' });
  });

  it('月初當天的區間是同一天', () => {
    expect(defaultRange('2026-08-01')).toEqual({ from: '2026-08-01', to: '2026-08-01' });
  });

  it('跨年的一月也對', () => {
    expect(defaultRange('2027-01-15')).toEqual({ from: '2027-01-01', to: '2027-01-15' });
  });
});

describe('splitBilled', () => {
  it('已收回 + 未收 = 開帳', () => {
    const s = splitBilled({ billed: 1000, outstanding: 250, overdueOutstanding: 100 });
    expect(s.collected).toBe(750);
    expect(s.collectedPct).toBe(75);
    expect(s.overduePct).toBe(10);
  });

  it('沒有開帳時不畫任何段', () => {
    expect(splitBilled({ billed: 0, outstanding: 0, overdueOutstanding: 0 })).toEqual({
      collectedPct: 0,
      overduePct: 0,
      collected: 0,
    });
  });

  // 溢繳會讓 outstanding 變負數，夾住才不會畫出超過 100% 的條
  it('溢繳（outstanding 為負）時已收回不超過 100%', () => {
    const s = splitBilled({ billed: 1000, outstanding: -200, overdueOutstanding: 0 });
    expect(s.collectedPct).toBe(100);
    expect(s.collected).toBe(1000);
  });

  it('逾期不會超過未收的部分', () => {
    const s = splitBilled({ billed: 1000, outstanding: 100, overdueOutstanding: 400 });
    expect(s.overduePct).toBe(10);
  });

  it('全部未收時已收回是 0', () => {
    const s = splitBilled({ billed: 500, outstanding: 500, overdueOutstanding: 500 });
    expect(s.collectedPct).toBe(0);
    expect(s.overduePct).toBe(100);
  });
});
