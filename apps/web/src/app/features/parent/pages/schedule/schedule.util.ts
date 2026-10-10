import { addDaysToDateString } from '@core/system-clock.service';
import type { ParentSession, ParentSessionChange } from '@core/parent-sessions.service';

export const WEEKDAY_LABELS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'] as const;

/** 週一＝0 … 週日＝6（日期字串是純日曆日，用 UTC 算星期不受執行環境時區影響） */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function mondayOf(date: string): string {
  return addDaysToDateString(date, -weekdayIndex(date));
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToDateString(monday, i));
}

/** `2026-10-05` → `10/5`（A6 的 md） */
export function formatMd(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

/** `17:00:00` → `17:00`；沒有 → `''` */
export function hhmm(time: string | null): string {
  return time ? time.slice(0, 5) : '';
}

function toMinutes(time: string | null): number | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** 台北時間今天過了幾分鐘（跟 `taipeiDateString` 同一個時區理由） */
export function taipeiMinutes(epochMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** ISO 時間戳 → 台北 `HH:mm` */
export function taipeiTimeOfDay(iso: string): string {
  const mins = taipeiMinutes(Date.parse(iso));
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export type SessionPhase = 'off' | 'past' | 'live' | 'future';

export function sessionPhase(s: ParentSession, today: string, nowMin: number): SessionPhase {
  if (s.status === 'cancelled' || s.changes.some((c) => c.changeType === 'cancellation')) {
    return 'off';
  }
  if (s.date < today) return 'past';
  if (s.date > today) return 'future';
  const start = toMinutes(s.startTime);
  const end = toMinutes(s.endTime);
  if (end !== null && end <= nowMin) return 'past';
  if (start !== null && start <= nowMin) return 'live';
  return 'future';
}

export function sortSessions(list: readonly ParentSession[]): ParentSession[] {
  return [...list].sort((a, b) =>
    `${a.date} ${a.startTime ?? ''}` < `${b.date} ${b.startTime ?? ''}` ? -1 : 1,
  );
}

export type Hero =
  | { kind: 'live'; session: ParentSession }
  | { kind: 'next'; session: ParentSession }
  | { kind: 'none' };

/** 開場那句：正在上哪一堂，否則下一堂是哪一堂（停課的不算） */
export function heroOf(sessions: readonly ParentSession[], today: string, nowMin: number): Hero {
  const sorted = sortSessions(sessions);
  const live = sorted.find((s) => sessionPhase(s, today, nowMin) === 'live');
  if (live) return { kind: 'live', session: live };
  const next = sorted.find((s) => sessionPhase(s, today, nowMin) === 'future');
  return next ? { kind: 'next', session: next } : { kind: 'none' };
}

const CHANGE_LABELS: Record<ParentSessionChange['changeType'], string> = {
  reschedule: '調課',
  substitute: '代課',
  cancellation: '停課',
};

/** 卡片上的異動 chip：改期、代課、停課各一個（代課旗標與 substitute 異動只留一個） */
export function changeLabels(s: ParentSession): string[] {
  const kinds = new Set(s.changes.map((c) => c.changeType));
  if (s.isSubstitute) kinds.add('substitute');
  if (s.status === 'cancelled') kinds.add('cancellation');
  return (['reschedule', 'substitute', 'cancellation'] as const)
    .filter((k) => kinds.has(k))
    .map((k) => CHANGE_LABELS[k]);
}

/** 詳情的異動說明（API 不回原因，只描述發生了什麼） */
export function changeText(c: ParentSessionChange, s: ParentSession): string {
  switch (c.changeType) {
    case 'reschedule': {
      const from = `${formatMd(c.originalDate ?? s.date)} ${hhmm(c.originalStartTime)}`;
      const to = `${formatMd(c.newDate ?? s.date)} ${hhmm(c.newStartTime)}`;
      return `從 ${from.trim()} 改到 ${to.trim()}`;
    }
    case 'substitute':
      return s.teacherName ? `本堂由 ${s.teacherName} 老師代課` : '本堂由代課老師上課';
    case 'cancellation':
      return '本堂停課';
  }
}
