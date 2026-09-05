/**
 * 台北時區的今天（`YYYY-MM-DD`）。
 *
 * **不要用 `new Date().toISOString().slice(0, 10)`** —— 那是 UTC，UTC+8 的凌晨
 * 會差一天。出勤補登窗、作業台的「今天」、課堂列表都吃這個值，差一天的後果是
 * 「昨天的名點不了」或「今天的課看不到」。
 *
 * 原本 `routes/attendance.ts` 與 `routes/sessions.ts` **各留一份私有拷貝**，
 * 第三個消費者（作業台）出現時收斂成一份。時區函式各留三份，遲早有一份會在
 * 跨年或夏令時的邊界上算錯，而且只有那一份會錯。
 */
export function getCurrentTaipeiDateString(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
}

/**
 * `date`（`YYYY-MM-DD`）往後推 `days` 天，維持同樣的格式。
 *
 * **用 `Date.UTC` 算，不是為了時區正確性走捷徑** —— 這裡操作的是純日曆日期
 * 字串，不含時刻，所以用哪個時區的 `Date` 物件做加減都得到同一個答案；選
 * `Date.UTC` 只是避免 runtime 本地時區的日光節約時間規則意外介入運算。
 * **真正的「今天是哪一天」永遠只能靠 `getCurrentTaipeiDateString()`** ——
 * 這支只管「某個已知日期往前/往後推幾天」，不管「現在是哪一天」。
 *
 * 原本 `lib/session-end-time.ts` 私有一份、`routes/leaves.ts` 沒有這支所以
 * 直接用 `new Date(Date.now() - 86400000)` 湊「昨天」（UTC，在台北時間
 * 00:00–08:00 之間會算成前天——這正是 2026-09-06 main 全紅的根因）。
 * 收斂成一份，理由跟 `getCurrentTaipeiDateString()` 檔頭說的一樣：
 * 時區函式各留三份，遲早有一份會在邊界上算錯，而且只有那一份會錯。
 */
export function addDaysToDateString(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
