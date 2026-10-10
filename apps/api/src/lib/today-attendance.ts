import type { SupabaseClient } from '@supabase/supabase-js';

import { LEAVE_WINDOW_COLUMNS, leaveCoversSession, toLeaveWindow } from './leave-covers-session';

/**
 * **日到班模式「今天該有誰、誰到了、誰請假」的判準只有一份，住在這裡**（#1314 SL1）。
 *
 * 作業台（`routes/workbench.ts`）與學生名冊的「今日到班」都走它 —— 兩邊各寫一份，
 * 名冊說「該到沒到 3」而作業台說 2，行政不會知道該信哪一個。
 *
 * 只處理日到班（一天掃一次碼）；逐堂點名的「到了沒」是每堂的出勤紀錄，不在這裡（v1 不支援）。
 */

/** 今天的一堂課，只要判準需要的欄位 */
export interface TodaySession {
  classId: string;
  className: string;
  /** `HH:mm` */
  startTime: string | null;
  campusId: string | null;
  campusName: string | null;
  /** 停課的那堂不讓學生「應到」（#1314 SL1，計畫席 10-10 裁：照 A6 排除） */
  status: string;
}

export interface ExpectedStudent {
  studentId: string;
  studentName: string;
  grade: string | null;
  campusId: string | null;
  campusName: string | null;
  /** 他今天第一堂課 */
  firstSession: { startTime: string | null; className: string } | null;
}

export interface DailyArrival {
  studentId: string;
  checkedInAt: string;
  checkinId: string;
}

export interface DailyLeave {
  studentId: string;
  studentName: string;
  startDate: string;
  endDate: string;
  submittedByRole: string;
  reason: string | null;
}

export interface DailyAttendance {
  expected: ExpectedStudent[];
  arrived: DailyArrival[];
  onLeave: DailyLeave[];
}

/**
 * 名冊用的輕量 select（作業台用的是 `SESSION_SUMMARY_SELECT`，比這個重得多）。
 * 開始時間與分校**事件優先**，同 `lib/session-summary.ts`。
 */
export const TODAY_SESSION_SELECT =
  'class_id, start_time, status, events!event_id(start_time, campus_id, campuses(name)), classes!inner(name, campus_id, campuses(name))';

type Row = Record<string, unknown>;

export function toTodaySession(row: Row): TodaySession {
  const event = row['events'] as Row | null;
  const cls = row['classes'] as Row | null;
  const start = (event?.['start_time'] ?? row['start_time']) as string | null | undefined;
  return {
    classId: row['class_id'] as string,
    status: (row['status'] as string | undefined) ?? 'scheduled',
    className: (cls?.['name'] as string | undefined) ?? '',
    startTime: start?.slice(0, 5) ?? null,
    campusId: ((event?.['campus_id'] ?? cls?.['campus_id']) as string | null | undefined) ?? null,
    campusName:
      (((event?.['campuses'] as Row | null)?.['name'] ??
        (cls?.['campuses'] as Row | null)?.['name']) as string | null | undefined) ?? null,
  };
}

/**
 * 今天有課的班的在籍學生、打卡、請假。`sessions` 由呼叫端撈（已套分校範圍）。
 */
