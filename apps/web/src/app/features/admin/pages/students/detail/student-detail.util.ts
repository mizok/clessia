import type { StudentAttendanceDays } from '@core/students.service';
import type { StudentSummary, SubjectAverage } from '@core/scores.service';
import { addDaysToDateString, taipeiDateString } from '@core/system-clock.service';

/** A6 到班格往後看幾天：未來的課寫日期 */
const LOOKAHEAD_DAYS = 21;
/** API 區間上限 366 天（含頭尾） */
const MAX_SPAN_DAYS = 365;

/**
 * 到班格要查的區間：起＝最早的報名開始日，**但不早於「迄」往前 365 天**（API 上限）；
 * 迄＝今天＋21。沒有報名 → null（不打）。
 * 範圍說明待裁 1（計畫席 10-10 10:59 過）：我們沒有「學期」概念，用報名日代替。
 */
export function attendanceRange(
  effectiveFroms: readonly string[],
  today: string,
): { from: string; to: string } | null {
  if (effectiveFroms.length === 0) return null;
  const to = addDaysToDateString(today, LOOKAHEAD_DAYS);
  const earliest = [...effectiveFroms].sort()[0];
  const floor = addDaysToDateString(to, -MAX_SPAN_DAYS);
  return { from: earliest > floor ? earliest : floor, to };
}

/** `2026-10-04` → `10/4`（今年）或 `2025/10/04`（其他年） */
export function shortDate(date: string, today: string): string {
  if (date.slice(0, 4) !== today.slice(0, 4)) return date.replaceAll('-', '/');
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** `2026-10-10` → `10/10（六）`；用 UTC 取星期，純日曆運算不吃本地時區 */
export function dateWithWeekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}（${wd}）`;
}

/** `15:00:00` → `15:00` */
export function hhmm(time: string | null): string {
  return time ? time.slice(0, 5) : '';
}

/** 工具列左邊那句：今天有沒有課、下一堂 */
export function situationLine(att: StudentAttendanceDays | null): {
  today: string;
  next: string;
} {
  if (!att) return { today: '', next: '' };
  const start = att.today?.startTime ? hhmm(att.today.startTime) : '';
  const today = att.today ? `今天${start ? ' ' + start : ''} 有課` : '今天沒有他的課';
  const next = att.nextSession
    ? `下一堂 ${dateWithWeekday(att.nextSession.date)}${
        att.nextSession.startTime ? ' ' + hhmm(att.nextSession.startTime) : ''
      }`
    : '';
  return { today, next };
}

export const ATTENDANCE_CELL_LABELS = {
  came: '到',
  absent: '沒到',
  on_leave: '請假',
  cancelled: '停課',
} as const;

export const ATTENDANCE_STATE_LABELS = {
  came: '到班',
  absent: '沒到',
  on_leave: '請假',
  cancelled: '停課',
  future: '還沒到那天',
} as const;

/**
 * 「沒到 1 天：8/22」那句；沒有就寫「都有到」。
 * 超過 3 天只列最近 3 天、後面寫「等 N 天」（稿只畫過 1 天；完整日期給 `absentTitle` 放 title）。
 */
export function absentLine(att: StudentAttendanceDays, today: string): string {
  const dates = [...att.summary.absentDates].sort();
  if (dates.length === 0) return att.summary.due > 0 ? '這段期間該到的都有到' : '';
  const short = (ds: string[]) => ds.map((d) => shortDate(d, today)).join('、');
  if (dates.length <= 3) return `沒到 ${dates.length} 天：${short(dates)}`;
  return `沒到 ${short(dates.slice(-3))} 等 ${dates.length} 天`;
}

/** `absentLine` 縮短時，完整日期放 title；沒縮短就不需要 */
export function absentTitle(att: StudentAttendanceDays, today: string): string | null {
  const dates = [...att.summary.absentDates].sort();
  if (dates.length <= 3) return null;
  return `沒到 ${dates.length} 天：${dates.map((d) => shortDate(d, today)).join('、')}`;
}

/** 副行的班級段：一個班寫班名；多個寫「班A 等 N 班」 */
export function classesLabel(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names[0]} 等 ${names.length} 班`;
}

