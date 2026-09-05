import type { StatusTone } from '@shared/components/status/status-dot/status-dot.component';
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

export interface AttendanceDayGroup {
  readonly date: string;
  readonly records: ParentAttendanceRecord[];
}

/** 依 `eventDate` 分組，日期新到舊——API 回的是攤平列表，這裡不管分頁怎麼切 */
export function groupByDate(records: readonly ParentAttendanceRecord[]): AttendanceDayGroup[] {
  const byDate = new Map<string, ParentAttendanceRecord[]>();
  for (const record of records) {
    const bucket = byDate.get(record.eventDate);
    if (bucket) {
      bucket.push(record);
    } else {
      byDate.set(record.eventDate, [record]);
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, dayRecords]) => ({ date, records: dayRecords }));
}

/** `YYYY-MM-DD` 位移 N 天——用 `T00:00:00` 不用裸日期字串，避免 `toISOString` 那類 UTC 陷阱 */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 補回沒有紀錄的日期——只在近10天這種短區間用。長區間（近30天/整月）不補，
 * 那會炸出大量空白列（多數孩子不是天天有課）。
 *
 * **為什麼短區間要補**：範圍層級已經把「載入失敗」跟「這段期間沒有紀錄」分開
 * 顯示，但日期層級沒有——家長看到 9/5、9/3、9/2 有紀錄而 9/4 不見，
 * 「那天沒課」跟「那天資料沒進來」長得一模一樣。補一行「今日無課」把這個歧義解掉。
 */
export function fillMissingDays(
  groups: readonly AttendanceDayGroup[],
  dateFrom: string,
  dateTo: string,
): AttendanceDayGroup[] {
  const byDate = new Map(groups.map((g) => [g.date, g.records] as const));
  const result: AttendanceDayGroup[] = [];
  let cursor = dateTo;
  while (cursor >= dateFrom) {
    result.push({ date: cursor, records: byDate.get(cursor) ?? [] });
    cursor = addDays(cursor, -1);
  }
  return result;
}
