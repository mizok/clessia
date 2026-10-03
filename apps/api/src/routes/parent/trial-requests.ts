import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { DbUuidSchema } from '../../lib/validation';

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

const SELECT =
  'id, student_id, course_id, status, preferred_times, note, created_at, students(name), courses(name)';

/** 進行中的試聽 —— 同門課只能一筆（migration 的 partial unique） */
const OPEN_STATUSES = ['pending', 'scheduled'];

type Embed = { name?: string | null } | Array<{ name?: string | null }> | null | undefined;
const embedName = (value: Embed) => (Array.isArray(value) ? value[0] : value)?.name ?? null;

function toResponse(row: Record<string, unknown>) {
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
  };
}

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

    // 最新在上（規格）。ponytail: 記憶體排序，理由同 enrollment-requests
    const rows = ((data ?? []) as unknown as Record<string, unknown>[])
      .map(toResponse)
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
      childDb.orgRef('courses').select('id, is_active').in('id', courseIds),
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

    const found = (courses.data ?? []) as unknown as Array<{ id: string; is_active: boolean }>;
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

    return c.json({ data: (data as Record<string, unknown>[]).map(toResponse) }, 201);
  },
);

export default app;
