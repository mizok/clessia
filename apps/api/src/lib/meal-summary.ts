/**
 * 一段期間的餐費統計。
 *
 * **這是後端的加總，吃的是整個區間的列不是當頁的。** `specs/admin/finance/meals.md`
 * 明說「總數取後端的 `meta.total`，不要抓單頁明細自己加 —— 列表 API pageSize 上限 100，
 * 量大的月份會悄悄少算而且**錯得沒有徵兆**」。
 *
 * 抽成純函式是為了讓「哪些列算錢」這件事測得到：
 * 沒訂的不算、翻掉「收不收費」的不算、已結算的**照樣算**。
 */

export interface MealAmountRow {
  ordered: boolean;
  chargeable: boolean;
  unitPrice: number;
  settled: boolean;
}

export interface MealSummary {
  /** 區間內的餐記錄筆數（含沒訂的 —— 「沒訂」跟「沒人處理」要分得出來） */
  total: number;
  /** 其中要收費的筆數 */
  chargeableCount: number;
  /** 要收費的金額加總 */
  totalAmount: number;
  /** 其中已經結算進帳單的筆數。那幾筆的「收不收費」開關是鎖住的 */
  settledCount: number;
}

export function summariseMealRecords(rows: MealAmountRow[]): MealSummary {
  let chargeableCount = 0;
  let totalAmount = 0;
  let settledCount = 0;

  for (const row of rows) {
    if (row.settled) settledCount += 1;
    // 已結算的照樣算進總額 —— 區間金額問的是「這段期間吃了多少錢」，
    // 不是「還有多少沒收」
    if (row.ordered && row.chargeable) {
      chargeableCount += 1;
      totalAmount += row.unitPrice;
    }
  }

  return { total: rows.length, chargeableCount, totalAmount, settledCount };
}
