import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { DbUuidSchema } from '../lib/validation';

import type { AppEnv } from '../index';
import { campusFilterIds } from '../lib/campus-scope';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import { leaveCoversSession } from '../lib/leave-covers-session';
import { SESSION_SUMMARY_SELECT, summariseSessions } from '../lib/session-summary';

/**
 * 作業台的聚合端點。**一支取代四支。**
 *
 * 管理端儀表板原本打 8 支（`dashboard.component.ts:314-357`），這支吃掉其中四支：
 * 今日課表、`attendanceMode`、逾期未點名的素材、今日請假。右欄那四個脈絡數字
 * （成績待登錄 ×2、在學人數、報名異動）**刻意不收** —— 收了這支就會變成
 * 「儀表板全部資料」而不是「作業台」，之後想改右欄還得動它。
 *
 * **為什麼聚合值得做**（兩組獨立的數字）：
 * - `lessons/workers-fanout-costs-before-the-db`：8 支並行時每支慢 2.4 倍，
 *   而 8 剛好就是這一頁的並行數
 * - 2026-09-03 的延遲拆段：**查詢執行只佔 1 毫秒**，延遲幾乎全是
 *   「每次請求的固定成本 × 請求次數」。所以**減次數比讓每支變快有效得多**
 *
 * 第二個理由跟效能無關：兩套取數會各長一份分校過濾與在籍判斷，然後其中一份會忘記
 * 更新。這支跟 `/api/attendance/sessions` 共用 `lib/session-summary.ts` 的形狀定義，
 * 以及 `#175` 的 `campusScope` —— 判斷只有一份。
 */
const app = new OpenAPIHono<AppEnv>();

const SessionSummarySchema = z
  .object({
    sessionId: z.string(),
    eventId: z.string().nullable(),
    status: z.enum(['scheduled', 'completed', 'cancelled']),
    examCount: z.number(),
    isSubstitute: z.boolean(),
    classId: z.string(),
    className: z.string(),
    /** 這個班用聯絡簿還是教務日誌 —— 老師端分入口用，`/api/classes` 是 ADMIN_ONLY 拿不到 */
    usesContactBook: z.boolean(),
    courseName: z.string().nullable(),
    teacherName: z.string().nullable(),
    campusId: z.string().nullable(),
    campusName: z.string().nullable(),
    eventDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    enrolledCount: z.number(),
    presentCount: z.number(),
    onLeaveCount: z.number(),
    absentCount: z.number(),
    takenAt: z.string().nullable(),
  })
  .openapi('WorkbenchSession');

const WorkbenchTodaySchema = z
  .object({
    date: z.string(),
    /**
     * **伺服器讀 `organizations.attendance_mode`，不收呼叫端傳的。**
     * 讓呼叫端傳等於同一個機構可能拿到兩種形狀，而那個不一致沒有人會發現。
     */
    mode: z.enum(['per_session', 'daily_checkin']),
    sessions: z.array(SessionSummarySchema),
    /**
     * 逐堂點名模式用。**不適用時是空陣列，不是缺欄位** ——
     * 缺欄位會讓前端到處寫 `?.` 防禦，之後補上也不會有人發現。
     */
    rosters: z.array(
      z.object({
        eventId: z.string(),
        enrolledCount: z.number(),
        presentCount: z.number(),
        onLeaveCount: z.number(),
        takenAt: z.string().nullable(),
      }),
    ),
    /** 日到班模式用：今天有課的班的在籍學生 */
    expected: z.array(
      z.object({
        studentId: z.string(),
        studentName: z.string(),
        grade: z.string().nullable(),
        campusId: z.string().nullable(),
        campusName: z.string().nullable(),
        firstSession: z
          .object({ startTime: z.string().nullable(), className: z.string() })
          .nullable(),
      }),
    ),
    arrived: z.array(
      z.object({ studentId: z.string(), checkedInAt: z.string(), checkinId: z.string() }),
    ),
    onLeave: z.array(
      z.object({
        studentId: z.string(),
        studentName: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        submittedByRole: z.string(),
      }),
    ),
  })
  .openapi('WorkbenchToday');

