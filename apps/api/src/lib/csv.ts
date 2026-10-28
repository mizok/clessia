/**
 * CSV 產生。**在伺服器端做** —— 前端自己組的話會遇到跟報表數字同一個問題：
 * 它只看得到當頁的資料（`specs/admin/finance/reports.md` 的 🔴 實作陷阱）。
 */

export type CsvValue = string | number | null | undefined;

/**
 * 一個欄位要不要包引號、怎麼 escape。
 *
 * 三種字元非包不可，而且**漏了都不會報錯**：
 * - 逗號 —— 欄位會裂成兩欄
 * - 雙引號 —— 引號提前關閉，後面的內容全部錯位
 * - 換行 —— 一列變成兩列
 */
function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return '';

  // **公式注入**（CSV injection，#1100 #40）：使用者輸入的字串（學生姓名、考試名稱、收款備註）
  // 開頭是 = + - @（或 tab／CR）時，Excel 會當公式執行 —— 前面補一個單引號讓它當文字。
  // 只處理字串：數字欄（金額、分數）是我們算的，負數要照原樣，不能變成 '-500
  const text =
    typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
  if (!/[",\n\r]/.test(text)) return text;

  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<readonly CsvValue[]>,
  options: { bom?: boolean } = {},
): string {
  const lines = [
    headers.map(escapeField).join(','),
    ...rows.map((row) => row.map(escapeField).join(',')),
  ];

  // CRLF：Excel 對 LF-only 的 CSV 在某些版本會把整份讀成一列
  const body = lines.join('\r\n');

  // **BOM 預設加上，而且放在這裡不放呼叫端。** Excel 開沒有 BOM 的 UTF-8 CSV 會把
  // 中文變成亂碼，而這個系統匯出的欄位全是中文。放在呼叫端的話它會在某次重構裡被
  // 弄丟，症狀是「行政說匯出的檔打不開」而後端測試全綠。
  return (options.bom === false ? '' : '﻿') + body;
}
