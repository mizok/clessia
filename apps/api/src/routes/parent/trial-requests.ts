import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import type { ChildDb } from '../../lib/child-db';
import { isChildAllowed } from '../../lib/child-scope';
import { DbUuidSchema } from '../../lib/validation';
import { waitUntilFrom } from '../../lib/wait-until';

/**
 * 家長端試聽申請（#1120；specs/parent/trial.md、flows/trial.md）。
 * 寫入與參考資料的形狀同 `enrollment-requests.ts`（kb/wiki/architecture/parent-data-scope.md 二之一）。
 *
 * - **一列一門課**：一次可選多門，拆成多列整批寫（`insertMany`，任一列越權整批不送）。
 * - **不扣名額、不檢查額滿**：試聽算不算名額使用者尚未裁（#1120）。
 * - **沒有取消端點**：規格寫「若需取消，請電話聯繫補習班」，由管理員代標。
 */

const StatusSchema = z.enum(['pending', 'scheduled', 'completed', 'cancelled']);

const TrialRequestSchema = z
  .object({
    id: DbUuidSchema,
    studentId: DbUuidSchema,
    studentName: z.string().nullable(),
    courseId: DbUuidSchema,
    courseName: z.string().nullable(),
    status: StatusSchema,
    preferredTimes: z.string().nullable(),
    note: z.string().nullable(),
    createdAt: z.string().nullable(),
    /**
     * 排定的試聽日期與時間（#1727 Q2 (b)，`20261019100312`）。還沒排 → null。
     * 管理端填日期另開單；那之前家長端列表寫「已安排 · 補習班會跟你聯絡時間」
     */
    scheduledDate: z.string().nullable(),
    scheduledStartTime: z.string().nullable(),
    scheduledEndTime: z.string().nullable(),
    /**
     * 課程所屬分校（#1727 Q-b）：試聽沒有取消鈕，要取消或改時間得打電話給分校。
     * 分校讀不到或沒填電話 → null，家長端寫「請打電話給補習班」不放號碼
     */
    campusName: z.string().nullable(),
    campusPhone: z.string().nullable(),
  })
  .openapi('ParentTrialRequest');

const CreateSchema = z
  .object({
    studentId: DbUuidSchema,
    courseIds: z.array(DbUuidSchema).min(1).max(10),
    preferredTimes: z.string().max(200).optional(),
    note: z.string().max(500).optional(),
  })
  .openapi('CreateParentTrialRequest');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('ParentTrialRequestError');

export const SELECT =
  'id, student_id, course_id, status, preferred_times, note, created_at, scheduled_date, scheduled_start_time, scheduled_end_time, students(name), courses(name, campus_id)';

/** 進行中的試聽 —— 同門課只能一筆（migration 的 partial unique） */
const OPEN_STATUSES = ['pending', 'scheduled'];

type Embed =
  | { name?: string | null; campus_id?: string | null }
  | Array<{ name?: string | null; campus_id?: string | null }>
  | null
  | undefined;
const embedOne = (value: Embed) => (Array.isArray(value) ? value[0] : value) ?? null;
const embedName = (value: Embed) => embedOne(value)?.name ?? null;

type Campus = { name: string | null; phone: string | null };

/** 列上的課程所屬分校（名稱、電話）。走 orgRef：分校是參考資料，不是孩子的資料 */
async function campusesOf(childDb: ChildDb, rows: Record<string, unknown>[]) {
  const ids = [
    ...new Set(
      rows
        .map((row) => embedOne(row['courses'] as Embed)?.campus_id)
        .filter((id): id is string => !!id),
    ),
  ];
  if (!ids.length) return { campuses: new Map<string, Campus>(), error: null };
  const { data, error } = await childDb.orgRef('campuses').select('id, name, phone').in('id', ids);
  const campuses = new Map(
    ((data ?? []) as unknown as Array<{ id: string } & Campus>).map((c) => [c.id, c]),
  );
  return { campuses, error };
}

function toResponse(row: Record<string, unknown>, campuses: Map<string, Campus>) {
  const campusId = embedOne(row['courses'] as Embed)?.campus_id;
  const campus = campusId ? campuses.get(campusId) : undefined;
  return {
    id: row['id'] as string,
    studentId: row['student_id'] as string,
    studentName: embedName(row['students'] as Embed),
    courseId: row['course_id'] as string,
    courseName: embedName(row['courses'] as Embed),
    status: row['status'] as z.infer<typeof StatusSchema>,
    preferredTimes: (row['preferred_times'] as string | null) ?? null,
    note: (row['note'] as string | null) ?? null,
    createdAt: (row['created_at'] as string | null) ?? null,
    scheduledDate: (row['scheduled_date'] as string | null) ?? null,
    scheduledStartTime: hhmm(row['scheduled_start_time']),
    scheduledEndTime: hhmm(row['scheduled_end_time']),
    campusName: campus?.name ?? null,
    campusPhone: campus?.phone?.trim() || null,
  };
}

/** DB 的 time 是 `HH:MM:SS`，回 `HH:MM` */
const hhmm = (t: unknown) => (typeof t === 'string' ? t.slice(0, 5) : null);

