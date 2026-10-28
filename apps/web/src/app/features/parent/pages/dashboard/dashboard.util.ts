import { addDaysToDateString, taipeiDateString } from '@core/system-clock.service';
import type { ParentCatalogClass } from '@core/parent-applications.service';
import type { ParentInvoice } from '@core/parent-billing.service';
import type { ParentScoreRecord } from '@core/parent-grades.service';
import type { ParentClassLog, ParentSession } from '@core/parent-sessions.service';
import { groupInvoices } from '../payments/payments.util';
import { sortSessions } from '../schedule/schedule.util';
import { effectiveFromSuffix } from '@shared/utils/schedule-effective.util';

/** A6 `.tag` 的五種（色相只編碼嚴重度） */
export type TagTone = 'quiet' | 'warn' | 'error' | 'ok' | 'live';

export interface Tag {
  readonly tone: TagTone;
  readonly label: string;
}

const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
/** b − a，天 */
export const daysBetween = (a: string, b: string) => Math.round((day(b) - day(a)) / 86_400_000);

/** `2026-10-21` → `三`（A6 `wd`） */
export function weekdayChar(date: string): string {
  return '日一二三四五六'[new Date(day(date)).getUTCDay()];
}

/** `2026-10-21` → `10/21` */
export function monthDay(date: string): string {
  return `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
}

/** `2026-10-21` → `10/21（三）` */
export function dayLabel(date: string): string {
  return `${+date.slice(5, 7)}/${+date.slice(8, 10)}（${weekdayChar(date)}）`;
}

// ── 開場句 ──────────────────────────────────────────────────────────────────

/**
 * A6 開場句的第二行：只回答「孩子今天到了嗎」（日到班：沒有遲到、沒有離班）。
 * 分校不用日到班時（沒有刷卡可看）→ null，標題只寫孩子的名字。
 */
export function arrivalLine(
  todays: readonly ParentSession[],
  checkinTime: string | undefined,
  dailyCampusIds: ReadonlySet<string>,
  now: string,
): string | null {
  const live = todays.filter((s) => s.status !== 'cancelled');
  if (live.length === 0) return '今天沒有課。';
  if (!live.some((s) => s.campusId !== null && dailyCampusIds.has(s.campusId))) return null;
  if (checkinTime) return `${checkinTime} 到班了。`;
  if (live.every((s) => s.attendance?.status === 'on_leave')) return '今天請假。';
  const first = live.map((s) => s.startTime?.slice(0, 5) ?? '').sort()[0]!;
  return first && first > now ? `還沒到，${first} 有課。` : '還沒到班。';
}

/** A6 副行：今天有課列今天的；否則下一堂 */
export function subLine(sessions: readonly ParentSession[], today: string): string {
  const sorted = sortSessions(sessions);
  const todays = sorted.filter((s) => s.date === today);
  if (todays.length) {
    return `今天 ${todays.length} 堂：${todays.map((s) => `${s.startTime?.slice(0, 5) ?? ''} ${s.className ?? ''}`.trim()).join('、')}`;
  }
  const next = sorted.find((s) => s.date > today && s.status !== 'cancelled');
  return next
    ? `下一堂 ${dayLabel(next.date)}${next.startTime?.slice(0, 5) ?? ''} ${next.className ?? ''}`.trim()
    : '';
}

// ── 今天／接下來的課 ──────────────────────────────────────────────────────────

/** 今天有課顯示今天；否則接下來 3 天有課的日子；再沒有就接下來的 3 堂（規格「最近 3 天」） */
export function shownSessions(
  sessions: readonly ParentSession[],
  today: string,
): { today: boolean; rows: ParentSession[] } {
  const sorted = sortSessions(sessions);
  const todays = sorted.filter((s) => s.date === today);
  if (todays.length) return { today: true, rows: todays };
  const soon = sorted.filter((s) => s.date > today && s.date <= addDaysToDateString(today, 3));
  return {
    today: false,
    rows: soon.length ? soon : sorted.filter((s) => s.date > today).slice(0, 3),
  };
}

// ── 考試與成績 ────────────────────────────────────────────────────────────────

export interface ExamRow {
  readonly key: string;
  readonly date: string;
  readonly title: string;
  readonly meta: string;
  readonly cheer: string | null;
  readonly score: number | null;
  readonly tags: readonly Tag[];
}

/** 及格線：滿分的六成（A6 示範是 100 分制的 60） */
const passOf = (total: number) => Math.ceil(total * 0.6);

/**
 * 前後 7 天：過去 7 天考過的（成績 API）＋今天起 7 天內要考的（課堂的 examNames，#1835）。
 * 要考的排前面（日期近到遠），考過的接在後面（新到舊）。
 */
export function examRows(
  scores: readonly ParentScoreRecord[],
  sessions: readonly ParentSession[],
  today: string,
): ExamRow[] {
  const until = addDaysToDateString(today, 7);
  const upcoming = sortSessions(sessions)
    .filter((s) => s.date >= today && s.date <= until && s.status !== 'cancelled')
    .flatMap((s) =>
      s.examNames.map((name, i): ExamRow => {
        const left = daysBetween(today, s.date);
        return {
          key: `up-${s.sessionId}-${i}`,
          date: s.date,
          title: `${s.className ?? ''} · ${name}`,
          meta: '還沒考',
          cheer: null,
          score: null,
          tags: [{ tone: 'quiet', label: left === 0 ? '今天考' : `${left} 天後考` }],
        };
      }),
    );
  const done = [...scores]
    .sort((a, b) => (a.examDate < b.examDate ? 1 : -1))
    .map((r): ExamRow => {
      const total = r.totalScore ?? 100;
      const scored = r.status === 'scored' && r.score !== null;
      const full = scored && r.score === total;
      const fail = scored && r.score! < passOf(total);
      const tags: Tag[] = [];
      if (r.status === 'absent') tags.push({ tone: 'warn', label: '缺考' });
      if (full) tags.push({ tone: 'ok', label: '滿分' });
      if (fail) tags.push({ tone: 'error', label: '不及格' });
      // 登錄時間是 ISO 時戳：先換成台北的日期再跟台北的 today 比（台北 00:00–08:00 登錄的，UTC 日期會早一天）
      if (daysBetween(taipeiDateString(Date.parse(r.createdAt)), today) <= 7)
        tags.push({ tone: 'quiet', label: '新成績' });
      return {
        key: r.id,
        date: r.examDate,
        title: [r.className ?? r.subjectName, r.examName].filter(Boolean).join(' · '),
        meta: `及格 ${passOf(total)} 分`,
        cheer: full ? '太厲害了，繼續保持！' : fail ? '這次差一點，下次會更好。' : null,
        score: scored ? r.score : null,
        tags,
      };
    });
  return [...upcoming, ...done];
}

// ── 待繳 ──────────────────────────────────────────────────────────────────────

/** 待繳條（A6 `.pd-pay`）：最近期限那張的到期日與項目數；紅只給逾期，3 天內到期琥珀 */
export function payStrip(
  invoices: readonly ParentInvoice[],
  today: string,
): { due: string | null; items: number; tag: Tag | null } | null {
  const pending = groupInvoices(invoices).pending;
  if (pending.length === 0) return null;
  const next = [...pending].sort((a, b) => ((a.dueDate ?? '9') < (b.dueDate ?? '9') ? -1 : 1))[0];
  const left = next.dueDate ? daysBetween(today, next.dueDate) : null;
  const tag: Tag | null =
    left === null
      ? null
      : left < 0
        ? { tone: 'error', label: `逾期 ${-left} 天` }
        : left <= 3
          ? { tone: 'warn', label: left ? `${left} 天後到期` : '今天到期' }
          : null;
  return { due: next.dueDate, items: next.items.length, tag };
}

// ── 聯絡簿 ────────────────────────────────────────────────────────────────────

/** 每班最新的一篇（API 只回已發布的作業），日期新到舊 */
export function latestLogs(logs: readonly ParentClassLog[]): ParentClassLog[] {
  const byClass = new Map<string, ParentClassLog>();
  for (const log of [...logs].sort((a, b) => (a.logDate < b.logDate ? 1 : -1))) {
    if (!byClass.has(log.classId)) byClass.set(log.classId, log);
  }
  return [...byClass.values()];
}

// ── 推薦加選 ──────────────────────────────────────────────────────────────────

/**
 * 推薦加選：同年級、還沒報的取 3 個（推薦的排前，API 已排）。**同年級一班都沒有時**才改取其他還沒報的 ——
 * 同 A6 p-dashboard 的 `recs.length ? recs : 其他沒報的`；同年級只有 1 班就只給 1 班，不補別的年級（#1837 二讀確認）
 */
export function recommendations(catalog: readonly ParentCatalogClass[]): ParentCatalogClass[] {
  const open = catalog.filter((c) => !c.enrolled);
  const fit = open.filter((c) => c.matchesGrade);
  return (fit.length ? fit : open).slice(0, 3);
}

const WEEKDAY = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];

/** `週三 18:00–20:00` —— 多個時段用「、」接 */
export function slotsLabel(c: ParentCatalogClass): string {
  return c.slots
    .map(
      (s) =>
        `${WEEKDAY[s.weekday]} ${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}${effectiveFromSuffix(s.effectiveFrom)}`,
    )
    .join('、');
}

export function feeUnit(mode: 'monthly' | 'period' | 'session_pack'): string {
  return mode === 'monthly' ? '月' : mode === 'period' ? '期' : '堂數包';
}
