import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../index';
import { getCampusScope } from '../lib/campus-scope';
import { studentInScope } from '../lib/invoice-campus-scope';
import {
  STREAK_WINDOW_DAYS,
  loadLeaveStreaks,
  type ReviewedLeaveStreak,
} from '../lib/leave-streak';
import { findInOrg } from '../lib/org-scope';
import { addDaysToDateString, getCurrentTaipeiDateString } from '../lib/taipei-date';
import { DbUuidSchema } from '../lib/validation';
import { waitUntilFrom } from '../lib/wait-until';
import { logAudit } from '../utils/audit';
import { outOfCampusScope } from './students/read-scope';

/**
 * 連續請假滿 N 個上課日的標記與「已處理」（#1732，設計稿 kb/wiki/specs/admin/finance/leave-streak-waiver.md §4）。
 *
 * **整支掛在 `manage_finance` 底下**（index.ts mount `{ all }`），不掛在 `/api/students` 下面：
 * 那段的寫入門是 `manage_students`，只有財務權限的人會被它先擋掉（同 contact-logs 獨立 mount 的理由）。
 *
 * 標記一律讀取時現算；只碰 `leave_streak_reviews`，**不碰任何帳單、堂數、餐費紀錄**（設計稿 §7）。
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STUDENTS = 100;
const ErrorSchema = z.object({ error: z.string(), code: z.string().optional() });

const ReviewSchema = z
  .object({
    id: z.string(),
    reviewedBy: z.string().nullable(),
    /** 標的人在這個機構的教職員名（`staff.display_name`）；帳號刪了或不是教職員 → null */
    reviewerName: z.string().nullable(),
    reviewedAt: z.string(),
  })
  .nullable();

const StreakDetailSchema = z
  .object({
    firstDay: z.string(),
    lastDay: z.string(),
    days: z.array(
      z.object({
        date: z.string(),
        sessions: z.array(
          z.object({
            sessionId: z.string(),
            classId: z.string(),
            className: z.string(),
            startTime: z.string().nullable(),
            endTime: z.string().nullable(),
          }),
        ),
      }),
    ),
    /** 那幾天「訂了而且收費」的餐：單價就在筆上；`invoicedMonth` 有值＝已經結算進那個月的帳單 */
    meals: z.array(
      z.object({ date: z.string(), unitPrice: z.number(), invoicedMonth: z.string().nullable() }),
    ),
    /** 那幾天涉及的報名：月繳／期繳只列不算（Q7）；堂數制看班的 `leave_deducts_session` */
    enrollments: z.array(
      z.object({
        classId: z.string(),
        className: z.string(),
        billingMode: z.string().nullable(),
        leaveDeductsSession: z.boolean(),
        sessionCount: z.number().int(),
      }),
    ),
    review: ReviewSchema,
  })
  .openapi('LeaveStreakDetail');

type Row = Record<string, unknown>;

/** 「近期」：最後一天落在今天 ±62 天（§4）。往外多抓一個窗，免得跨窗的段被截斷 */
function recentRange() {
  const today = getCurrentTaipeiDateString();
  return {
    from: addDaysToDateString(today, -2 * STREAK_WINDOW_DAYS),
    to: addDaysToDateString(today, 2 * STREAK_WINDOW_DAYS),
    lastFrom: addDaysToDateString(today, -STREAK_WINDOW_DAYS),
    lastTo: addDaysToDateString(today, STREAK_WINDOW_DAYS),
  };
}

const toReview = (streak: ReviewedLeaveStreak, names: ReadonlyMap<string, string> = new Map()) =>
  streak.review
    ? {
        id: streak.review.id,
        reviewedBy: streak.review.reviewed_by,
        reviewerName: names.get(streak.review.reviewed_by ?? '') ?? null,
        reviewedAt: streak.review.reviewed_at,
      }
    : null;

const app = new OpenAPIHono<AppEnv>();

