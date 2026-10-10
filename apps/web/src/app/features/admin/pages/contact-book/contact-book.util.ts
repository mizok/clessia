import { format, subDays } from 'date-fns';
import type { ContactBookEntry, MissingContactBookStudent } from '@core/contact-book.service';

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

export interface MissingClassGroup {
  classId: string;
  className: string;
  students: MissingContactBookStudent[];
}

/**
 * 缺漏名單「一班一列」（A6）。一則聯絡簿屬於學生不屬於班（一生一日一則），
 * 所以同生跨兩班只歸 `classes[0]` —— 列兩次會讓行政以為有兩件事要做。
 * 沒有班的學生（理論上不會）歸到「未分班」，不丟掉。
 */
export function groupMissingByClass(list: MissingContactBookStudent[]): MissingClassGroup[] {
  const groups = new Map<string, MissingClassGroup>();

  for (const student of list) {
    const cls = student.classes[0] ?? { classId: '', className: '未分班' };
    const group = groups.get(cls.classId) ?? { ...cls, students: [] };
    group.students.push(student);
    groups.set(cls.classId, group);
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.className.localeCompare(b.className, 'zh-Hant'),
  );
}

export interface EntryDayGroup {
  date: string;
  entries: ContactBookEntry[];
  unsigned: number;
}

/** 依日分段，新的在上。`entryDate` 本來就是台北曆日字串，不必再轉時區 */
export function groupEntriesByDay(entries: ContactBookEntry[]): EntryDayGroup[] {
  const byDate = new Map<string, ContactBookEntry[]>();

  for (const entry of entries) {
    byDate.set(entry.entryDate, [...(byDate.get(entry.entryDate) ?? []), entry]);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({
      date,
      entries: list,
      unsigned: list.filter((e) => !e.isSigned).length,
    }));
}

const TAIPEI_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `signedAt`（UTC 時間戳）→ 台北 `HH:mm`。解析不了就回空字串，不印 Invalid Date */
export function signedTimeText(signedAt: string | null): string {
  if (!signedAt) return '';
  const time = new Date(signedAt);
  return Number.isNaN(time.getTime()) ? '' : TAIPEI_TIME.format(time);
}

/** 缺漏名單日期下拉的最後一項：開 datepicker 選任意日（A6 只有當週日，這是保留的能力） */
export const OTHER_DAY = 'other';

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

/** `2026-08-29` → `08-29（六）`。曆日字串直接拆，不經 Date 時區 */
export function dayLabel(date: string, today: string): string {
  const weekday = WEEKDAY[new Date(`${date}T00:00:00`).getDay()];
  const prefix = date === today ? '今天 ' : date === shiftDay(today, -1) ? '昨天 ' : '';
  return `${prefix}${date.slice(5)}（${weekday}）`;
}

function shiftDay(date: string, delta: number): string {
  return format(subDays(new Date(`${date}T00:00:00`), -delta), 'yyyy-MM-dd');
}

/**
 * A6 缺漏名單的日期下拉：最近 7 天的上課日（週一到週五）＋今天（週末也要能選），
 * 最後一項「其他日期…」。聯絡簿跟著上課日走，週末幾乎都是空的。
 */
export function missingDayOptions(today: string): Array<{ label: string; value: string }> {
  const days: string[] = [];

  for (let i = 0; i < 7; i++) {
    const date = shiftDay(today, -i);
    const weekday = new Date(`${date}T00:00:00`).getDay();
    if (i === 0 || (weekday >= 1 && weekday <= 5)) days.push(date);
  }

  return [
    ...days.map((date) => ({ label: dayLabel(date, today), value: date })),
    { label: '其他日期…', value: OTHER_DAY },
  ];
}
