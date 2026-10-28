import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import type { AppEnv } from '../index';
import { getCampusScope } from '../lib/campus-scope';
import { studentWriteScope } from '../lib/campus-write-guard';
import { printCards, reissueCard, revokeCard, type CardActor } from '../lib/checkin-cards';
import { hasPermission } from '../lib/permissions';
import { DbUuidSchema } from '../lib/validation';
import { waitUntilFrom } from '../lib/wait-until';
import { requireAdminPermission } from '../middleware/auth';
import { logAudit } from '../utils/audit';

/**
 * 到班卡（#1100 #42）。權限（計畫席 10-28 裁定，掛載層先要求 `basic_operations` 或 `manage_students` 任一）：
 * - 重印（已有有效卡）：`basic_operations` 就可以 —— 同一張卡，沒有發出新的憑證
 * - 新開（還沒有卡）、補發、作廢：`manage_students` —— 等於發放或收回一個身分憑證
 *
 * 稽核掛在學生底下（`resourceType: 'student'`）：`audit_logs.resource_type` 有 CHECK，
 * 另開一個值要 migration，而卡片本來就是學生的。
 */

const ReasonSchema = z.object({ reason: z.string().trim().min(1).max(200) });
const StudentParam = z.object({ studentId: DbUuidSchema });

const POOL_UNAVAILABLE = { error: '資料庫連線不可用', code: 'POOL_UNAVAILABLE' } as const;
const NOT_FOUND = { error: '學生不存在', code: 'NOT_FOUND' } as const;

const app = new OpenAPIHono<AppEnv>();

const requireManageStudents = requireAdminPermission('manage_students');
app.use('/:studentId/reissue', requireManageStudents);
app.use('/:studentId/revoke', requireManageStudents);

const actorOf = (c: Context<AppEnv>): CardActor => ({
  orgId: c.get('orgId'),
  userId: c.get('userId'),
  scope: getCampusScope(c),
});

// GET /api/checkin-cards/students/:studentId —— 學生詳情頁：現在的卡
app.openapi(
  createRoute({
    method: 'get',
    path: '/students/{studentId}',
    tags: ['CheckinCards'],
    summary: '學生目前的到班卡',
    request: { params: StudentParam },
    responses: {
      200: {
        description: '有效卡（沒有則 null）；`hasAnyCard`＝印過新卡（舊版 UUID 卡已失效）',
        content: {
          'application/json': {
            schema: z.object({
              active: z.object({ code: z.string(), issuedAt: z.string() }).nullable(),
              hasAnyCard: z.boolean(),
            }),
          },
        },
      },
      403: { description: '不在分校範圍' },
      404: { description: '學生不存在' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { studentId } = c.req.valid('param');
    const scoped = await studentWriteScope(supabase, orgId, getCampusScope(c), studentId);
    if (scoped === 'not-found') return c.json(NOT_FOUND, 404);
    if (scoped === 'out-of-scope') {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }
    const { data, error } = await supabase
      .from('checkin_cards')
      .select('code, issued_at, revoked_at')
      .eq('org_id', orgId)
      .eq('student_id', studentId);
    if (error) return c.json({ error: '讀取到班卡失敗', message: error.message }, 500);
    const rows = (data ?? []) as Array<{
      code: string;
      issued_at: string;
      revoked_at: string | null;
    }>;
    const active = rows.find((r) => r.revoked_at === null);
    return c.json(
      {
        active: active ? { code: active.code, issuedAt: active.issued_at } : null,
        hasAnyCard: rows.length > 0,
      },
      200,
    );
  },
);

// POST /api/checkin-cards/print —— 印卡（單張／本頁批次）
app.openapi(
  createRoute({
    method: 'post',
    path: '/print',
    tags: ['CheckinCards'],
    summary: '印到班卡：有有效卡就重印同一張，沒有就開新卡',
    request: {
      body: {
        content: {
          'application/json': {
            // 上限跟學生列表一頁的最大筆數同級；再多就分批印
            schema: z.object({ studentIds: z.array(DbUuidSchema).min(1).max(200) }),
          },
        },
      },
    },
    responses: {
      200: {
        description: '要印的卡，順序同 studentIds',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  studentId: DbUuidSchema,
                  studentName: z.string(),
                  code: z.string(),
                  issued: z.boolean(),
                }),
              ),
            }),
          },
        },
      },
      403: { description: '有學生還沒有卡，新開要 manage_students（NEEDS_MANAGE_STUDENTS）' },
      404: { description: '有學生不存在或不在分校範圍（整批不動）' },
    },
  }),
  async (c) => {
    const pool = c.get('auth')?.pool;
    if (!pool) return c.json(POOL_UNAVAILABLE, 500);
    const { studentIds } = c.req.valid('json');
    const actor = actorOf(c);
    const canIssue = hasPermission(c.get('permissions') ?? [], 'manage_students');

    let out: Awaited<ReturnType<typeof printCards>>;
    try {
      out = await printCards(pool, actor, studentIds, canIssue);
    } catch (err) {
      return c.json({ error: '印卡失敗', message: (err as Error).message ?? '' }, 500);
    }
    if (!out.ok && out.reason === 'NOT_FOUND') return c.json(NOT_FOUND, 404);
    if (!out.ok) {
      return c.json(
        {
          error: '有學生還沒有到班卡，第一次發卡要有「學生管理」權限',
          code: 'NEEDS_MANAGE_STUDENTS',
          studentIds: out.reason === 'NEEDS_ISSUE' ? out.studentIds : [],
        },
        403,
      );
    }

    for (const card of out.cards) {
      logAudit(
        c.get('supabase'),
        {
          orgId: actor.orgId,
          userId: actor.userId,
          resourceType: 'student',
          resourceId: card.studentId,
          resourceName: card.studentName,
          action: card.issued ? 'issue_checkin_card' : 'reprint_checkin_card',
          details: {},
        },
        waitUntilFrom(c),
      );
    }
    return c.json({ data: out.cards }, 200);
  },
);

