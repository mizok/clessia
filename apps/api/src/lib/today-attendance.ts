import type { Queryable } from './identity-sql';
import { leaveCoversSession, toLeaveWindow } from './leave-covers-session';

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
 * 呼叫端撈 `sessions` 時套的範圍條件，在籍名單照同一組條件在 DB 端篩（#2227）。
 * `null`＝不篩；`classIds` 只給老師（他教的班，量小）。
 */
export interface DailyAttendanceScope {
  readonly campusIds: readonly string[] | null;
  readonly classIds: readonly string[] | null;
}

/**
 * `loadDailyAttendance` 的原料，一支 SQL（#1595 P2 ①）。$1 org、$2 日期、$3 分校（null＝不篩、空陣列＝零筆）、
 * $4 班（只給老師；null＝不篩）。每張表都帶 `org_id = $1`（c1）。
 * 形狀照原本三支 REST 的 select：在籍 `students(name, grade)`、請假帶 `leave_request_sessions(session_id, sessions(session_date))`。
 */
export const DAILY_ATTENDANCE_SQL = `
select json_build_object(
  'enrollments', coalesce((
    select json_agg(json_build_object(
      'id', en.id, 'student_id', en.student_id, 'class_id', en.class_id,
      'students', json_build_object('name', st.name, 'grade', st.grade)
    ) order by en.id)
    from public.enrollments en
    join public.students st on st.id = en.student_id and st.org_id = $1
    join public.classes c on c.id = en.class_id and c.org_id = $1
    where en.org_id = $1
      and en.status = 'active'
      and en.effective_from <= $2::date
      and (en.effective_to is null or en.effective_to >= $2::date)
      and exists (
        select 1 from public.sessions s
        where s.class_id = en.class_id and s.org_id = $1
          and s.session_date = $2::date and s.status <> 'cancelled'
      )
      and ($3::uuid[] is null or c.campus_id = any($3::uuid[]))
      and ($4::uuid[] is null or en.class_id = any($4::uuid[]))
  ), '[]'::json),
  'checkins', coalesce((
    select json_agg(json_build_object(
      'id', dc.id, 'student_id', dc.student_id, 'checked_in_at', dc.checked_in_at
    ) order by dc.id)
    from public.daily_checkins dc
    where dc.org_id = $1 and dc.checkin_date = $2::date
  ), '[]'::json),
  'leaves', coalesce((
    select json_agg(json_build_object(
      'student_id', lr.student_id, 'submitted_by_role', lr.submitted_by_role, 'reason', lr.reason,
      'start_date', lr.start_date, 'end_date', lr.end_date,
      'start_time', lr.start_time, 'end_time', lr.end_time,
      'leave_request_sessions', coalesce((
        select json_agg(json_build_object(
          'session_id', lrs.session_id,
          'sessions', (select json_build_object('session_date', s.session_date)
                       from public.sessions s where s.id = lrs.session_id and s.org_id = $1)
        ))
        from public.leave_request_sessions lrs where lrs.leave_request_id = lr.id
      ), '[]'::json)
    ) order by lr.id)
    from public.leave_requests lr
    where lr.org_id = $1 and lr.start_date <= $2::date and lr.end_date >= $2::date
  ), '[]'::json)
) as result`;

/**
 * 今天有課的班的在籍學生、打卡、請假。`sessions` 由呼叫端撈（已套 `scope`），用來帶出第一堂課與分校。
 */
export async function loadDailyAttendance(
  db: Queryable,
  orgId: string,
  date: string,
  sessions: readonly TodaySession[],
  scope: DailyAttendanceScope,
): Promise<DailyAttendance> {
  // 停課的課不算 —— 只剩停課那堂的學生今天不必來（同一天另一個班有課的照樣應到）。
  // 2026-10-10 前作業台把停課班的學生也列進「應到」，晨間看板會叫行政去追不用來的人
  const held = sessions.filter((session) => session.status !== 'cancelled');
  if (held.length === 0) return { expected: [], arrived: [], onLeave: [] };

  // 在籍條件**與點名名單同源**（`status = 'active'` + 生效區間涵蓋當天）——
  // #178 已經在 daily-checkins.ts 建立這個先例，照抄不另立一份。
  // 兩邊條件不一致會生出「有出勤紀錄但名單上沒這個人」的鬼影。
  // **一支 pg SQL 回原料**（#1595 P2 ①）：在籍、打卡、請假原本是三支 PostgREST（在籍與打卡還要翻頁，
  // 避開 max_rows 1000 的靜默截斷，#1928）。判準（誰算應到、誰請假）照舊在下面的 JS。
  // 「今天有課（沒停課）的班」與分校範圍都在 DB 端篩，條件跟呼叫端撈 `sessions` 的同一組（#2227）
  const { rows } = await db.query(DAILY_ATTENDANCE_SQL, [
    orgId,
    date,
    scope.campusIds ? [...scope.campusIds] : null,
    scope.classIds ? [...scope.classIds] : null,
  ]);
  const raw = (rows[0] as { result?: Record<string, unknown> } | undefined)?.result;
  // 讀取失敗不能當成空的（#1928）：在籍空＝今天沒人該來、打卡空＝全部「該到沒到」。呼叫端由全域 onError 回 500
  if (
    !raw ||
    !Array.isArray(raw['enrollments']) ||
    !Array.isArray(raw['checkins']) ||
    !Array.isArray(raw['leaves'])
  ) {
    throw new Error('讀取今天的在籍、打卡、請假失敗：結果形狀不對');
  }
  const enrollmentRows = raw['enrollments'] as Row[];
  const checkinRows = raw['checkins'] as Row[];
  const leaveRows = raw['leaves'] as Row[];

  // 一個學生可能在今天的兩個班都有課 —— 只列一次，`firstSession` 取最早那堂
  const sessionByClass = new Map(held.map((session) => [session.classId, session]));
  const byStudent = new Map<string, ExpectedStudent>();

  for (const row of enrollmentRows) {
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

  const arrived = checkinRows.map((row) => ({
    studentId: row['student_id'] as string,
    checkedInAt: row['checked_in_at'] as string,
    checkinId: row['id'] as string,
  }));

  let onLeave: DailyLeave[] = [];
  if (expected.length > 0) {
    // 撈的是這個 org 當天有效的假（一天通常幾十張），下面只留應到名單裡的人 ——
    // 名單已套過分校範圍，名單外的假不會出現在結果裡（不把應到的 id 帶進查詢，#1928）
    const nameById = new Map(expected.map((student) => [student.studentId, student.studentName]));

    onLeave = leaveRows
      .filter((row) => nameById.has(row['student_id'] as string))
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
