import type { SupabaseClient } from '@supabase/supabase-js';
import type { Queryable } from '../lib/identity-sql';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { DbUuidSchema } from '../lib/validation';

import type { AppEnv } from '../index';
import { campusFilterIds, getCampusScope } from '../lib/campus-scope';
import { addDaysToDateString, getCurrentTaipeiDateString } from '../lib/taipei-date';
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
 *
 * 走 pg（#2230 ③）：學生名單是 `loadDailyAttendance` 在 JS 算出來的「該到沒到」，embed 沒辦法從這個集合出發，
 * 只能帶 id —— 原本兩支 PostgREST `.in()`（學生 id、帳號 id），人一多就 414，而且**兩支都不看 error**，
 * 失敗時列上直接沒有家長電話。`= any($2)` 不進 URL；家長限本 org（`p.org_id = $1`，關聯表沒有 org_id）。
 * 失敗丟例外（路由回 500）。
 */
async function primaryParentByStudent(
  db: Queryable,
  orgId: string,
  studentIds: string[],
): Promise<Map<string, { name: string; relation: string | null; phone: string | null }>> {
  const { rows } = await db.query(
    `select r.student_id, r.relation, r.is_primary, p.name, u.phone
       from public.parent_student_relations r
       join public.parents p on p.id = r.parent_id and p.org_id = $1::uuid
       left join public.ba_user u on u.id = p.user_id
      where r.student_id = any($2::uuid[])`,
    [orgId, studentIds],
  );
  const picked = new Map<string, { name: string; relation: string | null; phone: string | null }>();
  const primaryFirst = (
    rows as Array<{
      student_id: string;
      relation: string | null;
      is_primary: boolean | null;
      name: string | null;
      phone: string | null;
    }>
  ).sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)));
  for (const row of primaryFirst) {
    if (picked.has(row.student_id)) continue;
    picked.set(row.student_id, {
      name: row.name ?? '',
      relation: row.relation ?? null,
      phone: row.phone ?? null,
    });
  }
  return picked;
}

/**
 * 每個學生在 `date`（台北日）最近一筆聯絡（#1314 D2）。只看這一天 —— 儀表板問的是「今天打過了沒」，
 * 歷史在學生檔案（`GET /contact-logs`）。走 pg 的理由同 `primaryParentByStudent`（原本也不看 error）。
 * `created_at` 用 `to_json` 轉字串：跟 PostgREST 回的 ISO 格式一樣，pg 預設會解成 JS Date。
 */
export async function lastContactByStudent(
  db: Queryable,
  orgId: string,
  studentIds: string[],
  date: string,
): Promise<Map<string, { at: string; channel: 'phone' | 'line' | 'other' }>> {
  const { rows } = await db.query(
    `select distinct on (c.student_id) c.student_id, c.channel,
            to_json(c.created_at) #>> '{}' as created_at
       from public.contact_logs c
      where c.org_id = $1::uuid
        and c.student_id = any($2::uuid[])
        and c.created_at >= $3::timestamptz and c.created_at < $4::timestamptz
      order by c.student_id, c.created_at desc`,
    [orgId, studentIds, `${date}T00:00:00+08:00`, `${addDaysToDateString(date, 1)}T00:00:00+08:00`],
  );
  return new Map(
    (
      rows as Array<{ student_id: string; channel: 'phone' | 'line' | 'other'; created_at: string }>
    ).map((row) => [row.student_id, { at: row.created_at, channel: row.channel }]),
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
        /** 這一天（台北）最近一筆聯絡（#1314 D2）—— 「已聯絡 17:42」。這天沒聯絡過 → null */
        lastContact: z
          .object({ at: z.string(), channel: z.enum(['phone', 'line', 'other']) })
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

    // 摘要的計數走 pg（#2227）；沒有池就回 500，不退回會 414／截斷的 `.in()` 寫法
    const pool = c.get('auth')?.pool;
    if (!pool) return c.json({ error: '查詢課堂失敗', code: 'DB_POOL_UNAVAILABLE' }, 500);
    const sessions = await summariseSessions(pool, orgId, sessionRows);

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
        ? await loadDailyAttendance(supabase, orgId, targetDate, sessions, {
            campusIds,
            classIds: null,
          })
        : { expected: [], arrived: [], onLeave: [] };

    // 主要家長（#1314 D1）：該到沒到的列直接撥
    // 與這一天最近一筆聯絡（#1314 D2）同一輪發出
    const expectedIds = daily.expected.map((student) => student.studentId);
    const [primaryParents, lastContacts] =
      expectedIds.length > 0
        ? await Promise.all([
            primaryParentByStudent(pool, orgId, expectedIds),
            lastContactByStudent(pool, orgId, expectedIds, targetDate),
          ])
        : [new Map(), new Map()];
    const expected = daily.expected.map((student) => ({
      ...student,
      primaryParent: primaryParents.get(student.studentId) ?? null,
      lastContact: lastContacts.get(student.studentId) ?? null,
    }));
    const { arrived, onLeave } = daily;

    return c.json({ date: targetDate, mode, sessions, rosters, expected, arrived, onLeave }, 200);
  },
);

export default app;