app.openapi(
  createRoute({
    method: 'get',
    path: '/today',
    tags: ['Workbench'],
    summary: '作業台：今天的課、名單、到班、請假（一支取代四支）',
    request: {
      query: z.object({
        /**
         * 不給就是**台北時區的今天**。作業台要看得了昨天（補登就是昨天的事），
         * 所以它是參數而不是伺服器寫死 `CURRENT_DATE`。
         */
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        campusId: DbUuidSchema.optional(),
      }),
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: WorkbenchTodaySchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { date, campusId } = c.req.valid('query');

    const targetDate = date ?? getCurrentTaipeiDateString();

    // 分校範圍走 #175 的 campusScope：不帶 campusId 的管多校管理員 = 他管的全部。
    // 帶了的話 `campusRequestGuard` 已經在 middleware 驗過，這支不用自己擋。
    const campusIds = campusFilterIds(c.get('campusScope'), campusId);

    const { data: org } = await supabase
      .from('organizations')
      .select('attendance_mode')
      .eq('id', orgId)
      .maybeSingle();

    const mode =
      ((org as { attendance_mode?: string } | null)?.attendance_mode as
        'per_session' | 'daily_checkin') ?? 'per_session';

    let sessionsQuery = supabase
      .from('sessions')
      .select(SESSION_SUMMARY_SELECT)
      .eq('org_id', orgId)
      .eq('session_date', targetDate)
      .order('start_time', { ascending: true });

    if (campusIds) sessionsQuery = sessionsQuery.in('classes.campus_id', campusIds);

    const { data: sessionRows, error: sessionsError } = await sessionsQuery;
    if (sessionsError) {
      return c.json({ error: '查詢課堂失敗', message: sessionsError.message }, 500);
    }

    const sessions = await summariseSessions(supabase, orgId, sessionRows);

    // ── 逐堂點名模式 ────────────────────────────────────────
    //
    // `rosters` 的四個數字都已經在 `sessions` 裡了 —— 分開回是需求單約定的形狀，
    // 讓前端的看板不必自己從 sessions 挑欄位。沒有課堂事件的（停課）不列入：
    // 沒有 eventId 就點不了名。
    const rosters =
      mode === 'per_session'
        ? sessions
            .filter((session) => session.eventId)
            .map((session) => ({
              eventId: session.eventId as string,
              enrolledCount: session.enrolledCount,
              presentCount: session.presentCount,
              onLeaveCount: session.onLeaveCount,
              takenAt: session.takenAt,
            }))
        : [];

    // ── 日到班模式 ──────────────────────────────────────────
    let expected: Array<{
      studentId: string;
      studentName: string;
      grade: string | null;
      campusId: string | null;
      campusName: string | null;
      firstSession: { startTime: string | null; className: string } | null;
    }> = [];
    let arrived: Array<{ studentId: string; checkedInAt: string; checkinId: string }> = [];
    let onLeave: Array<{
      studentId: string;
      studentName: string;
      startDate: string;
      endDate: string;
      submittedByRole: string;
    }> = [];

    const classIds = Array.from(
      new Set(sessions.map((session) => session.classId).filter(Boolean)),
    );

    if (mode === 'daily_checkin' && classIds.length > 0) {
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
          .lte('effective_from', targetDate)
          .or(`effective_to.is.null,effective_to.gte.${targetDate}`),
        supabase
          .from('daily_checkins')
          .select('id, student_id, checked_in_at')
          .eq('org_id', orgId)
          .eq('checkin_date', targetDate),
      ]);

      // 一個學生可能在今天的兩個班都有課 —— 只列一次，`firstSession` 取最早那堂
      const sessionByClass = new Map(sessions.map((session) => [session.classId, session]));
      const byStudent = new Map<string, (typeof expected)[number]>();

      for (const row of (enrollmentRows ?? []) as Array<Record<string, unknown>>) {
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

      expected = Array.from(byStudent.values()).sort((a, b) =>
        a.studentName.localeCompare(b.studentName, 'zh-Hant'),
      );

      arrived = ((checkinRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        studentId: row['student_id'] as string,
        checkedInAt: row['checked_in_at'] as string,
        checkinId: row['id'] as string,
      }));

      const studentIds = expected.map((student) => student.studentId);
      if (studentIds.length > 0) {
        const { data: leaveRows } = await supabase
          .from('leave_requests')
          .select('student_id, start_date, end_date, start_time, end_time, submitted_by_role')
          .eq('org_id', orgId)
          .in('student_id', studentIds)
          .lte('start_date', targetDate)
          .gte('end_date', targetDate);

        const nameById = new Map(
          expected.map((student) => [student.studentId, student.studentName]),
        );

        onLeave = ((leaveRows ?? []) as Array<Record<string, unknown>>)
          .filter((row) =>
            // 半天假只蓋到部分時段 —— 用跟 roster 同一支判斷（#153），
            // 日到班沒有單堂時段，所以拿整天去比
            leaveCoversSession(
              {
                startDate: row['start_date'] as string,
                endDate: row['end_date'] as string,
                startTime: (row['start_time'] as string | null) ?? null,
                endTime: (row['end_time'] as string | null) ?? null,
              },
              { date: targetDate, startTime: null, endTime: null },
            ),
          )
          .map((row) => ({
            studentId: row['student_id'] as string,
            studentName: nameById.get(row['student_id'] as string) ?? '',
            startDate: row['start_date'] as string,
            endDate: row['end_date'] as string,
            submittedByRole: row['submitted_by_role'] as string,
          }));
      }
    }

    return c.json({ date: targetDate, mode, sessions, rosters, expected, arrived, onLeave }, 200);
  },
);

export default app;
