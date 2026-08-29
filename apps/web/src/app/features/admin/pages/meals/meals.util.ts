import type { MealBatchRow, MealRosterRow } from '@core/meals.service';

/**
 * 每日名單的邊界計算。
 *
 * 這一頁的難處全在「三個 null 各自代表什麼」：`recordId` 是 null 代表**這天還沒有人
 * 處理過他**（不是「沒訂」），`ordered` / `chargeable` / `unitPrice` 跟著是 null。
 * 那時候預設值要落在學生自己的 opt-in（`mealDefault`）與 org 的預設單價上；
 * 一旦有記錄，就完全以記錄為準 —— 便當漲價不該改到歷史記錄。
 *
 * 這些分支在元件測試裡很難測乾淨，抽成純函式很容易（charter 先例）。
 */

/** 畫面上可編輯的一列 */
export interface MealDraftRow {
  studentId: string;
  studentName: string;
  ordered: boolean;
  chargeable: boolean;
  unitPrice: number;
  /** null = 這天還沒有人處理過他。留著是為了區分「沒訂」與「沒處理」 */
  recordId: string | null;
  /** 已結算 —— 鎖住不給改（規則 2） */
  settled: boolean;
}

/**
 * API 的候選名單 → 可編輯的 draft。
 *
 * `??` 而不是 `||`：單價 0 是合法的值（免費的那一餐），用 `||` 會被 org 預設蓋掉。
 */
export function rosterToDraft(rows: MealRosterRow[], defaultUnitPrice: number): MealDraftRow[] {
  return rows.map((row) => ({
    studentId: row.studentId,
    studentName: row.studentName,
    // 還沒處理過的落在學生的 opt-in 上 —— 那正是候選名單的意義
    ordered: row.ordered ?? row.mealDefault,
    chargeable: row.chargeable ?? true,
    unitPrice: row.unitPrice ?? defaultUnitPrice,
    recordId: row.recordId,
    settled: row.settled,
  }));
}

/**
 * 今天訂幾份、其中幾份要收錢、總共多少錢。
 *
 * **沒訂就不算錢，即使收費開關是開的** —— 沒有便當就沒有費用。
 * 訂了但不收費（便當送到了才請假）算份數不算金額，那正是規則 3 的人工裁量。
 */
export function draftTotals(rows: MealDraftRow[]): {
  ordered: number;
  chargeable: number;
  amount: number;
} {
  const orderedRows = rows.filter((row) => row.ordered);
  const chargeableRows = orderedRows.filter((row) => row.chargeable);

  return {
    ordered: orderedRows.length,
    chargeable: chargeableRows.length,
    amount: chargeableRows.reduce((sum, row) => sum + row.unitPrice, 0),
  };
}

/**
 * 送出用的 rows。
 *
 * **沒訂的也要送** —— 明確記一筆 `ordered: false` 比「沒有那一列」好查，
 * 「那天到底是沒訂還是沒人處理」是行政真的會問的問題。
 *
 * 已結算的先濾掉：後端本來就會擋並回 `lockedStudentIds`，前端不送省一趟無效寫入。
 */
export function draftToBatchRows(rows: MealDraftRow[]): MealBatchRow[] {
  return rows
    .filter((row) => !row.settled)
    .map((row) => ({
      studentId: row.studentId,
      ordered: row.ordered,
      chargeable: row.chargeable,
      unitPrice: row.unitPrice,
    }));
}
