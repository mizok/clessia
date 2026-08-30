import type { EventSessionSummary } from '@core/attendance.service';

/**
 * 一日時間軸的佈局數學。設計見 `kb/wiki/architecture/day-timeline.md`。
 *
 * **這裡沒有 Angular。** 佈局是這個元件最需要被測的部分（下面每一條邊界都是純函式的
 * 輸入輸出），拆成純函式就不必為了測一條 lane 分配去啟一個 TestBed。慣例同
 * `features/admin/pages/reports/reports.util.ts`。
 */

/** 軸的預設視窗。實際視窗只會比它大，不會比它小 —— 見 `deriveWindow`。 */
export const DEFAULT_START_HOUR = 8;
export const DEFAULT_END_HOUR = 22;

/** 沒有結束時間的課畫成一個「點」，這是它在軸上佔的寬度（百分比）。 */
export const POINT_WIDTH_PCT = 1.4;

export interface TimeWindow {
  readonly startHour: number;
  readonly endHour: number;
}

export interface PlacedSession {
  readonly session: EventSessionSummary;
  /** 左緣，0–100 */
  readonly leftPct: number;
  /** 寬度，0–100。沒有結束時間時是 `POINT_WIDTH_PCT` */
  readonly widthPct: number;
  /** 沒有結束時間 —— 畫成點而不是有長度的方塊 */
  readonly isPoint: boolean;
}

export interface TimelineLayout {
  readonly window: TimeWindow;
  /** 每一條 lane 是一組互不重疊的課 */
  readonly lanes: readonly (readonly PlacedSession[])[];
  /**
   * 沒有開始時間、因此畫不出來的課。
   *
   * **呼叫端要把它說出來**（「另有 N 堂未排定時間」）。沒有時間就沒有位置，
   * 但畫不出來不等於不存在 —— 句子裡的總數與軸上的數量不一致時要講，
   * 不是默默對齊。
   */
  readonly unplaced: readonly EventSessionSummary[];
}

/** `'09:30'` → `9.5`。格式不對或超出範圍回 `null`，不丟例外（資料來自 API）。 */
export function parseTimeToHours(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h + min / 60;
}

/**
 * 視窗**只擴不縮**。
 *
 * 只有一堂晚上七點的課時，軸如果縮成 19:00–21:00，那一堂會佔滿整條軸 ——
 * 看起來像排滿了。預設視窗保證「一天」的長度感是穩定的，而早上七點的先修班
 * 或半夜的補課仍然畫得進來。
 */
export function deriveWindow(sessions: readonly EventSessionSummary[]): TimeWindow {
  let start = DEFAULT_START_HOUR;
  let end = DEFAULT_END_HOUR;
  for (const s of sessions) {
    const from = parseTimeToHours(s.startTime);
    if (from === null) continue;
    if (from < start) start = Math.floor(from);
    const to = parseTimeToHours(s.endTime);
    const last = to !== null && to > from ? to : from;
    if (last > end) end = Math.ceil(last);
  }
  return { startHour: start, endHour: end };
}

/**
 * 同時段的課並排成多條 lane（貪婪區間分割）：依開始時間排序，每一堂放進
 * 「最後一堂已經結束」的第一條 lane，沒有就開新的。
 *
 * **lane 數不設上限。** 真實的並行數是教室數，通常 2–5 條，帶的高度吸收得了。
 * 設上限反而要決定「放不下的那幾堂去哪」，而任何一種塞法（疊在最後一條、丟掉、
 * 加省略號）都會讓這張圖說謊。真的出現 8 條以上時該換一種畫法（例如每半小時
 * 一根、以濃度表示同時上課的堂數），不是加上限 —— 那時再說。
 */
export function layoutDay(sessions: readonly EventSessionSummary[]): TimelineLayout {
  const win = deriveWindow(sessions);
  const span = win.endHour - win.startHour;
  const toPct = (hour: number) => ((hour - win.startHour) / span) * 100;

  const unplaced: EventSessionSummary[] = [];
  const placeable: { session: EventSessionSummary; from: number; to: number | null }[] = [];

  for (const s of sessions) {
    const from = parseTimeToHours(s.startTime);
    if (from === null) {
      unplaced.push(s);
      continue;
    }
    const parsedTo = parseTimeToHours(s.endTime);
    placeable.push({
      session: s,
      from,
      to: parsedTo !== null && parsedTo > from ? parsedTo : null,
    });
  }

  placeable.sort((a, b) => a.from - b.from);

  const lanes: PlacedSession[][] = [];
  // 每條 lane 目前的結束時間。點（沒有結束時間）也要佔一點寬度才不會疊在一起，
  // 所以它在排程上等同一個極短的區間。
  const laneEnds: number[] = [];

  for (const item of placeable) {
    const widthPct = item.to === null ? POINT_WIDTH_PCT : toPct(item.to) - toPct(item.from);
    const occupiesUntil = item.to ?? item.from + (POINT_WIDTH_PCT / 100) * span;

    let lane = laneEnds.findIndex((end) => end <= item.from);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
      laneEnds.push(0);
    }
    lanes[lane].push({
      session: item.session,
      leftPct: toPct(item.from),
      widthPct,
      isPoint: item.to === null,
    });
    laneEnds[lane] = occupiesUntil;
  }

  return { window: win, lanes, unplaced };
}

/**
 * 「現在」標記的位置。只在 `date` 就是今天、而且此刻落在視窗內時才有值 ——
 * 看昨天的軸上畫一條「現在」是假資訊。
 */
export function nowMarkerPct(win: TimeWindow, date: string, now: Date): number | null {
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  if (date !== local) return null;
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour < win.startHour || hour > win.endHour) return null;
  return ((hour - win.startHour) / (win.endHour - win.startHour)) * 100;
}

/** 軸下方的時刻標籤。視窗被資料撐大時仍然維持大約六到八個刻度。 */
export function axisTicks(win: TimeWindow): number[] {
  const span = win.endHour - win.startHour;
  const step = span <= 8 ? 1 : span <= 16 ? 2 : 3;
  const ticks: number[] = [];
  for (let h = win.startHour; h <= win.endHour; h += step) ticks.push(h);
  return ticks;
}
