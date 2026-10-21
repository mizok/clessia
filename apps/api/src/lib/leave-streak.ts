import type { SupabaseClient } from '@supabase/supabase-js';

import { isCancelledSession } from './cancelled-session';
import { fetchAllPages } from './fetch-all-pages';
import {
  LEAVE_WINDOW_COLUMNS,
  leaveCoversSession,
  toLeaveWindow,
  type LeaveWindow,
} from './leave-covers-session';
import { adminsForCampuses, notify } from './notify';
import { shortDate } from './notify-schedule';
import { addDaysToDateString } from './taipei-date';

/**
 * 連續請假滿 N 個上課日（#1732，設計稿 kb/wiki/specs/admin/finance/leave-streak-waiver.md）。
 *
 * **只偵測、只提醒**：不碰任何帳單、堂數、餐費紀錄（設計稿 §7），金額由行政自己調。
 * 標記一律**讀取時現算**（假單改了、停課了，標記自己跟著變）；通知只在假單寫入之後發。
 */

/** 偵測與「近期」共用的窗（設計稿 §2）。ponytail: 固定窗，連請超過兩個月會被截斷；要就改成往外逐段延伸 */
export const STREAK_WINDOW_DAYS = 62;
export const DEFAULT_LEAVE_WAIVER_DAYS = 3;

/** 該生一堂「有報名、在報名生效區間內、未停課」的課 */
export interface StreakSession {
  readonly sessionId: string;
  readonly classId: string;
  readonly className: string;
  readonly campusId: string | null;
  readonly date: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  /** 那堂有出席（或當天打過卡）—— 請了假又來的那天不算請假日（Q4） */
  readonly attended: boolean;
}

export interface LeaveStreak {
  readonly firstDay: string;
  readonly lastDay: string;
  readonly days: ReadonlyArray<{ readonly date: string; readonly sessions: StreakSession[] }>;
}

export interface StreakReviewRow {
  readonly id: string;
  readonly first_day: string;
  readonly last_day: string;
  readonly reviewed_by: string | null;
  readonly reviewed_at: string;
}

/**
 * 1. 上課日：依日期分組（跨班、跨分校都算同一天）
 * 2. 請假日：那天**每一堂**都被某張假蓋到、而且沒有一堂有出席（裁定 1、Q4）
 * 3. 沿上課日序列走：請假日累加、非請假的上課日斷開；不是上課日的日子不在序列裡，天然不斷
 * 4. 長度 ≥ n 的段就是一個 streak（整段列出，Q1）
 */
export function detectLeaveStreaks(
  sessions: readonly StreakSession[],
  leaves: readonly LeaveWindow[],
  n: number,
): LeaveStreak[] {
  const byDate = new Map<string, StreakSession[]>();
  for (const s of sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

  const isLeaveDay = (list: StreakSession[]) =>
    list.every(
      (s) =>
        !s.attended &&
        leaves.some((leave) =>
          leaveCoversSession(leave, {
            sessionId: s.sessionId,
            date: s.date,
            startTime: s.startTime,
            endTime: s.endTime,
          }),
        ),
    );

  const out: LeaveStreak[] = [];
  let run: Array<{ date: string; sessions: StreakSession[] }> = [];
  const flush = () => {
    if (run.length >= n) {
      out.push({ firstDay: run[0]!.date, lastDay: run[run.length - 1]!.date, days: run });
    }
    run = [];
  };
  for (const date of [...byDate.keys()].sort()) {
    const list = byDate.get(date)!;
    if (isLeaveDay(list)) run.push({ date, sessions: list });
    else flush();
  }
  flush();
  return out;
}

/** 完整涵蓋這一段的「已處理」（§4.1）：延長就不再涵蓋 → 重新出現；縮短仍涵蓋 */
export function reviewCovering<R extends Pick<StreakReviewRow, 'first_day' | 'last_day'>>(
  streak: Pick<LeaveStreak, 'firstDay' | 'lastDay'>,
  reviews: readonly R[],
): R | null {
  return (
    reviews.find((r) => r.first_day <= streak.firstDay && r.last_day >= streak.lastDay) ?? null
  );
}

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];
const withWeekday = (d: string) =>
  `${shortDate(d)}（${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]}）`;

export function formatLeaveStreakNotice(studentName: string, streak: LeaveStreak) {
  return {
    title: `${studentName}連續請假 ${streak.days.length} 個上課日`,
    body: `${streak.days.map((d) => withWeekday(d.date)).join('、')}，這幾天的費用可以不收。點進去看明細。`,
  };
}

// ---------------------------------------------------------------------------
// 讀資料的外殼
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

