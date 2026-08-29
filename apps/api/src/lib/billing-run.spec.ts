import { describe, expect, it } from 'vitest';

import { detectMealItemAnomalies, groupByStudent, planTuitionItems } from './billing-run';

const period = { start: '2026-03-01', end: '2026-03-31' };

const candidate = (over: Partial<Parameters<typeof planTuitionItems>[0][number]> = {}) => ({
  enrollmentId: 'e1',
  studentId: 's1',
  fullAmount: 4500,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  ...over,
});

describe('planTuitionItems', () => {
  it('沒開過的報名會被排進來', () => {
    const planned = planTuitionItems([candidate()], new Set(), period);

    expect(planned).toHaveLength(1);
    expect(planned[0]?.amount).toBe(4500);
  });

  /**
   * **學費的冪等靠「查衍生列」** —— 這個報名這個週期有沒有開過帳，去 `invoice_items`
   * 問。跟餐費那套（在來源列上蓋章）是**不同機制**，不能互換：學費沒有「一列來源」，
   * 來源是報名 × 週期。
   */
  it('已經開過的報名不會再開一次', () => {
    expect(planTuitionItems([candidate()], new Set(['e1']), period)).toEqual([]);
  });

  it('插班的排進來時金額已經按比例算好', () => {
    const planned = planTuitionItems(
      [candidate({ fullAmount: 3100, effectiveFrom: '2026-03-12' })],
      new Set(),
      period,
    );

    expect(planned[0]?.amount).toBe(2000);
    expect(planned[0]?.note).toContain('20/31');
  });

  // 這一期完全沒讀就不該有一列 0 元的學費 —— 那會讓帳單上多一行看不懂的東西
  it('比例算出來是 0 的整筆跳過', () => {
    expect(
      planTuitionItems([candidate({ effectiveFrom: '2026-04-01' })], new Set(), period),
    ).toEqual([]);
  });

  it('沒有金額可用的報名跳過（沒設價目表也沒談定金額）', () => {
    expect(planTuitionItems([candidate({ fullAmount: 0 })], new Set(), period)).toEqual([]);
  });
});

describe('groupByStudent', () => {
  // 一生一週期一張帳單：收費袋是一個小孩一袋，多子女合繳也是拆開記（規則 4、6）
  it('同一個學生的多筆明細併成一張', () => {
    const grouped = groupByStudent([
      { studentId: 's1', amount: 100 },
      { studentId: 's2', amount: 200 },
      { studentId: 's1', amount: 300 },
    ]);

    expect(grouped.size).toBe(2);
    expect(grouped.get('s1')).toHaveLength(2);
  });

  it('沒有明細就沒有那個學生 —— 不會開出空帳單', () => {
    expect(groupByStudent([]).size).toBe(0);
  });
});

describe('detectMealItemAnomalies', () => {
  /**
   * 三步式月結（開 0 元 item → 蓋章並 RETURNING → 回填金額）如果死在第 2 步之後、
   * 第 3 步之前，會留下「item 金額對不上已蓋章餐記錄總額」的狀態 —— **少收，而且查得到**。
   *
   * 「查得到」必須是系統性的，所以這個偵測是 run 回應的一部分，不是文件裡的一句話。
   */
  it('金額對不上已蓋章的餐記錄總額 → 異常', () => {
    const anomalies = detectMealItemAnomalies([
      { invoiceItemId: 'i1', itemAmount: 0, stampedTotal: 650 },
      { invoiceItemId: 'i2', itemAmount: 650, stampedTotal: 650 },
    ]);

    expect(anomalies.map((a) => a.invoiceItemId)).toEqual(['i1']);
    expect(anomalies[0]?.expectedAmount).toBe(650);
  });

  it('金額吻合就不是異常', () => {
    expect(
      detectMealItemAnomalies([{ invoiceItemId: 'i1', itemAmount: 650, stampedTotal: 650 }]),
    ).toEqual([]);
  });

  // 多收也是異常 —— 方向相反但一樣要修（例如有人手動改了 item 金額）
  it('item 金額大於蓋章總額也算異常', () => {
    expect(
      detectMealItemAnomalies([{ invoiceItemId: 'i1', itemAmount: 800, stampedTotal: 650 }]),
    ).toHaveLength(1);
  });
});
