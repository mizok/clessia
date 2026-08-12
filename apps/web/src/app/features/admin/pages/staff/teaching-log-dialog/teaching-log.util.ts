import type { Session } from '@core/sessions.service';

export interface TeachingLogSummary {
  /** 排定時數總和，不含停課 */
  readonly totalHours: number;
  /** 計入時數的課堂數 */
  readonly countedSessions: number;
  /** 計入時數的課堂，依日期與開始時間排序 */
  readonly counted: Session[];
  /** 停課的課堂，列出但不計入時數 */
  readonly cancelled: Session[];
  /** 已排定但沒有點名紀錄 —— 需要人去確認課到底有沒有上 */
  readonly missingAttendance: Session[];
  /** 結束時間早於開始時間，資料有問題 */
  readonly invalidDuration: Session[];
}

/** 'HH:mm' → 分鐘數。格式不符回傳 null。 */
function toMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 把一位老師某段期間的課堂整理成授課紀錄。
 *
 * 三個刻意的行為（原則：這個系統要可追溯）：
 *
 * 1. **時數用排定時間算，不用點名時間。** 用點名時間會讓「忘記點名」變成「這堂課不算」，
 *    把行政疏失轉嫁成薪資損失。但缺點名的課堂會被列進 `missingAttendance` 讓人確認。
 * 2. **停課列出來但不計入時數。** 藏起來就沒辦法回答「這週為什麼少兩堂」。
 * 3. **結束早於開始視為 0 並標記**，而不是算成負數 —— 負數會讓總時數莫名變少且很難察覺。
 */
export function summariseTeachingLog(sessions: readonly Session[]): TeachingLogSummary {
  const counted: Session[] = [];
  const cancelled: Session[] = [];
  const missingAttendance: Session[] = [];
  const invalidDuration: Session[] = [];
  let totalMinutes = 0;

  for (const session of sessions) {
    if (session.status === 'cancelled') {
      // 沒上的課不會有點名，所以停課不算進 missingAttendance
      cancelled.push(session);
      continue;
    }

    counted.push(session);

    if (!session.attendanceTakenAt) {
      missingAttendance.push(session);
    }

    const start = toMinutes(session.startTime);
    const end = toMinutes(session.endTime);
    if (start === null || end === null || end <= start) {
      invalidDuration.push(session);
      continue;
    }
    totalMinutes += end - start;
  }

  const byStart = (a: Session, b: Session) =>
    a.sessionDate === b.sessionDate
      ? a.startTime.localeCompare(b.startTime)
      : a.sessionDate.localeCompare(b.sessionDate);

  counted.sort(byStart);
  cancelled.sort(byStart);

  return {
    totalHours: Math.round((totalMinutes / 60) * 100) / 100,
    countedSessions: counted.length,
    counted,
    cancelled,
    missingAttendance,
    invalidDuration,
  };
}
