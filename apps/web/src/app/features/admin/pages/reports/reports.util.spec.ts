import {
  AMBIGUOUS_GROUP_KEYS,
  isAmbiguousKey,
  defaultRange,
  reportPeriods,
  groupKeyLabel,
  billedShare,
  ambiguousReason,
  sortGroups,
  billedBreakdown,
  revenueHeadline,
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

describe('billedShare（A6 比例條：這組已開帳佔整體幾 %）', () => {
  it('一半、全部、0', () => {
    expect(billedShare(500, 1000)).toBe(50);
    expect(billedShare(1000, 1000)).toBe(100);
    expect(billedShare(0, 1000)).toBe(0);
  });

  it('整體為 0 或負數 → 0，不除以 0（門檻 0／1）', () => {
    expect(billedShare(100, 0)).toBe(0);
    expect(billedShare(100, -5)).toBe(0);
    expect(billedShare(1, 1)).toBe(100);
  });

  it('不可能的組合只做保護：超過整體夾在 100、負的夾在 0', () => {
    expect(billedShare(1001, 1000)).toBe(100);
    expect(billedShare(-1, 1000)).toBe(0);
  });
});

describe('ambiguousReason', () => {
  it('三個模糊桶各有說明；一般名稱沒有', () => {
    for (const key of ['（跨分校）', '（跨課程）', '（未分類）']) {
      expect(ambiguousReason(key)).toEqual(expect.any(String));
    }
    expect(ambiguousReason('文山旗艦校')).toBeNull();
  });
});

describe('reportPeriods', () => {
  const byValue = (today: string, value: string) =>
    reportPeriods(today).find((p) => p.value === value)!;

  it('預設的上個完整月是整月，不含本月', () => {
    expect(byValue('2026-10-10', 'prev1')).toMatchObject({
      label: '9 月',
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('近三個月＝前三個完整月合起來', () => {
    expect(byValue('2026-10-10', 'last3')).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('本月到今天', () => {
    expect(byValue('2026-10-10', 'current')).toMatchObject({
      label: '10 月（到今天）',
      from: '2026-10-01',
      to: '2026-10-10',
    });
  });

  it('跨年：一月看的是去年 12 月，近三個月跨年', () => {
    expect(byValue('2027-01-15', 'prev1')).toMatchObject({ from: '2026-12-01', to: '2026-12-31' });
    expect(byValue('2027-01-15', 'last3')).toMatchObject({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('二月月底照閏年算', () => {
    expect(byValue('2028-03-05', 'prev1').to).toBe('2028-02-29');
    expect(byValue('2027-03-05', 'prev1').to).toBe('2027-02-28');
  });
});

describe('reportPeriods —— 色面句的期間名', () => {
  it('prev／last3／current 各自的 short；本月不帶「（到今天）」', () => {
    const p = (v: string) => reportPeriods('2026-10-10').find((x) => x.value === v)!;
    expect(p('prev1').short).toBe('9 月');
    expect(p('last3').short).toBe('近三個月');
    expect(p('current').short).toBe('10 月');
  });
});

describe('billedBreakdown —— 開帳摘要的占比（0.1 進位、兩塊加起來 100）', () => {
  const f = (billed: number, outstanding: number, overdueOutstanding = 0) =>
    billedBreakdown({ billed, outstanding, overdueOutstanding });

  it('A6 稿的例子：498,600／未收 323,500／逾期 81,350 → 35.1／64.9／16.3', () => {
    expect(f(498600, 323500, 81350)).toMatchObject({
      collected: 175100,
      collectedPct: 35.1,
      outstandingPct: 64.9,
      overduePct: 16.3,
      collectedPctInt: 35,
    });
  });

  it('billed 為 0（或負）→ null：沒有占比，不除以 0', () => {
    expect(f(0, 0)).toBeNull();
    expect(f(-1, 0)).toBeNull();
    expect(f(1, 0)).not.toBeNull(); // billed = 1 是門檻 +1
  });

  it('未收 0（全收回）→ 100.0／0.0；未收 ＝ billed（沒收到）→ 0.0／100.0', () => {
    expect(f(1000, 0)).toMatchObject({
      collectedPct: 100,
      outstandingPct: 0,
      collectedPctInt: 100,
    });
    expect(f(1000, 1000)).toMatchObject({
      collectedPct: 0,
      outstandingPct: 100,
      collectedPctInt: 0,
    });
  });

  it('進位邊界：.05 進位、.049 不進（用整數運算，不靠浮點乘 100）', () => {
    // 49/400 = 12.25% → 小數一位 12.3（.25 進位到 .3，因為是 122.5 → 123）
    expect(f(400, 400 - 49)!.collectedPct).toBe(12.3);
    // 4899/40000 = 12.2475% → 12.2（122.475 → 122）
    expect(f(40000, 40000 - 4899)!.collectedPct).toBe(12.2);
  });

  it('兩塊加起來一定是 100.0（不會各自進位變 99.9／100.1）', () => {
    for (const [b, o] of [
      [3, 1],
      [7, 3],
      [9, 4],
      [400, 351],
      [1000003, 333333],
    ] as const) {
      const s = f(b, o)!;
      expect(Math.round((s.collectedPct + s.outstandingPct) * 10)).toBe(1000);
    }
  });

  it('整數百分比（色面副行）：35.4→35、35.5→36（門檻 ±1）', () => {
    expect(f(1000, 1000 - 354)!.collectedPctInt).toBe(35);
    expect(f(1000, 1000 - 355)!.collectedPctInt).toBe(36);
  });

  it('溢繳（未收為負）夾住：不會出現超過 100%', () => {
    expect(f(1000, -200)).toMatchObject({ collectedPct: 100, outstandingPct: 0 });
  });

  it('逾期超過未收的不可能組合只做保護：夾到未收', () => {
    expect(f(1000, 100, 400)!.overduePct).toBe(10);
  });
});

describe('revenueHeadline —— 色面句', () => {
  const fig = (billed: number, outstanding: number, overdueOutstanding = 0) => ({
    billed,
    outstanding,
    overdueOutstanding,
  });

  it('A6：9 月開帳 NT$ 498,600，／還有 NT$ 323,500 沒收到。＋副行', () => {
    expect(revenueHeadline(fig(498600, 323500, 81350), '9 月')).toEqual({
      first: '9 月開帳 NT$ 498,600，',
      second: '還有 NT$ 323,500 沒收到。',
      sub: '已收回 35%；沒收到的裡面，逾期 NT$ 81,350。',
    });
  });

  it('billed 0 → 「9 月還沒有開帳。」，沒有第二段與副行', () => {
    expect(revenueHeadline(fig(0, 0), '9 月')).toEqual({
      first: '9 月還沒有開帳。',
      second: null,
      sub: null,
    });
  });

  it('未收 0／1（門檻）：0 寫「都收到了。」，1 寫「還有 NT$ 1 沒收到。」', () => {
    expect(revenueHeadline(fig(1000, 0), '近三個月')).toMatchObject({
      first: '近三個月開帳 NT$ 1,000，',
      second: '都收到了。',
      sub: '已收回 100%。',
    });
    expect(revenueHeadline(fig(1000, 1), '9 月').second).toBe('還有 NT$ 1 沒收到。');
  });

  it('逾期 0／1（門檻）：0 寫「沒有逾期。」，1 寫金額', () => {
    expect(revenueHeadline(fig(1000, 500, 0), '9 月').sub).toBe('已收回 50%；沒有逾期。');
    expect(revenueHeadline(fig(1000, 500, 1), '9 月').sub).toBe(
      '已收回 50%；沒收到的裡面，逾期 NT$ 1。',
    );
  });
});

describe('sortGroups（A6 的列順序）', () => {
  const g = (key: string, billed: number) =>
    ({ key, received: 0, refunded: 0, billed, outstanding: 0, overdueOutstanding: 0 }) as never;
  const keys = (list: unknown[]) => (list as { key: string }[]).map((x) => x.key);

  it('一般列依已開帳由大到小；模糊桶一律放最後，即使它金額最大', () => {
    const sorted = sortGroups(
      [g('（跨分校）', 900), g('甲', 100), g('乙', 300), g('（未分類）', 50)],
      'campus',
    );
    expect(keys(sorted)).toEqual(['乙', '甲', '（跨分校）', '（未分類）']);
  });

  it('已開帳相同維持原順序（穩定）；差 1 就分先後', () => {
    expect(keys(sortGroups([g('甲', 100), g('乙', 100)], 'campus'))).toEqual(['甲', '乙']);
    expect(keys(sortGroups([g('甲', 100), g('乙', 101)], 'campus'))).toEqual(['乙', '甲']);
  });

  it('月份新到舊，跨年也對', () => {
    const sorted = sortGroups([g('2026-12', 1), g('2027-01', 1), g('2026-09', 1)], 'month');
    expect(keys(sorted)).toEqual(['2027-01', '2026-12', '2026-09']);
  });

  it('不改傳進來的陣列', () => {
    const input = [g('甲', 1), g('乙', 2)];
    sortGroups(input, 'campus');
    expect(keys(input)).toEqual(['甲', '乙']);
  });
});
