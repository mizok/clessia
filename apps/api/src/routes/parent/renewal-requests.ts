import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { DbUuidSchema } from '../../lib/validation';
import { waitUntilFrom } from '../../lib/wait-until';

/**
 * 家長端續課異動申請（#1122，gate 見 issue 留言）。
 *
 * - 對「下期續課預覽」的某一門課送（只收這個孩子**在讀的期繳**報名 —— 預覽只列期繳，#1121）
 * - 一生同時一筆 pending（DB 部分唯一索引；pending＝這個孩子暫停自動開單，Q1 (a)）
 * - 送出後通知該班分校、有 `manage_students` 的管理員（Q6 (a)），背景跑、失敗不擋
 * - 家長可以撤回還在處理中的（Q2 (b)）—— 撤回＝暫停解除
 */

const KINDS = ['transfer', 'stop', 'billing_mode'] as const;

export const RenewalRequestSchema = z
  .object({
    id: DbUuidSchema,
    enrollmentId: DbUuidSchema,
    kind: z.enum(KINDS),
    detail: z.string(),
    note: z.string().nullable(),
    status: z.enum(['pending', 'resolved', 'withdrawn']),
    createdAt: z.string(),
  })
  .openapi('ParentRenewalRequest');

const CreateSchema = z
  .object({
    childId: DbUuidSchema,
    enrollmentId: DbUuidSchema,
    kind: z.enum(KINDS),
    detail: z.string().trim().min(1).max(500),
    note: z.string().trim().max(200).nullish(),
  })
  .openapi('ParentRenewalRequestCreate');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('ParentRenewalRequestError');

export const SELECT = 'id, enrollment_id, kind, detail, note, status, created_at';
export const toRenewalRequest = (row: Record<string, unknown>) => ({
  id: row['id'] as string,
  enrollmentId: row['enrollment_id'] as string,
  kind: row['kind'] as (typeof KINDS)[number],
  detail: row['detail'] as string,
  note: (row['note'] as string | null) ?? null,
  status: row['status'] as 'pending' | 'resolved' | 'withdrawn',
  createdAt: row['created_at'] as string,
});

const notParent = { error: '不是家長身分', code: 'NOT_PARENT' } as const;
const duplicate = { error: '已有處理中的異動申請', code: 'DUPLICATE_REQUEST' } as const;

const app = new OpenAPIHono<AppEnv>();

// POST /api/me/renewal-requests
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Parent'],
    summary: '家長：送出續課異動申請（該生暫停自動開單）',
    request: { body: { content: { 'application/json': { schema: CreateSchema } } } },
    responses: {
      201: {
        description: '已送出',
        content: { 'application/json': { schema: RenewalRequestSchema } },
      },
      403: {
        description: '不是家長、或不是自己的孩子',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: '不是這個孩子在讀的期繳報名',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '已有處理中的申請',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(c.get('roles') ?? []).includes('parent')) return c.json(notParent, 403);
    const body = c.req.valid('json');
    if (!isChildAllowed(c.get('studentScope'), body.childId)) {
      return c.json({ error: '不是你的孩子', code: 'NOT_YOUR_CHILD' }, 403);
    }
    const childDb = c.get('childDb');

    const [enrollment, open] = await Promise.all([
      childDb
        .from('enrollments', 'student_id')
        .select('id')
        .eq('id', body.enrollmentId)
        .eq('student_id', body.childId)
        .eq('status', 'active')
        .eq('billing_mode', 'period')
        .limit(1),
      childDb
        .from('renewal_requests', 'student_id')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', body.childId)
        .eq('status', 'pending'),
    ]);
    if (enrollment.error || open.error) {
      return c.json({ error: '讀取續課資料失敗', code: 'SERVER_ERROR' }, 500);
    }
    if (((enrollment.data ?? []) as unknown[]).length === 0) {
      return c.json({ error: '找不到這門續課', code: 'ENROLLMENT_NOT_FOUND' }, 404);
    }
    if ((open.count ?? 0) > 0) return c.json(duplicate, 409);

    const { data, error, outOfScope } = await childDb.from('renewal_requests', 'student_id').insert(
      {
        student_id: body.childId,
        enrollment_id: body.enrollmentId,
        kind: body.kind,
        detail: body.detail,
        note: body.note || null,
        status: 'pending',
        requested_by: c.get('userId'),
      },
      SELECT,
    );
    if (outOfScope) return c.json({ error: '不是你的孩子', code: 'NOT_YOUR_CHILD' }, 403);
    if (error || !data) {
      // 兩個分頁同時送出：上面的檢查都過了，部分唯一索引擋下第二筆
      if ((error as { code?: string } | null)?.code === '23505') return c.json(duplicate, 409);
      return c.json({ error: '送出申請失敗', code: 'SERVER_ERROR' }, 500);
    }

    const row = data as Record<string, unknown>;
    const job = childDb.notifyRenewalRequest(row['id'] as string);
    const wu = waitUntilFrom(c);
    if (wu) wu(job);
    else await job;

    return c.json(toRenewalRequest(row), 201);
  },
);

// POST /api/me/renewal-requests/:id/withdraw
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/withdraw',
    tags: ['Parent'],
    summary: '家長：撤回處理中的續課異動申請（暫停自動開單隨之解除）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '已撤回',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      403: { description: '不是家長', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '申請不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: '管理員已處理，不能撤回',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(c.get('roles') ?? []).includes('parent')) return c.json(notParent, 403);
    const { id } = c.req.valid('param');
    const table = c.get('childDb').from('renewal_requests', 'student_id');

    // 讀也走 scope：別人孩子的申請跟不存在一樣 404
    const { data: existing, error: readError } = await table
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (readError) return c.json({ error: '讀取申請失敗', code: 'SERVER_ERROR' }, 500);
    if (!existing) return c.json({ error: '申請不存在', code: 'NOT_FOUND' }, 404);
    const handled = { error: '補習班已經處理這筆申請', code: 'NOT_WITHDRAWABLE' } as const;
    if ((existing as unknown as { status: string }).status !== 'pending') {
      return c.json(handled, 409);
    }

    // 狀態條件下在 update 上：讀完到寫之間被管理員結案的話，這裡改不到
    const { data: updated, error } = await table
      .update({ status: 'withdrawn' })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) return c.json({ error: '撤回失敗', code: 'SERVER_ERROR' }, 500);
    if (!updated || updated.length === 0) return c.json(handled, 409);
    return c.json({ success: true }, 200);
  },
);

export default app;
