import type { StatusTone } from '@shared/components/status/status-dot/status-dot.component';
import type { ParentSession } from '@core/parent-sessions.service';
import type {
  ParentAttendanceRecord,
  ParentAttendanceStatus,
} from '@core/parent-attendance.service';

/**
 * 三態的嚴重度排序跟 `schedule.util.ts` 的 `DAY_TONE_PRIORITY` 同一個判準：
 * `overdue`(缺席) > `pending`(請假) > `done`(出席)。**沒有「遲到」**——
 * 全系統的 `attendance_records.status` 從來沒有這個值，畫面不該有它的位置。
 */
export const ATTENDANCE_STATUS_TONE: Record<ParentAttendanceStatus, StatusTone> = {
  present: 'done',
  on_leave: 'pending',
  absent: 'overdue',
};

export const ATTENDANCE_STATUS_LABELS: Record<ParentAttendanceStatus, string> = {
  present: '出席',
  on_leave: '請假',
  absent: '缺席',
};

/**
 * 課堂狀態 → 要不要在列上加一顆 chip。
 *
 * **用 `Record` 不用 `switch` + `default`** —— enum 多一個值時這裡是編譯錯，
 * 而 `default` 會把它靜靜歸進「正常」（charter 的第一族）。
 */
const SESSION_STATUS_CHIP: Record<'scheduled' | 'completed' | 'cancelled', string | null> = {
  scheduled: null,
  completed: null,
  cancelled: '停課',
};

/**
 * `null` 有自己的分支，**不能落進 `scheduled`** ——
 * 那會讓「這不是課堂」跟「這是一堂正常的課」在畫面上長得一樣，
 * 而那正是後端拒絕猜預設值的理由（#514）。
 */
export function sessionChipLabel(
  sessionStatus: 'scheduled' | 'completed' | 'cancelled' | null,
): string | null {
  if (sessionStatus === null) return '非課堂';
  return SESSION_STATUS_CHIP[sessionStatus];
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** `YYYY-MM-DD` 位移 N 天——用 `T00:00:00` 不用裸日期字串，避免 `toISOString` 那類 UTC 陷阱 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** `YYYY-MM-DD` → `M/D`（A6 `md()`） */
export function monthDay(date: string): string {
  return `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
}

/** 到班行（設計稿 §1）。`missing` = 沒刷卡的那三種（淡字） */
export interface ArrivalLine {
  readonly text: string;
  readonly missing: boolean;
}

/**
 * 一天的到班行。`null` = 這天不畫：沒課，或當天的課**全在隨堂點名的分校**（那裡沒有到班卡）。
 * 有任何一堂在日到班分校就畫 —— 刷卡一次當天所有的課都算到。
 */
export function arrivalLine(
  records: readonly ParentAttendanceRecord[],
  time: string | undefined,
  dailyCampusIds: ReadonlySet<string>,
  isToday: boolean,
): ArrivalLine | null {
  if (!records.some((r) => r.campusId !== null && dailyCampusIds.has(r.campusId))) return null;
  if (time) return { text: `${time} 到班`, missing: false };
  const allOff = records.every((r) => r.status === 'on_leave' || r.sessionStatus === 'cancelled');
  if (allOff) return { text: '這天不用到', missing: true };
  return { text: isToday ? '還沒到班' : '沒有到班紀錄', missing: true };
}

/** A6 的「一天一章」：期間內每一天都有一章，沒課的那天是一行「今日無課」 */
export interface AttendanceDay {
  readonly date: string;
  readonly md: string;
  readonly weekday: string;
  readonly isToday: boolean;
  /** 當天的紀錄，照上課時間排 */
  readonly records: ParentAttendanceRecord[];
  readonly arrival: ArrivalLine | null;
}

/** `from`～`to` 每一天，新到舊（A6 `render()`） */
export function buildDays(
  records: readonly ParentAttendanceRecord[],
  checkins: ReadonlyMap<string, string>,
  dailyCampusIds: ReadonlySet<string>,
  from: string,
  to: string,
  today: string,
): AttendanceDay[] {
  const byDate = new Map<string, ParentAttendanceRecord[]>();
  for (const r of records) byDate.set(r.eventDate, [...(byDate.get(r.eventDate) ?? []), r]);
  const days: AttendanceDay[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const list = (byDate.get(d) ?? []).sort((a, b) =>
      (a.startTime ?? '').localeCompare(b.startTime ?? ''),
    );
    days.push({
      date: d,
      md: monthDay(d),
      weekday: WEEKDAYS[new Date(`${d}T00:00:00`).getDay()]!,
      isToday: d === today,
      records: list,
      arrival: list.length ? arrivalLine(list, checkins.get(d), dailyCampusIds, d === today) : null,
    });
  }
  return days;
}

/**
 * 色面標題的第二行：孩子今天到了沒（設計稿 §3）。`null` = 不寫到班句，標題退回「到班紀錄」
 * —— 今天的課都在隨堂點名的分校。`sessions` 是今天、沒停課的堂。
 */
export function heroLine(
  sessions: readonly ParentSession[],
  time: string | undefined,
  dailyCampusIds: ReadonlySet<string>,
  now: string,
): string | null {
  if (sessions.length === 0) return '今天沒有課。';
  if (!sessions.some((s) => s.campusId !== null && dailyCampusIds.has(s.campusId))) return null;
  if (time) return `今天 ${time} 到班。`;
  if (sessions.every((s) => s.attendance?.status === 'on_leave')) return '今天請假。';
  const first = [...sessions].map((s) => s.startTime ?? '').sort()[0]!;
  return first && first > now ? `今天還沒到，${first} 上課。` : '今天還沒到班。';
}
