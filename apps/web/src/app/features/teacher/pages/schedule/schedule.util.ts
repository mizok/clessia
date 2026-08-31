import type { EventSessionSummary } from '@core/attendance.service';
import type { StatusTone } from '@shared/components/status/status-dot/status-dot.component';
import { hasSessionEnded } from '@shared/utils/session-time.util';

/**
 * 課表上一堂課的點名狀態。
 *
 * **「上完了沒」一律問 `hasSessionEnded`**，不要自己比日期。這一頁原本用
 * `!isPast(parseISO(eventDate))`，只看日期 —— 今晚七點的課從凌晨 00:00 起就被判成
 * 「已經開始」。儀表板、課堂管理、day-timeline 都已經在用 `hasSessionEnded`，
 * 第四個使用者不該再寫第五份定義：兩份定義會對同一堂課說不一樣的話。
 *
 * 回傳 `StatusTone` 而不是自己的 enum，是為了讓它直接餵給 `app-status-dot` ——
 * 中間不需要再有一層對照表可以寫錯。
 */
export function attendanceTone(session: EventSessionSummary, now: Date): StatusTone {
  // 停課的課堂永遠不會被點名。**這一條必須排在 hasSessionEnded 之前** ——
  // 不然一堂已過去的停課會被算成「上完了卻沒點」，那是誣賴老師漏了一堂根本沒發生的課。
  if (session.status === 'cancelled') return 'inactive';

  // 全班缺席的課 presentCount 也是 0，所以判定看 takenAt 不看人數
  if (session.takenAt) return 'done';

  const ended = hasSessionEnded(
    { date: session.eventDate, startTime: session.startTime, endTime: session.endTime },
    now,
  );

  // 還沒上完 → 還在等（中空）；上完了卻沒點 → 積欠（實心 + warning）
  return ended ? 'overdue' : 'pending';
}

/**
 * 狀態點旁邊的字。
 *
 * **刻意是 `Record` 不是 `switch`** —— 原本寫成帶 `default` 的 switch，
 * 結果 `inactive`（停課）掉進 default 顯示成「還沒上」，一堂停掉的課在畫面上
 * 看起來像老師還沒去上。`Record<StatusTone, string>` 會強制窮舉，
 * 少一個 case 是編譯錯誤而不是一句錯的話。
 */
export const ATTENDANCE_TONE_LABELS: Record<StatusTone, string> = {
  done: '已點名',
  pending: '還沒上',
  overdue: '漏點名',
  inactive: '已停課',
  failed: '點名異常',
};

/**
 * 這堂課現在點得了名嗎 —— 只回答「有沒有可寫入的出勤事件」，不管時間。
 *
 * 停課的課堂後端**刻意不補建出勤事件**（不會發生的課不該在行事曆上長出一筆），
 * 所以 `eventId` 是 null。誠實關掉入口，比送一個 null 進去讓它在 API 層炸掉好。
 *
 * 兩個條件都查是刻意的：`status` 才是語意上的來源，`eventId` 是它的後果。
 * 只查 eventId 的話，後端哪天改成「停課也補建事件」就會靜靜地放行。
 */
export function canTakeAttendance(session: EventSessionSummary): boolean {
  return session.status !== 'cancelled' && session.eventId !== null;
}

export interface WeekAnchor {
  readonly total: number;
  /** 上完了卻還沒點名的堂數 */
  readonly overdue: number;
}

/**
 * 橘帶錨點的兩個數字。
 *
 * **刻意是整週而不是當日。** 當日數字要知道使用者現在停在哪一天，那要監聽捲動位置，
 * 而這一頁的設計就是不追捲動位置（日期標題放在每一屏裡面）。取捨寫在
 * `kb/wiki/architecture/teacher-schedule-mobile-day.md`。
 */
export function weekAnchor(sessions: readonly EventSessionSummary[], now: Date): WeekAnchor {
  return {
    total: sessions.length,
    overdue: sessions.filter((s) => attendanceTone(s, now) === 'overdue').length,
  };
}
