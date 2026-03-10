export function normalizeTime(value: string): string {
  const [h = '00', m = '00', s = '00'] = value.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
}

export function toMinutes(value: string): number {
  const [h = '0', m = '0'] = normalizeTime(value).split(':');
  return Number(h) * 60 + Number(m);
}

export function isTimeOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA);
}

export function toWeekdayFromDate(value: Date): number {
  const day = value.getUTCDay();
  return day === 0 ? 7 : day;
}

export function toWeekdayFromString(dateString: string): number {
  return toWeekdayFromDate(new Date(`${dateString}T00:00:00Z`));
}
