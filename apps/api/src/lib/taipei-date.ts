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
