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
  // 全班缺席的課 presentCount 也是 0，所以判定看 takenAt 不看人數
  if (session.takenAt) return 'done';

  const ended = hasSessionEnded(
    { date: session.eventDate, startTime: session.startTime, endTime: session.endTime },
    now,
  );

  // 還沒上完 → 還在等（中空）；上完了卻沒點 → 積欠（實心 + warning）
  return ended ? 'overdue' : 'pending';
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
