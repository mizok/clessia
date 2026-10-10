import type { SupabaseClient } from '@supabase/supabase-js';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { DbUuidSchema } from '../lib/validation';

import type { AppEnv } from '../index';
import { campusFilterIds, getCampusScope } from '../lib/campus-scope';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import { SESSION_SUMMARY_SELECT, summariseSessions } from '../lib/session-summary';
import { resolveAttendanceMode } from '../lib/attendance-mode';
import { loadDailyAttendance } from '../lib/today-attendance';

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
/**
 * 每個學生的主要家長（#1314 D1）。`is_primary` 優先，沒標的取第一位；電話住 `ba_user`（讀 ba_* 合法，c2 只禁寫）。
 * 家長用 `parents!inner` 限本 org —— 關聯表沒有 org_id。
 */
async function primaryParentByStudent(
  supabase: SupabaseClient,
  orgId: string,
  studentIds: string[],
): Promise<Map<string, { name: string; relation: string | null; phone: string | null }>> {
  const { data: relationRows } = await supabase
    .from('parent_student_relations')
    .select('student_id, relation, is_primary, parents!inner(name, user_id, org_id)')
    .in('student_id', studentIds)
    .eq('parents.org_id', orgId);

  const picked = new Map<
    string,
    { name: string; relation: string | null; userId: string | null }
  >();
  const primaryFirst = ((relationRows ?? []) as unknown as Array<Record<string, unknown>>).sort(
    (a, b) => Number(Boolean(b['is_primary'])) - Number(Boolean(a['is_primary'])),
  );
  for (const row of primaryFirst) {
    const studentId = row['student_id'] as string;
    if (picked.has(studentId)) continue;
    const parent = row['parents'] as { name?: string; user_id?: string | null } | null;
    picked.set(studentId, {
      name: parent?.name ?? '',
      relation: (row['relation'] as string | null) ?? null,
      userId: parent?.user_id ?? null,
    });
  }

  const userIds = [...new Set([...picked.values()].flatMap((p) => (p.userId ? [p.userId] : [])))];
  const phoneByUser = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: users } = await supabase.from('ba_user').select('id, phone').in('id', userIds);
    for (const user of (users ?? []) as Array<{ id: string; phone: string | null }>) {
      phoneByUser.set(user.id, user.phone ?? null);
    }
  }

  return new Map(
    [...picked].map(([studentId, p]) => [
      studentId,
      {
        name: p.name,
        relation: p.relation,
        phone: p.userId ? (phoneByUser.get(p.userId) ?? null) : null,
      },
    ]),
  );
}

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
     * **伺服器推算（分校設定 → 機構預設，#1112），不收呼叫端傳的。**
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
        /** 主要家長（#1314 D1）：該到沒到的列直接撥電話，不必逐筆打 `/students/{id}`。沒有家長 → null */
        primaryParent: z
          .object({
            name: z.string(),
            relation: z.string().nullable(),
            phone: z.string().nullable(),
          })
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
        /** #1314 D5 */
        reason: z.string().nullable(),
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
    const campusIds = campusFilterIds(getCampusScope(c), campusId);

    let sessionsQuery = supabase
      .from('sessions')
      .select(SESSION_SUMMARY_SELECT)
      .eq('org_id', orgId)
      .eq('session_date', targetDate)
      .order('start_time', { ascending: true });

    if (campusIds) sessionsQuery = sessionsQuery.in('classes.campus_id', campusIds);

    // #949：點名模式只在撈完課堂之後才用到，兩支互不相依 —— 同一輪發出去。
    // #1112：模式是分校層級，而這支一次只回一個 mode —— 看的是單一分校（帶了 campusId，
    // 或只管一個分校）就用那個分校的；看多校時沿用機構預設。
    // ponytail: 多校混用不同模式時多校總覽只顯示機構預設的形狀，要逐校分流再改回應形狀
    const singleCampus = campusId ?? (campusIds?.length === 1 ? campusIds[0] : null);
    const [{ mode: resolvedMode }, { data: sessionRows, error: sessionsError }] = await Promise.all(
      [resolveAttendanceMode(supabase, orgId, singleCampus), sessionsQuery],
    );

    const mode = resolvedMode ?? 'per_session';
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
    // 判準在 `lib/today-attendance.ts`（學生名冊的「今日到班」也走它，#1314 SL1）
    const daily =
      mode === 'daily_checkin'
        ? await loadDailyAttendance(supabase, orgId, targetDate, sessions)
        : { expected: [], arrived: [], onLeave: [] };

    // 主要家長（#1314 D1）：該到沒到的列直接撥
    const primaryParents =
      daily.expected.length > 0
        ? await primaryParentByStudent(
            supabase,
            orgId,
            daily.expected.map((student) => student.studentId),
          )
        : new Map();
    const expected = daily.expected.map((student) => ({
      ...student,
      primaryParent: primaryParents.get(student.studentId) ?? null,
    }));
    const { arrived, onLeave } = daily;

    return c.json({ date: targetDate, mode, sessions, rosters, expected, arrived, onLeave }, 200);
  },
);

export default app;
