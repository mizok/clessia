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
