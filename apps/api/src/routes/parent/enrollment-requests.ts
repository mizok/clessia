import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { getCurrentTaipeiDateString } from '../../lib/taipei-date';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 家長端報名申請（#1119；specs/parent/enrollment.md、rules/enrollment-rules.md 1）。
 * **家長端第一次寫入** —— 寫入走 `childDb.from().insert()／update()`（範圍檢查在送 DB 之前），
 * 班級與名額走 `childDb.orgRef()`／`activeEnrollmentCount()`（只帶 org、只回數字）。
 * 設計見 kb/wiki/architecture/parent-data-scope.md「家長端的寫入」。
 *
 * 核准（開帳、建 enrollment）不在這裡 —— 那是管理端、而且是金額路徑。
 */

const StatusSchema = z.enum([
  'pending',
  'waitlist',
  'awaiting_payment',
  'completed',
  'rejected',
  'cancelled',
  'expired',
]);

const EnrollmentRequestSchema = z
  .object({
    id: DbUuidSchema,
    studentId: DbUuidSchema,
    studentName: z.string().nullable(),
    classId: DbUuidSchema,
    className: z.string().nullable(),
    status: StatusSchema,
    preferredStartDate: z.string().nullable(),
    note: z.string().nullable(),
    rejectReason: z.string().nullable(),
    createdAt: z.string().nullable(),
  })
  .openapi('ParentEnrollmentRequest');

const CreateSchema = z
  .object({
    studentId: DbUuidSchema,
    classId: DbUuidSchema,
    preferredStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    note: z.string().max(500).optional(),
    /**
     * 額滿時家長**明確選擇**登記候補（使用者 10-03 裁）。只是「同意」，不是「宣告額滿」——
     * 額滿與否由伺服器數，有位子時送 true 照樣是 pending。
     */
    waitlist: z.boolean().optional(),
  })
  .openapi('CreateParentEnrollmentRequest');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('ParentEnrollmentRequestError');

const SELECT =
  'id, student_id, class_id, status, preferred_start_date, note, reject_reason, created_at, students(name), classes(name)';

/** 佔名額的申請狀態以外，「還在進行中」的申請 —— 同班只能有一筆（migration 的 partial unique） */
const OPEN_STATUSES = ['pending', 'waitlist', 'awaiting_payment'];
/** 家長自己能取消的：還沒被核准的 */
const CANCELLABLE_STATUSES = ['pending', 'waitlist'];

type Embed = { name?: string | null } | Array<{ name?: string | null }> | null | undefined;
const embedName = (value: Embed) => (Array.isArray(value) ? value[0] : value)?.name ?? null;

function toResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    studentId: row['student_id'] as string,
    studentName: embedName(row['students'] as Embed),
    classId: row['class_id'] as string,
    className: embedName(row['classes'] as Embed),
    status: row['status'] as z.infer<typeof StatusSchema>,
    preferredStartDate: (row['preferred_start_date'] as string | null) ?? null,
    note: (row['note'] as string | null) ?? null,
    rejectReason: (row['reject_reason'] as string | null) ?? null,
    createdAt: (row['created_at'] as string | null) ?? null,
  };
}

const notParent = { error: '不是家長身分', code: 'NOT_PARENT' } as const;
const isParent = (roles: readonly string[] | undefined) => (roles ?? []).includes('parent');

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/enrollment-requests
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Parent'],
    summary: '家長：我的孩子的報名申請',
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': { schema: z.object({ data: z.array(EnrollmentRequestSchema) }) },
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
      .from('enrollment_requests', 'student_id')
      .select(SELECT);
    if (error) {
      return c.json({ error: '讀取報名申請失敗', code: 'FETCH_FAILED' }, 500);
    }

    // 最新在上（規格）。ponytail: 記憶體排序 —— 一個家長的申請是個位數到數十筆；真的多了改 DB order＋分頁
    const rows = ((data ?? []) as unknown as Record<string, unknown>[])
      .map(toResponse)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    return c.json({ data: rows }, 200);
  },
);

