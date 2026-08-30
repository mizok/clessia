import type { EventSessionSummary } from '@core/attendance.service';
import type { AttendanceMode } from '@core/org-settings.service';
import { hasSessionEnded } from '@shared/utils/session-time.util';

/**
 * 回溯窗內漏點名的課堂數；`null` 代表這張卡整張不該渲染。
 *
 * 兩個容易錯的地方：`takenAt` 是 null 才叫沒點名（用 presentCount === 0 判斷的話，
 * 全班缺席的課會被誤判），以及還沒上完的課不算漏點名（否則晚上的課從一早就在誤報）。
 *
 * 只在逐堂點名模式有意義 —— `daily-checkins` 建立 attendance_records 但從不蓋
 * `events.attendance_taken_at`，日到班模式下每一堂推算出席的課都會被算成漏點名。
 */
export function countUntakenSessions(
  sessions: readonly EventSessionSummary[],
  mode: AttendanceMode,
  now: Date,
): number | null {
  if (mode !== 'per_session') return null;

  // 「上完了沒」的定義共用給課堂管理與 day-timeline —— 各寫一份的話，
  // 儀表板說「6 堂沒點名」而課堂頁標 8 堂，兩個畫面對同一件事說不一樣的話
  return sessions.filter((s) => !s.takenAt && hasSessionEnded(toSessionTime(s), now)).length;
}

/** `EventSessionSummary` 用 `eventDate`，共用函式吃的是 `date` */
function toSessionTime(session: EventSessionSummary) {
  return {
    date: session.eventDate,
    startTime: session.startTime ?? null,
    endTime: session.endTime ?? null,
  };
}