const notParent = { error: '不是家長身分', code: 'NOT_PARENT' } as const;
const isParent = (roles: readonly string[] | undefined) => (roles ?? []).includes('parent');
const duplicate = { error: '這門課已經有一筆試聽在處理中', code: 'DUPLICATE_REQUEST' } as const;

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/trial-requests
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Parent'],
    summary: '家長：我的孩子的試聽申請',
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': { schema: z.object({ data: z.array(TrialRequestSchema) }) },
        },
      },
      403: { description: '不是家長', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!isParent(c.get('roles'))) return c.json(notParent, 403);

    const { data, error } = await c
      .get('childDb')
      .from('trial_requests', 'student_id')
      .select(SELECT);
    if (error) return c.json({ error: '讀取試聽申請失敗', code: 'FETCH_FAILED' }, 500);
    const raw = (data ?? []) as unknown as Record<string, unknown>[];
    const { campuses, error: campusError } = await campusesOf(c.get('childDb'), raw);
    if (campusError) return c.json({ error: '讀取試聽申請失敗', code: 'FETCH_FAILED' }, 500);

    // 最新在上（規格）。ponytail: 記憶體排序，理由同 enrollment-requests
    const rows = raw
      .map((row) => toResponse(row, campuses))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return c.json({ data: rows }, 200);
  },
);

// POST /api/me/trial-requests
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Parent'],
    summary: '家長：送出試聽申請（可多門課，一門一筆）',
    request: { body: { content: { 'application/json': { schema: CreateSchema } } } },
    responses: {
      201: {
        description: '已送出',
        content: {
          'application/json': { schema: z.object({ data: z.array(TrialRequestSchema) }) },
        },
      },
      403: {
        description: '不是家長、或不是自己的孩子',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: '課程不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: 'COURSE_NOT_OPEN／ALREADY_ENROLLED／DUPLICATE_REQUEST',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!isParent(c.get('roles'))) return c.json(notParent, 403);
    const body = c.req.valid('json');
    const childDb = c.get('childDb');
    const courseIds = [...new Set(body.courseIds)];

    if (!isChildAllowed(c.get('studentScope'), body.studentId)) {
      return c.json({ error: '不是你的孩子', code: 'NOT_YOUR_CHILD' }, 403);
    }

    const [courses, enrolled, open] = await Promise.all([
      childDb.orgRef('courses').select('id, is_active, campus_id').in('id', courseIds),
      // 規格「排除孩子已報名的課程」：在籍＋待繳費的班所屬的課
      childDb
        .from('enrollments', 'student_id')
        .select('classes(course_id)')
        .eq('student_id', body.studentId)
        .in('status', ['active', 'pending_payment']),
      childDb
        .from('trial_requests', 'student_id')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', body.studentId)
        .in('course_id', courseIds)
        .in('status', OPEN_STATUSES),
    ]);
    if (courses.error || enrolled.error || open.error) {
      return c.json({ error: '讀取課程狀態失敗', code: 'SERVER_ERROR' }, 500);
    }

    const found = (courses.data ?? []) as unknown as Array<{
      id: string;
      is_active: boolean;
      campus_id: string | null;
    }>;
    if (found.length !== courseIds.length) {
      return c.json({ error: '課程不存在', code: 'COURSE_NOT_FOUND' }, 404);
    }
    if (found.some((course) => !course.is_active)) {
      return c.json({ error: '有課程目前不開放試聽', code: 'COURSE_NOT_OPEN' }, 409);
    }

    const enrolledCourseIds = new Set(
      (
        (enrolled.data ?? []) as unknown as Array<{
          classes: { course_id?: string } | Array<{ course_id?: string }> | null;
        }>
      )
        .map((row) => (Array.isArray(row.classes) ? row.classes[0] : row.classes)?.course_id)
        .filter((id): id is string => !!id),
    );
    if (courseIds.some((id) => enrolledCourseIds.has(id))) {
      return c.json({ error: '孩子已經在上其中一門課', code: 'ALREADY_ENROLLED' }, 409);
    }
    if ((open.count ?? 0) > 0) return c.json(duplicate, 409);

    const { data, error, outOfScope } = await childDb
      .from('trial_requests', 'student_id')
      .insertMany(
        courseIds.map((courseId) => ({
          student_id: body.studentId,
          course_id: courseId,
          status: 'pending',
          preferred_times: body.preferredTimes ?? null,
          note: body.note ?? null,
          requested_by: c.get('userId'),
        })),
        SELECT,
      );
    if (outOfScope) return c.json({ error: '不是你的孩子', code: 'NOT_YOUR_CHILD' }, 403);
    if (error || !data) {
      // 並發送出：檢查都過了，partial unique index 擋下第二批
      if ((error as { code?: string } | null)?.code === '23505') return c.json(duplicate, 409);
      return c.json({ error: '送出試聽申請失敗', code: 'SERVER_ERROR' }, 500);
    }

    // #1731：通知分校管理員，同一次送出（多門課）合成一則（計畫席 10-19 Q7 (b)）。背景跑、失敗不擋
    const rows = data as Record<string, unknown>[];
    const job = childDb.notifyRequests(
      'trial',
      rows.map((r) => r['id'] as string),
    );
    const wu = waitUntilFrom(c);
    if (wu) wu(job);
    else await job;

    // 分校讀不到不擋送出（已經寫進去了）：這次回應少電話，列表重抓會有
    // 寫入回來的列不一定帶課程 embed：分校用剛剛查過的課程補上
    const campusOf = new Map(found.map((course) => [course.id, course.campus_id]));
    const withCourse = rows.map((row) => ({
      ...row,
      courses: {
        ...(embedOne(row['courses'] as Embed) ?? {}),
        campus_id: campusOf.get(row['course_id'] as string) ?? null,
      },
    }));
    const { campuses } = await campusesOf(childDb, withCourse);
    return c.json({ data: withCourse.map((row) => toResponse(row, campuses)) }, 201);
  },
);

export default app;
