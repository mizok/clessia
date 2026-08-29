/**
 * 每月／每期帳務作業的**規劃**部分 —— 純函式，不碰 DB。
 *
 * ⚠️ **冪等有兩種機制，不能互換。** 這是這支最容易被後人搞混的地方，搞混的後果是
 * 重複收費：
 *
 * | 收費項 | 冪等靠什麼 | 為什麼 |
 * | --- | --- | --- |
 * | **餐費** | 在**來源列**上蓋章（`meal_records.invoice_item_id`） | 來源會被事後修改 —— 「收不收費」是行政可翻的人工開關（meal-rules 規則 3）。不蓋章的話結算後有人翻開關，下次 run 的加總就變了，而沒有人查得出來差在哪 |
 * | **學費** | 查**衍生列**（`invoice_items` 有沒有這個報名 × 這個週期） | 學費沒有「一列來源」，來源是報名 × 週期。這就是 grilling 說的「防重複開帳靠週期雙欄」 |
 *
 * 蓋章式的附帶好處是 meal-rules 明講的：**遲補的舊餐記錄下次自動撈進、不會重複收**。
 */

import { prorateByDays, type DateRange } from './proration';

export interface TuitionCandidate {
  enrollmentId: string;
  studentId: string;
  /** `agreed_amount` 優先，沒有才用價目表的定價 */
  fullAmount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PlannedTuitionItem {
  enrollmentId: string;
  studentId: string;
  amount: number;
  note: string | null;
}

/**
 * 這一輪要開哪些學費明細。
 *
 * `alreadyBilledEnrollmentIds` 是「這個週期已經開過帳的報名」—— 查 `invoice_items`
 * 得到的，就是學費那條冪等機制。
 */
export function planTuitionItems(
  candidates: TuitionCandidate[],
  alreadyBilledEnrollmentIds: Set<string>,
  period: DateRange,
): PlannedTuitionItem[] {
  const planned: PlannedTuitionItem[] = [];

  for (const candidate of candidates) {
    if (alreadyBilledEnrollmentIds.has(candidate.enrollmentId)) continue;
    // 沒設價目表也沒談定金額 —— 開一列 0 元只會讓帳單多一行看不懂的東西
    if (candidate.fullAmount <= 0) continue;

    const { amount, note } = prorateByDays(candidate.fullAmount, period, {
      from: candidate.effectiveFrom,
      to: candidate.effectiveTo,
    });

    if (amount <= 0) continue;

    planned.push({
      enrollmentId: candidate.enrollmentId,
      studentId: candidate.studentId,
      amount,
      note,
    });
  }

  return planned;
}

/**
 * 一生一週期一張帳單 —— 收費袋是一個小孩一袋（規則 6），多子女合繳也是拆開記（規則 4）。
 *
 * 沒有明細的學生根本不會出現在結果裡，所以**不會開出空帳單**（空帳單在
 * `deriveInvoiceStatus` 裡是「未繳」，會污染逾期清單）。
 */
export function groupByStudent<T extends { studentId: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const existing = grouped.get(item.studentId);
    if (existing) existing.push(item);
    else grouped.set(item.studentId, [item]);
  }

  return grouped;
}

export interface MealItemCheck {
  invoiceItemId: string;
  itemAmount: number;
  /** 蓋了這個 item 的餐記錄金額總和 */
  stampedTotal: number;
}

export interface MealItemAnomaly extends MealItemCheck {
  expectedAmount: number;
}

/**
 * 餐費 item 的金額對不對得上它蓋章的餐記錄。
 *
 * **這是三步式月結的安全網。** 月結是「開 0 元 item → 蓋章並 RETURNING 金額 →
 * 回填 item 金額」三步（supabase-js 走 HTTP，一次呼叫一個交易，做不到 meal-rules
 * 講的「同一 transaction」）。死在第 2 步之後、第 3 步之前，就會留下金額 0 但已蓋章
 * 的 item —— **少收，永遠不會重複收**（蓋章才是閘門），而且**查得到**。
 *
 * 「查得到」必須是系統性的：這個偵測是 run 回應的一部分，也有可重跑的修補端點，
 * 不是文件裡的一句「記得去查」。
 *
 * 兩個方向都算異常 —— item 多於蓋章總額通常代表有人手動改過金額。
 */
export function detectMealItemAnomalies(checks: MealItemCheck[]): MealItemAnomaly[] {
  return checks
    .filter((check) => check.itemAmount !== check.stampedTotal)
    .map((check) => ({ ...check, expectedAmount: check.stampedTotal }));
}