const ReissueResponse = z.object({
  studentId: DbUuidSchema,
  studentName: z.string(),
  code: z.string(),
});

// POST /api/checkin-cards/:studentId/reissue —— 補發（作廢舊卡＋開新卡，同一交易）
app.openapi(
  createRoute({
    method: 'post',
    path: '/{studentId}/reissue',
    tags: ['CheckinCards'],
    summary: '補發到班卡：舊卡立即作廢',
    request: {
      params: StudentParam,
      body: { content: { 'application/json': { schema: ReasonSchema } } },
    },
    responses: {
      200: { description: '新卡', content: { 'application/json': { schema: ReissueResponse } } },
      404: { description: '學生不存在或不在分校範圍' },
    },
  }),
  async (c) => {
    const pool = c.get('auth')?.pool;
    if (!pool) return c.json(POOL_UNAVAILABLE, 500);
    const { studentId } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const actor = actorOf(c);

    let out: Awaited<ReturnType<typeof reissueCard>>;
    try {
      out = await reissueCard(pool, actor, studentId, reason);
    } catch (err) {
      return c.json({ error: '補發失敗', message: (err as Error).message ?? '' }, 500);
    }
    if (!out.ok) return c.json(NOT_FOUND, 404);

    logAudit(
      c.get('supabase'),
      {
        orgId: actor.orgId,
        userId: actor.userId,
        resourceType: 'student',
        resourceId: studentId,
        resourceName: out.studentName,
        action: 'reissue_checkin_card',
        // 代碼本身就是憑證，稽核只記「有沒有作廢到舊卡」
        details: { reason, revokedPrevious: out.revokedCode !== null },
      },
      waitUntilFrom(c),
    );
    return c.json({ studentId, studentName: out.studentName, code: out.code }, 200);
  },
);

// POST /api/checkin-cards/:studentId/revoke —— 只作廢、不補發
app.openapi(
  createRoute({
    method: 'post',
    path: '/{studentId}/revoke',
    tags: ['CheckinCards'],
    summary: '作廢到班卡（不補發）',
    request: {
      params: StudentParam,
      body: { content: { 'application/json': { schema: ReasonSchema } } },
    },
    responses: {
      204: { description: '已作廢' },
      404: { description: '學生不存在或不在分校範圍' },
      409: { description: '這位學生沒有有效卡（NO_ACTIVE_CARD）' },
    },
  }),
  async (c) => {
    const pool = c.get('auth')?.pool;
    if (!pool) return c.json(POOL_UNAVAILABLE, 500);
    const { studentId } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const actor = actorOf(c);

    let out: Awaited<ReturnType<typeof revokeCard>>;
    try {
      out = await revokeCard(pool, actor, studentId, reason);
    } catch (err) {
      return c.json({ error: '作廢失敗', message: (err as Error).message ?? '' }, 500);
    }
    if (!out.ok && out.reason === 'NOT_FOUND') return c.json(NOT_FOUND, 404);
    if (!out.ok) {
      return c.json({ error: '這位學生沒有有效的到班卡', code: 'NO_ACTIVE_CARD' }, 409);
    }

    logAudit(
      c.get('supabase'),
      {
        orgId: actor.orgId,
        userId: actor.userId,
        resourceType: 'student',
        resourceId: studentId,
        resourceName: out.studentName,
        action: 'revoke_checkin_card',
        details: { reason },
      },
      waitUntilFrom(c),
    );
    return c.body(null, 204);
  },
);

export default app;