// GET /api/leave-streaks?studentIds=a,b —— 帳單頁：只回「有沒有未處理的段＋天數」，不回明細
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['LeaveStreaks'],
    summary: '這些學生有沒有未處理的連續請假段（帳單頁小標）',
    request: { query: z.object({ studentIds: z.string().min(1) }) },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  studentId: z.string(),
                  firstDay: z.string(),
                  lastDay: z.string(),
                  days: z.number().int(),
                }),
              ),
            }),
          },
        },
      },
      400: { description: '參數不合法', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '查詢失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const ids = [...new Set(c.req.valid('query').studentIds.split(',').filter(Boolean))];
    if (ids.length > MAX_STUDENTS || !ids.every((id) => DbUuidSchema.safeParse(id).success)) {
      return c.json(
        { error: `studentIds 要是 1–${MAX_STUDENTS} 個 id`, code: 'INVALID_STUDENT_IDS' },
        400,
      );
    }

    // 範圍外、別 org 的學生直接當不存在（c1、#1394）
    const { data: students, error } = await supabase
      .from('students')
      .select('id, enrollments(classes(campus_id))')
      .eq('org_id', orgId)
      .in('id', ids);
    if (error) return c.json({ error: '查詢失敗', code: 'SERVER_ERROR' }, 500);
    const scope = getCampusScope(c);
    const visible = ((students ?? []) as Row[])
      .filter((s) => studentInScope(s['enrollments'], scope))
      .map((s) => s['id'] as string);

    const range = recentRange();
    try {
      const { byStudent } = await loadLeaveStreaks(supabase, orgId, visible, range.from, range.to);
      const data = [...byStudent].flatMap(([studentId, streaks]) =>
        streaks
          .filter((s) => !s.review && s.lastDay >= range.lastFrom && s.lastDay <= range.lastTo)
          .map((s) => ({
            studentId,
            firstDay: s.firstDay,
            lastDay: s.lastDay,
            days: s.days.length,
          })),
      );
      return c.json({ data }, 200);
    } catch (err) {
      console.error('[leave-streaks] 查詢失敗:', err);
      return c.json({ error: '查詢失敗', code: 'SERVER_ERROR' }, 500);
    }
  },
);