// POST /api/me/enrollment-requests
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Parent'],
    summary: '家長：送出報名申請（額滿時可登記候補）',
    request: { body: { content: { 'application/json': { schema: CreateSchema } } } },
    responses: {
      201: {
        description: '已送出（pending）或已登記候補（waitlist）',
        content: { 'application/json': { schema: EnrollmentRequestSchema } },
      },
      403: {
        description: '不是家長、或不是自己的孩子',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: '班級不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: 'CLASS_FULL／CLASS_NOT_OPEN／ALREADY_ENROLLED／DUPLICATE_REQUEST',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!isParent(c.get('roles'))) return c.json(notParent, 403);
    const body = c.req.valid('json');
    const childDb = c.get('childDb');

    // 先擋孩子 —— 不是自己的孩子就不必再查班級（`insert` 送 DB 前還會再擋一次）
    if (!isChildAllowed(c.get('studentScope'), body.studentId)) {
      return c.json({ error: '不是你的孩子', code: 'NOT_YOUR_CHILD' }, 403);
    }

    const { data: cls, error: classError } = await childDb
      .orgRef('classes')
      .select('id, max_students, is_active, end_date')
      .eq('id', body.classId)
      .maybeSingle();
    if (classError) return c.json({ error: '讀取班級失敗', code: 'SERVER_ERROR' }, 500);
    if (!cls) return c.json({ error: '班級不存在', code: 'CLASS_NOT_FOUND' }, 404);

    const klass = cls as unknown as {
      max_students: number | null;
      is_active: boolean;
      end_date: string | null;
    };
    // 停用、或已經結束（歸檔 = end_date 設成過去）的班不收申請
    if (!klass.is_active || (klass.end_date && klass.end_date < getCurrentTaipeiDateString())) {
      return c.json({ error: '這個班目前不開放報名', code: 'CLASS_NOT_OPEN' }, 409);
    }

    const [enrolled, open, seats] = await Promise.all([
      childDb
        .from('enrollments', 'student_id')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', body.studentId)
        .eq('class_id', body.classId)
        .in('status', ['active', 'pending_payment']),
      childDb
        .from('enrollment_requests', 'student_id')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', body.studentId)
        .eq('class_id', body.classId)
        .in('status', OPEN_STATUSES),
      childDb.activeEnrollmentCount(body.classId),
    ]);
    if (enrolled.error || open.error || seats.error) {
      return c.json({ error: '讀取報名狀態失敗', code: 'SERVER_ERROR' }, 500);
    }
    if ((enrolled.count ?? 0) > 0) {
      return c.json({ error: '孩子已經在這個班', code: 'ALREADY_ENROLLED' }, 409);
    }
    if ((open.count ?? 0) > 0) {
      return c.json({ error: '這個班已經有一筆申請在處理中', code: 'DUPLICATE_REQUEST' }, 409);
    }

    // 額滿在伺服器數（約束：不信 body）。家長沒選候補就不收 —— 前端據此問他要不要登記候補
    const full = seats.count >= (klass.max_students ?? Number.MAX_SAFE_INTEGER);
    if (full && body.waitlist !== true) {
      return c.json({ error: '這個班已額滿，可以登記候補', code: 'CLASS_FULL' }, 409);
    }

    const { data, error, outOfScope } = await childDb
      .from('enrollment_requests', 'student_id')
      .insert(
        {
          student_id: body.studentId,
          class_id: body.classId,
          status: full ? 'waitlist' : 'pending',
          preferred_start_date: body.preferredStartDate ?? null,
          note: body.note ?? null,
          requested_by: c.get('userId'),
        },
        SELECT,
      );
    if (outOfScope) return c.json({ error: '不是你的孩子', code: 'NOT_YOUR_CHILD' }, 403);
    if (error || !data) {
      // 兩個分頁同時送出：上面的檢查都過了，partial unique index 擋下第二筆
      if ((error as { code?: string } | null)?.code === '23505') {
        return c.json({ error: '這個班已經有一筆申請在處理中', code: 'DUPLICATE_REQUEST' }, 409);
      }
      return c.json({ error: '送出申請失敗', code: 'SERVER_ERROR' }, 500);
    }

    return c.json(toResponse(data as Record<string, unknown>), 201);
  },
);

// POST /api/me/enrollment-requests/:id/cancel
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel',
    tags: ['Parent'],
    summary: '家長：取消還沒核准的申請（待審核、候補）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '已取消',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      403: { description: '不是家長', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '申請不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: '已核准或已結束，不能取消',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!isParent(c.get('roles'))) return c.json(notParent, 403);
    const { id } = c.req.valid('param');
    const table = c.get('childDb').from('enrollment_requests', 'student_id');

    // 讀也走 scope：別人孩子的申請跟不存在一樣 404，不洩漏存在與否
    const { data: existing, error: readError } = await table
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (readError) return c.json({ error: '讀取申請失敗', code: 'SERVER_ERROR' }, 500);
    if (!existing) return c.json({ error: '申請不存在', code: 'NOT_FOUND' }, 404);
    if (!CANCELLABLE_STATUSES.includes((existing as unknown as { status: string }).status)) {
      return c.json({ error: '這筆申請已經在處理，請聯絡補習班', code: 'NOT_CANCELLABLE' }, 409);
    }

    // 狀態條件下在 update 上：讀完到寫之間被管理員核准的話，這裡改不到
    const { data: updated, error } = await table
      .update({ status: 'cancelled' })
      .eq('id', id)
      .in('status', CANCELLABLE_STATUSES)
      .select('id');
    if (error) return c.json({ error: '取消失敗', code: 'SERVER_ERROR' }, 500);
    if (!updated || updated.length === 0) {
      return c.json({ error: '這筆申請已經在處理，請聯絡補習班', code: 'NOT_CANCELLABLE' }, 409);
    }

    return c.json({ success: true }, 200);
  },
);

export default app;
