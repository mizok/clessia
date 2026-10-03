import type { Session } from '@core/sessions.service';

/**
 * 課表甘特（A6 `schedule.js` 的 `gantt()`／`list()`／`peak()`）的純計算，模板只畫結果。
 * 一列一位老師：人不能分身，所以列內天然不重疊 —— 重疊就是撞堂，往下疊一條車道而不是蓋住。
 */

export interface GanttBlock {
  readonly session: Session;
  readonly lane: number;
  /** 0–100，相對於軸 */
  readonly left: number;
  readonly width: number;
}

export interface GanttRow {
  readonly teacherId: string | null;
  readonly teacherName: string | null;
  readonly blocks: readonly GanttBlock[];
  readonly lanes: number;
}

export interface GanttLayout {
  readonly startHour: number;
  readonly endHour: number;
  readonly rows: readonly GanttRow[];
  /** 同一位老師時間重疊的課（停課不算） */
  readonly clashIds: ReadonlySet<string>;
  /** 同時最多幾班、從幾點到幾點；不到兩班是 null */
  readonly peak: { count: number; from: string; to: string } | null;
}

export const toMin = (t: string): number => {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
};
const hm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const byStart = (a: Session, b: Session): number =>
  toMin(a.startTime) - toMin(b.startTime) ||
  (a.teacherName ?? '').localeCompare(b.teacherName ?? '');

export function layoutDay(sessions: readonly Session[]): GanttLayout | null {
  if (sessions.length === 0) return null;
  const startHour = Math.floor(Math.min(...sessions.map((s) => toMin(s.startTime))) / 60);
  const endHour = Math.ceil(Math.max(...sessions.map((s) => toMin(s.endTime))) / 60);
  const span = Math.max(endHour - startHour, 1) * 60;
  const x = (t: string) => ((toMin(t) - startHour * 60) / span) * 100;

  const byTeacher = new Map<string | null, Session[]>();
  for (const s of [...sessions].sort(byStart)) {
    const list = byTeacher.get(s.teacherId) ?? [];
    list.push(s);
    byTeacher.set(s.teacherId, list);
  }

  const clashIds = new Set<string>();
  const rows: GanttRow[] = [...byTeacher.entries()]
    .sort(
      ([a, as], [b, bs]) =>
        Number(a === null) - Number(b === null) ||
        toMin(as[0].startTime) - toMin(bs[0].startTime) ||
        (as[0].teacherName ?? '').localeCompare(bs[0].teacherName ?? ''),
    )
    .map(([teacherId, list]) => {
      const laneEnds: number[] = [];
      const blocks = list.map((session) => {
        const start = toMin(session.startTime);
        let lane = laneEnds.findIndex((end) => end <= start);
        if (lane < 0) lane = laneEnds.push(0) - 1;
        laneEnds[lane] = toMin(session.endTime);
        return {
          session,
          lane,
          left: x(session.startTime),
          width: x(session.endTime) - x(session.startTime),
        };
      });
      if (teacherId !== null) {
        const live = list.filter((s) => s.status !== 'cancelled');
        for (const a of live)
          for (const b of live)
            if (
              a !== b &&
              toMin(a.startTime) < toMin(b.endTime) &&
              toMin(b.startTime) < toMin(a.endTime)
            )
              clashIds.add(a.id);
      }
      return { teacherId, teacherName: list[0].teacherName, blocks, lanes: laneEnds.length };
    });

  return { startHour, endHour, rows, clashIds, peak: peakOf(sessions, startHour, endHour) };
}

function peakOf(sessions: readonly Session[], h0: number, h1: number): GanttLayout['peak'] {
  const live = sessions.filter((s) => s.status !== 'cancelled');
  const bins: { m: number; n: number }[] = [];
  for (let m = h0 * 60; m < h1 * 60; m += 15)
    bins.push({ m, n: live.filter((s) => toMin(s.startTime) <= m && toMin(s.endTime) > m).length });
  const count = Math.max(0, ...bins.map((b) => b.n));
  if (count < 2) return null;
  const i = bins.findIndex((b) => b.n === count);
  let j = i;
  while (j + 1 < bins.length && bins[j + 1].n === count) j++;
  return { count, from: hm(bins[i].m), to: hm(bins[j].m + 15) };
}

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 上課中：`status` 沒有 in_progress（產品端上課中仍是 scheduled），只能用時間判斷 */
export function isLive(s: Session, now: Date): boolean {
  if (s.status !== 'scheduled' || s.sessionDate !== ymd(now)) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return toMin(s.startTime) <= m && m < toMin(s.endTime);
}

export interface StartGroup {
  readonly start: string;
  readonly sessions: readonly Session[];
}

/** 手機日視圖與篩選結果共用：依開始時間分組（「17:00 開始 · 3 堂」） */
export function groupByStart(sessions: readonly Session[]): StartGroup[] {
  const groups = new Map<string, Session[]>();
  for (const s of [...sessions].sort(byStart)) {
    const key = s.startTime.slice(0, 5);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()].map(([start, list]) => ({ start, sessions: list }));
}

/** 篩選結果：依日期分章，章內依開始時間分組 */
export function groupByDate(
  sessions: readonly Session[],
): { date: string; groups: StartGroup[] }[] {
  const days = new Map<string, Session[]>();
  for (const s of sessions) days.set(s.sessionDate, [...(days.get(s.sessionDate) ?? []), s]);
  return [...days.keys()].sort().map((date) => ({ date, groups: groupByStart(days.get(date)!) }));
}

export interface WeekDaySummary {
  /** `yyyy-MM-dd` */
  readonly date: string;
  readonly sessions: readonly Session[];
  readonly groups: StartGroup[];
  readonly clashIds: ReadonlySet<string>;
  readonly peak: GanttLayout['peak'];
  /** 同時最多幾班（不含停課）；有課沒撞時段是 1，整天停課是 0 */
  readonly maxConcurrent: number;
  readonly cancelled: number;
  /** 停課＋有異動＋撞堂（跟色面標題同一個算法） */
  readonly changed: number;
}

/** 週視圖（A6 `weekView()`）：每天一格，沒課的天也要有（欄位／列不能缺） */
export function summarizeWeek(
  dates: readonly string[],
  sessions: readonly Session[],
): WeekDaySummary[] {
  return dates.map((date) => {
    const list = sessions.filter((s) => s.sessionDate === date);
    const l = layoutDay(list);
    const clashIds = l?.clashIds ?? new Set<string>();
    const live = list.filter((s) => s.status !== 'cancelled').length;
    return {
      date,
      sessions: list,
      groups: groupByStart(list),
      clashIds,
      peak: l?.peak ?? null,
      maxConcurrent: l?.peak?.count ?? Math.min(live, 1),
      cancelled: list.length - live,
      changed: list.filter((s) => s.status === 'cancelled' || s.hasChanges || clashIds.has(s.id))
        .length,
    };
  });
}

/**
 * 勾一堂課（A6 `toggle()`）。`last` 是上一次勾的那堂；按著 Shift、而且兩堂都在畫面順序 `order` 裡時，
 * 把中間的全部加進去（只加不減）；否則就是單堂切換。順序：甘特是老師列由上而下，清單是由上而下。
 */
export function pickRange(
  selected: ReadonlySet<string>,
  order: readonly string[],
  last: string | null,
  id: string,
): Set<string> {
  const next = new Set(selected);
  const a = last === null ? -1 : order.indexOf(last);
  const b = order.indexOf(id);
  if (a >= 0 && b >= 0) {
    for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
  } else if (!next.delete(id)) {
    next.add(id);
  }
  return next;
}