/** 分數後面的單位：滿分不是 100 寫「／50 分」，不讓 40 被讀成百分制的 40 分 */
export function examUnitText(e: { totalScore: number | null }): string {
  return e.totalScore !== null && e.totalScore !== 100 ? `／${e.totalScore} 分` : '分';
}

/** 「82 分」；滿分不是 100 的考試寫「40／50 分」 */
export function examScoreText(e: { score: number; totalScore: number | null }): string {
  const unit = examUnitText(e);
  return unit === '分' ? `${e.score} 分` : `${e.score}${unit}`;
}

/** 成績摘要列右邊那句（A6：「3 次 · 最近 79 分（班平均 86）」）；次數＝各科紀錄數加總 */
export function scoreSummaryText(
  subjects: readonly SubjectAverage[],
  latest: StudentSummary['latestAcademy'],
): string {
  const n = subjects.reduce((sum, s) => sum + s.totalRecords, 0);
  if (n === 0) return '還沒有成績';
  if (!latest) return `${n} 次`;
  const avg = latest.classAvg !== null ? `（班平均 ${latest.classAvg}）` : '';
  return `${n} 次 · 最近 ${examScoreText(latest)}${avg}`;
}

/** 成績摘要列右邊那句，與展開後每科一行 */
export function subjectScoreText(s: SubjectAverage): string {
  const parts: string[] = [];
  if (s.academySum !== null && s.academyTotalSum) {
    parts.push(`補習班考 ${Math.round((s.academySum / s.academyTotalSum) * 100)}%`);
  }
  if (s.schoolAvg !== null) parts.push(`學校考平均 ${Math.round(s.schoolAvg)}`);
  return parts.join(' · ');
}

export interface LogEntry {
  readonly date: string;
  readonly text: string;
}

export interface LogSources {
  readonly today: string;
  readonly createdAt: string;
  readonly enrollments: readonly { createdAt: string; className: string; statusLabel: string }[];
  readonly attendance: StudentAttendanceDays | null;
  readonly invoices: readonly { issuedAt: string; total: number }[];
  readonly leaves: readonly {
    createdAt: string;
    startDate: string;
    endDate: string;
    reason: string | null;
    submittedByRole: 'parent' | 'admin';
  }[];
}

/** 台北日期；API 的時間戳是 UTC，直接 slice 前 10 碼會在晚上 8 點後差一天 */
function dayOf(timestamp: string): string {
  return taipeiDateString(Date.parse(timestamp));
}

/**
 * 紀錄時間軸：五類事件前端組（範圍說明待裁 4，沒有單一端點）。
 * 依日期新→舊；同日維持來源順序（sort 穩定）。
 */
export function buildLog(src: LogSources): LogEntry[] {
  const out: LogEntry[] = [{ date: dayOf(src.createdAt), text: '加入補習班' }];
  for (const e of src.enrollments) {
    out.push({ date: dayOf(e.createdAt), text: `報名 ${e.className}（${e.statusLabel}）` });
  }
  for (const d of src.attendance?.days ?? []) {
    if (d.state !== 'absent' && d.state !== 'on_leave') continue;
    const classes = [...new Set(d.sessions.map((s) => s.className))].join('、');
    out.push({
      date: d.date,
      text: `${ATTENDANCE_STATE_LABELS[d.state]}${classes ? `（${classes}）` : ''}`,
    });
  }
  for (const i of src.invoices) {
    out.push({ date: dayOf(i.issuedAt), text: `開立帳單 NT$ ${i.total.toLocaleString('en-US')}` });
  }
  for (const l of src.leaves) {
    const range =
      l.startDate === l.endDate
        ? shortDate(l.startDate, src.today)
        : `${shortDate(l.startDate, src.today)}–${shortDate(l.endDate, src.today)}`;
    out.push({
      date: dayOf(l.createdAt),
      text: `${l.submittedByRole === 'parent' ? '家長請假' : '登記請假'} ${range}${l.reason ? '：' + l.reason : ''}`,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