export interface ReviewedLeaveStreak extends LeaveStreak {
  readonly review: StreakReviewRow | null;
}

/**
 * 這些學生在 [from, to] 內的連續請假段（含每段的已處理）。查詢支數固定、不隨學生數成長。
 * 母體同學生檔案的到班格：報名排除作廢、只取報名生效區間涵蓋的那天、排除停課。
 */
export async function loadLeaveStreaks(
  supabase: SupabaseClient,
  orgId: string,
  studentIds: readonly string[],
  from: string,
  to: string,
): Promise<{ byStudent: Map<string, ReviewedLeaveStreak[]>; threshold: number }> {
  const byStudent = new Map<string, ReviewedLeaveStreak[]>();
  if (studentIds.length === 0) return { byStudent, threshold: DEFAULT_LEAVE_WAIVER_DAYS };
  const ids = [...studentIds];
  const fail = (what: string, error: unknown): never => {
    throw new Error(`查詢${what}失敗：${(error as { message?: string })?.message ?? error}`);
  };

  const [org, enrollments] = await Promise.all([
    supabase.from('organizations').select('leave_waiver_days').eq('id', orgId).maybeSingle(),
    supabase
      .from('enrollments')
      .select('student_id, class_id, effective_from, effective_to')
      .eq('org_id', orgId)
      .in('student_id', ids)
      .neq('status', 'void'),
  ]);
  if (org.error) fail('機構設定', org.error);
  if (enrollments.error) fail('報名', enrollments.error);
  const threshold =
    (org.data as { leave_waiver_days?: number } | null)?.leave_waiver_days ??
    DEFAULT_LEAVE_WAIVER_DAYS;
  const enrollmentRows = (enrollments.data ?? []) as Array<{
    student_id: string;
    class_id: string;
    effective_from: string;
    effective_to: string | null;
  }>;
  const classIds = [...new Set(enrollmentRows.map((e) => e.class_id))];
  if (classIds.length === 0) return { byStudent, threshold };

  const [sessionPages, recordPages, checkins, leaves, reviews] = await Promise.all([
    fetchAllPages((a, b) =>
      supabase
        .from('sessions')
        .select(
          'id, event_id, class_id, session_date, start_time, end_time, status, events!event_id(start_time, end_time, campus_id), classes!inner(name, campus_id)',
        )
        .eq('org_id', orgId)
        .in('class_id', classIds)
        .gte('session_date', from)
        .lte('session_date', to)
        .order('id')
        .range(a, b),
    ),
    fetchAllPages((a, b) =>
      supabase
        .from('attendance_records')
        .select('student_id, event_id, events!inner(event_date)')
        .eq('org_id', orgId)
        .in('student_id', ids)
        // enum 只有 present／absent／on_leave（沒有 late）；在 SQL 裡過濾，`in(..., 'late')` 會整支 400
        .eq('status', 'present')
        .gte('events.event_date', from)
        .lte('events.event_date', to)
        .order('id')
        .range(a, b),
    ),
    fetchAllPages((a, b) =>
      supabase
        .from('daily_checkins')
        .select('student_id, checkin_date')
        .eq('org_id', orgId)
        .in('student_id', ids)
        .gte('checkin_date', from)
        .lte('checkin_date', to)
        .order('id')
        .range(a, b),
    ),
    supabase
      .from('leave_requests')
      .select(`student_id, ${LEAVE_WINDOW_COLUMNS}`)
      .eq('org_id', orgId)
      .in('student_id', ids)
      .lte('start_date', to)
      .gte('end_date', from),
    supabase
      .from('leave_streak_reviews')
      .select('id, student_id, first_day, last_day, reviewed_by, reviewed_at')
      .eq('org_id', orgId)
      .in('student_id', ids)
      .gte('last_day', from)
      .lte('first_day', to),
  ]);
  if (sessionPages.error) fail('課堂', sessionPages.error);
  if (recordPages.error) fail('出勤', recordPages.error);
  if (checkins.error) fail('到班打卡', checkins.error);
  if (leaves.error) fail('請假', leaves.error);
  if (reviews.error) fail('已處理紀錄', reviews.error);

  const held = sessionPages.rows
    .filter((row) => !isCancelledSession(row as { status?: string }))
    .map((row) => {
      const event = row['events'] as Row | null;
      const cls = row['classes'] as Row | null;
      const start = (event?.['start_time'] ?? row['start_time']) as string | null;
      const end = (event?.['end_time'] ?? row['end_time']) as string | null;
      return {
        sessionId: row['id'] as string,
        eventId: (row['event_id'] as string | null) ?? null,
        classId: row['class_id'] as string,
        className: (cls?.['name'] as string | undefined) ?? '',
        campusId: ((event?.['campus_id'] ?? cls?.['campus_id']) as string | null) ?? null,
        date: row['session_date'] as string,
        startTime: start?.slice(0, 5) ?? null,
        endTime: end?.slice(0, 5) ?? null,
      };
    })
    .sort(
      (x, y) =>
        x.date.localeCompare(y.date) || (x.startTime ?? '').localeCompare(y.startTime ?? ''),
    );

  const presentKeys = new Set(
    recordPages.rows.map((r) => `${r['student_id'] as string}:${r['event_id'] as string}`),
  );
  // ponytail: 打過卡就算當天有來，不分分校的點名模式（打卡只會發生在日到班分校）
  const checkinKeys = new Set(
    checkins.rows.map((r) => `${r['student_id'] as string}:${r['checkin_date'] as string}`),
  );

  for (const studentId of ids) {
    const mine = enrollmentRows.filter((e) => e.student_id === studentId);
    const sessions: StreakSession[] = held
      .filter((s) =>
        mine.some(
          (e) =>
            e.class_id === s.classId &&
            e.effective_from <= s.date &&
            (e.effective_to === null || e.effective_to >= s.date),
        ),
      )
      .map(({ eventId, ...s }) => ({
        ...s,
        attended:
          (eventId !== null && presentKeys.has(`${studentId}:${eventId}`)) ||
          checkinKeys.has(`${studentId}:${s.date}`),
      }));
    const windows = ((leaves.data ?? []) as Row[])
      .filter((r) => r['student_id'] === studentId)
      .map(toLeaveWindow);
    const myReviews = (
      (reviews.data ?? []) as Array<StreakReviewRow & { student_id: string }>
    ).filter((r) => r.student_id === studentId);
    const streaks = detectLeaveStreaks(sessions, windows, threshold).map((streak) => ({
      ...streak,
      review: reviewCovering(streak, myReviews),
    }));
    if (streaks.length > 0) byStudent.set(studentId, streaks);
  }
  return { byStudent, threshold };
}

