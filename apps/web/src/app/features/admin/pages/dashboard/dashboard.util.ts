import type { EventSessionSummary } from '@core/attendance.service';
import type { AttendanceMode } from '@core/org-settings.service';

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

  return sessions.filter((s) => !s.takenAt && hasEnded(s, now)).length;
}

function hasEnded(session: EventSessionSummary, now: Date): boolean {
  const end = new Date(`${session.eventDate}T00:00:00`);

  // 沒有結束時間就無從判斷今天那堂上完了沒，等這一天過完再算
  if (!session.endTime) {
    end.setDate(end.getDate() + 1);
    return end.getTime() <= now.getTime();
  }

  const [h, m] = session.endTime.split(':').map(Number);
  end.setHours(h ?? 0, m ?? 0, 0, 0);
  // 跨午夜的課結束在隔天
  if (session.startTime && session.endTime < session.startTime) {
    end.setDate(end.getDate() + 1);
  }

  return end.getTime() <= now.getTime();
}