// GET /api/leave-streaks/students/:id —— 學生檔案帳單章：近期的段，含明細與已處理
app.openapi(
  createRoute({
    method: 'get',
    path: '/students/{id}',
    tags: ['LeaveStreaks'],
    summary: '這位學生近期的連續請假段（含明細）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: z.object({ threshold: z.number().int(), data: z.array(StreakDetailSchema) }),
          },
        },
      },
      404: { description: '學生不存在', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '查詢失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    if (
      !(await findInOrg(supabase, 'students', orgId, id)) ||
      (await outOfCampusScope(supabase, orgId, id, getCampusScope(c)))
    ) {
      return c.json({ error: '學生不存在' }, 404);
    }

    const range = recentRange();
    try {
      const { byStudent, threshold } = await loadLeaveStreaks(
        supabase,
        orgId,
        [id],
        range.from,
        range.to,
      );
      const streaks = (byStudent.get(id) ?? []).filter(
        (s) => s.lastDay >= range.lastFrom && s.lastDay <= range.lastTo,
      );
      if (streaks.length === 0) return c.json({ threshold, data: [] }, 200);

      const dates = streaks.flatMap((s) => s.days.map((d) => d.date));
      const classIds = [
        ...new Set(streaks.flatMap((s) => s.days.flatMap((d) => d.sessions.map((x) => x.classId)))),
      ];
      const reviewerIds = [
        ...new Set(streaks.flatMap((s) => (s.review?.reviewed_by ? [s.review.reviewed_by] : []))),
      ];
      const [meals, enrollments, reviewers, accounts] = await Promise.all([
        supabase
          .from('meal_records')
          .select('meal_date, unit_price, invoice_items(period_month)')
          .eq('org_id', orgId)
          .eq('student_id', id)
          .eq('ordered', true)
          .eq('chargeable', true)
          .in('meal_date', dates),
        supabase
          .from('enrollments')
          .select(
            'class_id, billing_mode, effective_from, effective_to, classes(name, leave_deducts_session)',
          )
          .eq('org_id', orgId)
          .eq('student_id', id)
          .neq('status', 'void')
          .in('class_id', classIds),
        reviewerIds.length === 0
          ? Promise.resolve({ data: [], error: null })
          : supabase
              .from('staff')
              .select('user_id, display_name')
              .eq('org_id', orgId)
              .in('user_id', reviewerIds),
        // 不是這個機構教職員的帳號（例如 seed 的 Demo Admin）退回帳號名；ba_user 只讀（c2）
        reviewerIds.length === 0
          ? Promise.resolve({ data: [], error: null })
          : supabase.from('ba_user').select('id, name').in('id', reviewerIds),
      ]);
      const queryError = meals.error ?? enrollments.error ?? reviewers.error ?? accounts.error;
      if (queryError) throw new Error(queryError.message);
      const names = new Map<string, string>([
        ...((accounts.data ?? []) as Row[]).map(
          (r) => [r['id'] as string, r['name'] as string] as const,
        ),
        // 教職員名優先（後放的蓋掉前面的）
        ...((reviewers.data ?? []) as Row[]).map(
          (r) => [r['user_id'] as string, r['display_name'] as string] as const,
        ),
      ]);
      const mealRows = (meals.data ?? []) as Row[];
      const enrollmentRows = (enrollments.data ?? []) as Row[];

      const data = streaks.map((streak) => {
        const inStreak = new Set(streak.days.map((d) => d.date));
        const sessions = streak.days.flatMap((d) => d.sessions);
        const perClass = new Map<string, number>();
        for (const s of sessions) perClass.set(s.classId, (perClass.get(s.classId) ?? 0) + 1);
        return {
          firstDay: streak.firstDay,
          lastDay: streak.lastDay,
          days: streak.days.map((d) => ({
            date: d.date,
            sessions: d.sessions.map((s) => ({
              sessionId: s.sessionId,
              classId: s.classId,
              className: s.className,
              startTime: s.startTime,
              endTime: s.endTime,
            })),
          })),
          meals: mealRows
            .filter((m) => inStreak.has(m['meal_date'] as string))
            .map((m) => {
              const item = m['invoice_items'] as Row | null;
              return {
                date: m['meal_date'] as string,
                unitPrice: Number(m['unit_price'] ?? 0),
                invoicedMonth: (item?.['period_month'] as string | null | undefined) ?? null,
              };
            })
            .sort((a, b) => a.date.localeCompare(b.date)),
          enrollments: [...perClass].map(([classId, sessionCount]) => {
            // 段落在這筆報名的生效區間內的那一筆（同一班退了又報會有兩筆）
            const enrollment =
              enrollmentRows.find(
                (e) =>
                  e['class_id'] === classId &&
                  (e['effective_from'] as string) <= streak.lastDay &&
                  ((e['effective_to'] as string | null) ?? '9999-12-31') >= streak.firstDay,
              ) ?? null;
            const cls = enrollment?.['classes'] as Row | null | undefined;
            return {
              classId,
              className: sessions.find((s) => s.classId === classId)!.className,
              billingMode: (enrollment?.['billing_mode'] as string | null | undefined) ?? null,
              leaveDeductsSession: Boolean(cls?.['leave_deducts_session']),
              sessionCount,
            };
          }),
          review: toReview(streak, names),
        };
      });
      return c.json({ threshold, data }, 200);
    } catch (err) {
      console.error('[leave-streaks] 查詢失敗:', err);
      return c.json({ error: '查詢失敗', code: 'SERVER_ERROR' }, 500);
    }
  },
);

