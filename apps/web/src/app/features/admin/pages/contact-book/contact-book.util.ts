import { format, subDays } from 'date-fns';
import type { ContactBookEntry } from '@core/contact-book.service';

/**
 * 聯絡簿列表的邊界計算。
 *
 * 抽成純函式的理由跟 `payments.util.ts` 一樣：跨月、跨年、閏年這些邊界在元件測試裡
 * 很難測乾淨，在純函式裡很容易（charter 先例）。
 */

/**
 * 預設查詢區間：**含今天**往回 `days` 天。
 *
 * 含今天所以退的是 `days - 1` —— 「最近 7 天」是 8/23 到 8/29，不是 8/22。
 * 用 date-fns 的 `subDays` 而不是自己減毫秒：月長度與閏年它算得對，自己算會在
 * 2 月與跨年錯。
 */
export function dateRangeOf(days: number, today: string): { from: string; to: string } {
  // 明確帶時間再解析，否則某些 runtime 會把純日期當 UTC、某些當本地，差一天
  const end = new Date(`${today}T00:00:00`);

  return {
    from: format(subDays(end, days - 1), 'yyyy-MM-dd'),
    to: today,
  };
}

/** 「12 則中 5 則未簽」的三個數字。`isSigned` 是後端算好的，不從 `signedAt` 再推一次 */
export function signedSummary(entries: ContactBookEntry[]): {
  total: number;
  signed: number;
  unsigned: number;
} {
  const signed = entries.filter((entry) => entry.isSigned).length;

  return { total: entries.length, signed, unsigned: entries.length - signed };
}
