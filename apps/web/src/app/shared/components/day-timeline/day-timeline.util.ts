import type { EventSessionSummary } from '@core/attendance.service';

/**
 * 一日時間軸的佈局數學。設計見 `kb/wiki/architecture/timeline-density.md`
 * （前身是 lane 式佈局，見 `day-timeline.md`）。
 *
 * **這裡沒有 Angular。** 佈局是這個元件最需要被測的部分（下面每一條邊界都是純函式的
 * 輸入輸出），拆成純函式就不必為了測一條 lane 分配去啟一個 TestBed。慣例同
 * `features/admin/pages/reports/reports.util.ts`。
 */

/** 軸的預設視窗。實際視窗只會比它大，不會比它小 —— 見 `deriveWindow`。 */
export const DEFAULT_START_HOUR = 8;
export const DEFAULT_END_HOUR = 22;

/** 每一根代表的分鐘數。半小時是「看得出忙在哪一段」與「根數不至於太細」的折衷。 */
export const BIN_MINUTES = 30;

export interface TimeWindow {
  readonly startHour: number;
  readonly endHour: number;
}

/** 一根柱：那半小時同時有幾堂課，其中幾堂還沒點名。 */
export interface DensityBin {
  /** 這一根的起點（小時，含 .5） */
  readonly startHour: number;
  readonly total: number;
  readonly untaken: number;
}

export interface DensityLayout {
  readonly window: TimeWindow;
  readonly bins: readonly DensityBin[];
  /**
   * 當日最大同時堂數。**柱高按它正規化，而且要把它顯示出來**（「最忙 N 堂」）——
   * 固定尺度加截斷會說謊：8 堂同時的日子會畫得跟 5 堂一樣高，而那正是最該被看見的日子。
   */
  readonly maxTotal: number;
  /**
   * 沒有開始時間、因此落不進任何一根的課。
   *
   * **呼叫端要把它說出來**（「另有 N 堂未排定時間」）。句子裡的總數與圖上的總數
   * 不一致時要講，不是默默對齊。
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
 * 每半小時一根，柱高是那半小時**同時**有幾堂課。
 *
 * **為什麼不是「濃度」**：橘帶上近黑的透明度地板是 0.78（0.72 只有 4.00:1，不合 AA），
 * 而 0.78→1.00 兩端互相只有 1.40:1 —— 圖形元素相鄰要 3:1，所以連兩階濃度都放不下。
 * 編碼只能是長度。（長度本來就比明度準，無障礙的地板剛好把設計推向更好的那一邊。）
 *
 * 三個計數規則，每一個都有對應的測試：
 *
 * - **涵蓋，不是開始**：09:00–10:30 的課在 09:00 / 09:30 / 10:00 三根各 +1。
 *   用「開始」計數的話，一整天的長課只會出現在一根，圖就變成「開課時刻分佈」
 *   而不是「忙碌程度」。
 * - **半開區間**：09:00–10:00 的課不計入 10:00 那一根 —— 接續不是重疊。
 * - **有起無迄只算起始那一根**：給它一個預設時長等於憑空宣稱一段我們沒有的資訊。
 */
export function binDay(sessions: readonly EventSessionSummary[]): DensityLayout {
  const win = deriveWindow(sessions);
  // **整數分鐘算，不用小時的浮點數。** `10.5 - Number.EPSILON` 在浮點上仍然等於
  // `10.5`（EPSILON 是相對 1.0 的精度），半開區間就會多算一根。
  const winStartMin = Math.round(win.startHour * 60);
  const winEndMin = Math.round(win.endHour * 60);
  const binCount = Math.round((winEndMin - winStartMin) / BIN_MINUTES);

  const totals = new Array<number>(binCount).fill(0);
  const untakens = new Array<number>(binCount).fill(0);
  const unplaced: EventSessionSummary[] = [];

  for (const s of sessions) {
    const from = parseTimeToHours(s.startTime);
    if (from === null) {
      unplaced.push(s);
      continue;
    }

    const parsedTo = parseTimeToHours(s.endTime);
    const startMin = Math.round(from * 60);
    const endMin = parsedTo !== null && parsedTo > from ? Math.round(parsedTo * 60) : startMin + 1;

    const first = Math.floor((startMin - winStartMin) / BIN_MINUTES);
    // 半開區間 [start, end)：結束時刻剛好落在格線上時，那一根不算。
    // `endMin - 1` 就是「最後一個仍屬於這堂課的分鐘」。
    const last = Math.floor((endMin - 1 - winStartMin) / BIN_MINUTES);

    const untaken = s.takenAt === null;
    for (let i = Math.max(0, first); i <= Math.min(binCount - 1, last); i++) {
      totals[i] += 1;
      if (untaken) untakens[i] += 1;
    }
  }

  const bins: DensityBin[] = totals.map((total, i) => ({
    startHour: (winStartMin + i * BIN_MINUTES) / 60,
    total,
    untaken: untakens[i],
  }));

  return { window: win, bins, maxTotal: Math.max(0, ...totals), unplaced };
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