/**
 * 假單寫入（建立、改長）之後：包含 [from, to] 的段若達標、而且沒被已處理涵蓋，
 * 發 `leave_streak` 給那幾堂分校範圍內有 `manage_finance` 的管理員（設計稿 §3）。
 *
 * 鍵帶段的起訖：同一段重送去重，被延長就是新的一則（天數變了，要扣的也變了）。
 * **不丟例外**：假單已經寫入，失敗只記 `[notify]` log。
 */
export async function notifyLeaveStreaks(
  supabase: SupabaseClient,
  input: {
    readonly orgId: string;
    readonly studentId: string;
    readonly from: string;
    readonly to: string;
  },
): Promise<void> {
  try {
    const { byStudent } = await loadLeaveStreaks(
      supabase,
      input.orgId,
      [input.studentId],
      addDaysToDateString(input.from, -STREAK_WINDOW_DAYS),
      addDaysToDateString(input.to, STREAK_WINDOW_DAYS),
    );
    const hits = (byStudent.get(input.studentId) ?? []).filter(
      (s) => !s.review && s.firstDay <= input.to && s.lastDay >= input.from,
    );
    if (hits.length === 0) return;

    const { data: student } = await supabase
      .from('students')
      .select('name')
      .eq('id', input.studentId)
      .eq('org_id', input.orgId)
      .maybeSingle();
    const name = (student as { name?: string } | null)?.name ?? '';

    const rows = [];
    for (const streak of hits) {
      const campusIds = [
        ...new Set(
          streak.days.flatMap((d) => d.sessions.flatMap((s) => (s.campusId ? [s.campusId] : []))),
        ),
      ];
      const recipients = await adminsForCampuses(supabase, input.orgId, campusIds, {
        permission: 'manage_finance',
      });
      const { title, body } = formatLeaveStreakNotice(name, streak);
      rows.push(
        ...recipients.map((userId) => ({
          orgId: input.orgId,
          userId,
          role: 'admin' as const,
          kind: 'leave_streak' as const,
          dedupeKey: `leave_streak:${input.studentId}:${streak.firstDay}:${streak.lastDay}`,
          title,
          body,
          url: `/admin/students/${input.studentId}#billing`,
        })),
      );
    }
    await notify(supabase, rows);
  } catch (err) {
    console.error(
      '[notify] 連續請假偵測失敗（假單已寫入）:',
      err instanceof Error ? err.message : err,
    );
  }
}