export async function loadDailyAttendance(
  supabase: SupabaseClient,
  orgId: string,
  date: string,
  sessions: readonly TodaySession[],
): Promise<DailyAttendance> {
  // 停課的課不算 —— 只剩停課那堂的學生今天不必來（同一天另一個班有課的照樣應到）。
  // 2026-10-10 前作業台把停課班的學生也列進「應到」，晨間看板會叫行政去追不用來的人
  const held = sessions.filter((session) => session.status !== 'cancelled');
  const classIds = Array.from(new Set(held.map((session) => session.classId).filter(Boolean)));
  if (classIds.length === 0) return { expected: [], arrived: [], onLeave: [] };

  // 在籍條件**與點名名單同源**（`status = 'active'` + 生效區間涵蓋當天）——
  // #178 已經在 daily-checkins.ts 建立這個先例，照抄不另立一份。
  // 兩邊條件不一致會生出「有出勤紀錄但名單上沒這個人」的鬼影。
  const [{ data: enrollmentRows }, { data: checkinRows }] = await Promise.all([
    supabase
      .from('enrollments')
      .select('student_id, class_id, students(name, grade)')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('class_id', classIds)
      .lte('effective_from', date)
      .or(`effective_to.is.null,effective_to.gte.${date}`),
    supabase
      .from('daily_checkins')
      .select('id, student_id, checked_in_at')
      .eq('org_id', orgId)
      .eq('checkin_date', date),
  ]);

  // 一個學生可能在今天的兩個班都有課 —— 只列一次，`firstSession` 取最早那堂
  const sessionByClass = new Map(held.map((session) => [session.classId, session]));
  const byStudent = new Map<string, ExpectedStudent>();

  for (const row of (enrollmentRows ?? []) as Row[]) {
    const studentId = row['student_id'] as string;
    const student = row['students'] as { name?: string; grade?: string | null } | null;
    const session = sessionByClass.get(row['class_id'] as string);
    const existing = byStudent.get(studentId);

    const candidate = session
      ? { startTime: session.startTime, className: session.className }
      : null;

    if (!existing) {
      byStudent.set(studentId, {
        studentId,
        studentName: student?.name ?? '',
        grade: student?.grade ?? null,
        // 前端靠這兩個欄位**依分校分組**（使用者裁定：分組，不是先選分校再看）
        campusId: session?.campusId ?? null,
        campusName: session?.campusName ?? null,
        firstSession: candidate,
      });
      continue;
    }

    if (
      candidate &&
      (!existing.firstSession ||
        (candidate.startTime ?? '99:99') < (existing.firstSession.startTime ?? '99:99'))
    ) {
      existing.firstSession = candidate;
    }
  }

  const expected = Array.from(byStudent.values()).sort((a, b) =>
    a.studentName.localeCompare(b.studentName, 'zh-Hant'),
  );

  const arrived = ((checkinRows ?? []) as Row[]).map((row) => ({
    studentId: row['student_id'] as string,
    checkedInAt: row['checked_in_at'] as string,
    checkinId: row['id'] as string,
  }));

  const studentIds = expected.map((student) => student.studentId);
  let onLeave: DailyLeave[] = [];
  if (studentIds.length > 0) {
    const { data: leaveRows } = await supabase
      .from('leave_requests')
      .select(`student_id, submitted_by_role, reason, ${LEAVE_WINDOW_COLUMNS}`)
      .eq('org_id', orgId)
      .in('student_id', studentIds)
      .lte('start_date', date)
      .gte('end_date', date);

    const nameById = new Map(expected.map((student) => [student.studentId, student.studentName]));

    onLeave = ((leaveRows ?? []) as Row[])
      .filter((row) =>
        // 半天假只蓋到部分時段 —— 用跟 roster 同一支判斷（#153），
        // 日到班沒有單堂時段，所以拿整天去比
        // 綁定堂次的假：當天任一綁定堂被蓋到就算（#1114 裁定 2）
        leaveCoversSession(toLeaveWindow(row), {
          sessionId: null,
          date,
          startTime: null,
          endTime: null,
        }),
      )
      .map((row) => ({
        studentId: row['student_id'] as string,
        studentName: nameById.get(row['student_id'] as string) ?? '',
        startDate: row['start_date'] as string,
        endDate: row['end_date'] as string,
        submittedByRole: row['submitted_by_role'] as string,
        reason: (row['reason'] as string | null) ?? null,
      }));
  }

  return { expected, arrived, onLeave };
}

export type TodayState = 'arrived' | 'on_leave' | 'missing' | 'not_yet';

export interface TodayStatus {
  state: TodayState;
  /** 今天最早那堂開始時間 `HH:mm` */
  dueAt: string | null;
  /** 打卡時間（ISO），沒到 → null */
  arrivedAt: string | null;
}

/**
 * 每個應到學生今天的狀態。優先序：打卡 → 請假 → 最早那堂開始了（該到沒到）→ 還沒開始。
 * 「開始了」用台北時間比（`${date}T${HH:mm}:00+08:00`，同 `lib/session-end-time.ts`）；
 * 沒有開始時間的課當成還沒開始。
 */
export function classifyToday(
  daily: DailyAttendance,
  date: string,
  now: Date = new Date(),
): Map<string, TodayStatus> {
  const arrivedAt = new Map(daily.arrived.map((a) => [a.studentId, a.checkedInAt]));
  const onLeave = new Set(daily.onLeave.map((l) => l.studentId));

  return new Map(
    daily.expected.map((student) => {
      const dueAt = student.firstSession?.startTime ?? null;
      const arrival = arrivedAt.get(student.studentId) ?? null;
      const started =
        dueAt !== null && new Date(`${date}T${dueAt}:00+08:00`).getTime() <= now.getTime();
      const state: TodayState = arrival
        ? 'arrived'
        : onLeave.has(student.studentId)
          ? 'on_leave'
          : started
            ? 'missing'
            : 'not_yet';
      return [student.studentId, { state, dueAt, arrivedAt: arrival }];
    }),
  );
}
