import type { EventSessionSummary } from '@core/attendance.service';

/**
 * 老師儀表板的四個數字。
 *
 * 抽成純函式是因為「還沒點名幾堂」的判定有兩個容易錯的地方：未來的課不算待辦
 * （還沒上完當然沒點名），而 `takenAt` 是 null 才叫沒點名 —— 用 presentCount === 0
 * 判斷的話，全班缺席的課會被誤判成沒點名。
 */
export interface TeacherDashboardStats {
  readonly todayTotal: number;
  /** 今天已經開始、但還沒點名的課堂數 */
  readonly todayPending: number;
  readonly weekTotal: number;
}

function hasStarted(session: EventSessionSummary, now: Date): boolean {
  if (!session.startTime) return true;
  const [h, m] = session.startTime.split(':').map(Number);
  const start = new Date(`${session.eventDate}T00:00:00`);
  start.setHours(h ?? 0, m ?? 0, 0, 0);
  return start.getTime() <= now.getTime();
}

export function summariseTeacherWeek(
  weekSessions: readonly EventSessionSummary[],
  today: string,
  now: Date,
): TeacherDashboardStats {
  const todaySessions = weekSessions.filter((s) => s.eventDate === today);

  return {
    todayTotal: todaySessions.length,
    todayPending: todaySessions.filter((s) => !s.takenAt && hasStarted(s, now)).length,
    weekTotal: weekSessions.length,
  };
}