// POST /api/leave-streaks/students/:id/reviews —— 標為已處理（§4.1）
app.openapi(
  createRoute({
    method: 'post',
    path: '/students/{id}/reviews',
    tags: ['LeaveStreaks'],
    summary: '把一段連續請假標為已處理',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              firstDay: z.string().regex(DATE),
              lastDay: z.string().regex(DATE),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: '已標為已處理',
        content: { 'application/json': { schema: z.object({ data: ReviewSchema.unwrap() }) } },
      },
      404: { description: '學生不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: '這段不是現存的達標段（STREAK_NOT_FOUND），或已經處理過（ALREADY_REVIEWED）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '寫入失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const { firstDay, lastDay } = c.req.valid('json');
    const student = await findInOrg(supabase, 'students', orgId, id, 'id, name');
    if (!student || (await outOfCampusScope(supabase, orgId, id, getCampusScope(c)))) {
      return c.json({ error: '學生不存在' }, 404);
    }

    // 伺服器重算一次：{ firstDay, lastDay } 必須正好是一個現存的達標段，前端不能送任意區間
    let streak: ReviewedLeaveStreak | undefined;
    try {
      const { byStudent } = await loadLeaveStreaks(
        supabase,
        orgId,
        [id],
        addDaysToDateString(firstDay, -STREAK_WINDOW_DAYS),
        addDaysToDateString(lastDay, STREAK_WINDOW_DAYS),
      );
      streak = byStudent.get(id)?.find((s) => s.firstDay === firstDay && s.lastDay === lastDay);
    } catch (err) {
      console.error('[leave-streaks] 重算失敗:', err);
      return c.json({ error: '寫入失敗', code: 'SERVER_ERROR' }, 500);
    }
    if (!streak) {
      return c.json({ error: '這段請假已經變了，請重新整理', code: 'STREAK_NOT_FOUND' }, 409);
    }
    if (streak.review) {
      return c.json({ error: '這段已經標為已處理', code: 'ALREADY_REVIEWED' }, 409);
    }

    const { data, error } = await supabase
      .from('leave_streak_reviews')
      .insert({
        org_id: orgId,
        student_id: id,
        first_day: firstDay,
        last_day: lastDay,
        reviewed_by: userId,
      })
      .select('id, reviewed_by, reviewed_at')
      .single();
    if (error?.code === '23505') {
      return c.json({ error: '這段已經標為已處理', code: 'ALREADY_REVIEWED' }, 409);
    }
    if (error || !data) return c.json({ error: '寫入失敗', code: 'SERVER_ERROR' }, 500);

    // reviewed_by 會在帳號刪除時變 NULL（migration 20261019082657），誰標的以這筆為準
    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'student',
        resourceId: id,
        resourceName: (student['name'] as string | undefined) ?? null,
        action: 'mark_leave_streak_reviewed',
        details: { reviewId: data['id'], firstDay, lastDay, days: streak.days.length },
      },
      waitUntilFrom(c),
    );

    return c.json(
      {
        data: {
          id: data['id'] as string,
          reviewedBy: (data['reviewed_by'] as string | null) ?? null,
          reviewerName: null,
          reviewedAt: data['reviewed_at'] as string,
        },
      },
      201,
    );
  },
);

// DELETE /api/leave-streaks/students/:id/reviews/:reviewId —— 復原
app.openapi(
  createRoute({
    method: 'delete',
    path: '/students/{id}/reviews/{reviewId}',
    tags: ['LeaveStreaks'],
    summary: '取消「已處理」（復原）',
    request: { params: z.object({ id: DbUuidSchema, reviewId: DbUuidSchema }) },
    responses: {
      204: { description: '已取消' },
      404: { description: '不存在', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '刪除失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id, reviewId } = c.req.valid('param');
    const student = await findInOrg(supabase, 'students', orgId, id, 'id, name');
    if (!student || (await outOfCampusScope(supabase, orgId, id, getCampusScope(c)))) {
      return c.json({ error: '學生不存在' }, 404);
    }

    const { data, error } = await supabase
      .from('leave_streak_reviews')
      .delete()
      .eq('id', reviewId)
      .eq('org_id', orgId)
      .eq('student_id', id)
      .select('id, first_day, last_day');
    if (error) return c.json({ error: '刪除失敗', code: 'SERVER_ERROR' }, 500);
    const removed = (data ?? [])[0] as Row | undefined;
    if (!removed) return c.json({ error: '找不到這筆已處理' }, 404);

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'student',
        resourceId: id,
        resourceName: (student['name'] as string | undefined) ?? null,
        action: 'unmark_leave_streak_reviewed',
        details: { reviewId, firstDay: removed['first_day'], lastDay: removed['last_day'] },
      },
      waitUntilFrom(c),
    );
    return c.body(null, 204);
  },
);

export default app;
