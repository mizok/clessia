import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

// ============================================================
// Schemas
// ============================================================

const AuditLogSchema = z
  .object({
    id: z.string(),
    userId: z.string().nullable(),
    userName: z.string().nullable(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    resourceName: z.string().nullable(),
    action: z.string(),
    details: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .openapi('AuditLog');

const AuditLogListResponseSchema = z
  .object({
    data: z.array(AuditLogSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('AuditLogListResponse');

const QueryParamsSchema = z.object({
  resourceTypes: z.string().optional().openapi({ description: '逗號分隔的資源類型，如 class,course' }),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/audit-logs
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['AuditLogs'],
    summary: '取得操作紀錄列表',
    request: { query: QueryParamsSchema },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: AuditLogListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const query = c.req.valid('query');

    const page = parseInt(query.page || '1');
    const pageSize = parseInt(query.pageSize || '30');
    const offset = (page - 1) * pageSize;

    let dbQuery = supabase
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (query.resourceTypes) {
      const types = query.resourceTypes.split(',').map((t) => t.trim()).filter(Boolean);
      if (types.length > 0) {
        dbQuery = dbQuery.in('resource_type', types);
      }
    }

    const { data, count, error } = await dbQuery;

    if (error) {
      console.error('[audit-logs] DB error:', error);
    }

    const rows = data || [];
    const total = count || 0;

    return c.json({
      data: rows.map((row) => ({
        id: row.id as string,
        userId: (row.user_id as string | null) ?? null,
        userName: (row.user_name as string | null) ?? null,
        resourceType: row.resource_type as string,
        resourceId: (row.resource_id as string | null) ?? null,
        resourceName: (row.resource_name as string | null) ?? null,
        action: row.action as string,
        details: (row.details as Record<string, unknown>) ?? {},
        createdAt: row.created_at as string,
      })),
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  }
);

export default app;
