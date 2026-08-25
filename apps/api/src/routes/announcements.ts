import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { requireRoles } from '../middleware/auth';
import { audienceFor } from './announcements/visibility';

const app = new OpenAPIHono<AppEnv>();

const AudienceSchema = z.enum(['all_teachers', 'all_parents']).openapi('AnnouncementAudience');

const AnnouncementSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    body: z.string(),
    audience: AudienceSchema,
    campusId: z.uuid().nullable(),
    campusName: z.string().nullable(),
    publishedAt: z.string(),
    createdByName: z.string().nullable(),
    /** 只有收件匣會用到；管理端列表一律 false */
    isRead: z.boolean(),
  })
  .openapi('Announcement');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('AnnouncementError');

const ListResponseSchema = z
  .object({
    data: z.array(AnnouncementSchema),
    meta: z.object({ total: z.number().int().min(0), unread: z.number().int().min(0) }),
  })
  .openapi('AnnouncementListResponse');

const CreateSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
    audience: AudienceSchema,
    /** null / 省略 = 全分校 */
    campusId: DbUuidSchema.nullable().optional(),
  })
  .openapi('CreateAnnouncement');

interface AnnouncementDbRow {
  id: string;
  title: string;
  body: string;
  audience: 'all_teachers' | 'all_parents';
  campus_id: string | null;
  published_at: string;
  campuses?: { name: string } | null;
  creator?: { name: string } | null;
}

const SELECT =
  'id, title, body, audience, campus_id, published_at, campuses(name), creator:ba_user!created_by(name)';

function toResponse(row: AnnouncementDbRow, readIds: ReadonlySet<string>) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    campusId: row.campus_id,
    campusName: row.campuses?.name ?? null,
    publishedAt: row.published_at,
    createdByName: row.creator?.name ?? null,
    isRead: readIds.has(row.id),
  };
}

// ── GET /api/announcements —— 管理端：我發過哪些 ────────────────────────────
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Announcements'],
    summary: '公告列表（管理端）',
    middleware: [requireRoles('admin')] as const,
    request: {
      query: z.object({
        audience: AudienceSchema.optional(),
        campusId: DbUuidSchema.optional(),
      }),
    },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: ListResponseSchema } } },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { audience, campusId } = c.req.valid('query');

    let query = supabase
      .from('announcements')
      .select(SELECT, { count: 'exact' })
      .eq('org_id', orgId)
      .order('published_at', { ascending: false });

    if (audience) query = query.eq('audience', audience);
    if (campusId) query = query.eq('campus_id', campusId);

    const { data, count, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    const rows = (data ?? []) as unknown as AnnouncementDbRow[];
    return c.json(
      {
        data: rows.map((row) => toResponse(row, new Set())),
        meta: { total: count ?? 0, unread: 0 },
      },
      200,
    );
  },
);

// ── GET /api/announcements/inbox —— 收件匣 ──────────────────────────────────
app.openapi(
  createRoute({
    method: 'get',
    path: '/inbox',
    tags: ['Announcements'],
    summary: '我的收件匣',
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: ListResponseSchema } } },
      403: {
        description: '沒有收件角色',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');

    const audience = audienceFor(c.get('roles') ?? []);
    if (!audience) {
      return c.json({ error: '沒有收件匣', code: 'NO_INBOX' }, 403);
    }

    // 這個人隸屬哪些分校 —— 分校範圍的過濾條件
    const { data: staffRow } = await supabase
      .from('staff')
      .select('id')
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .maybeSingle();

    let campusIds: string[] = [];
    if (staffRow?.id) {
      const { data: campusRows } = await supabase
        .from('staff_campuses')
        .select('campus_id')
        .eq('staff_id', staffRow.id as string);
      campusIds = (campusRows ?? []).map((r) => r['campus_id'] as string);
    }

    // 全分校公告（campus_id is null）加上自己分校的
    const campusFilter =
      campusIds.length > 0
        ? `campus_id.is.null,campus_id.in.(${campusIds.join(',')})`
        : 'campus_id.is.null';

    const { data, count, error } = await supabase
      .from('announcements')
      .select(SELECT, { count: 'exact' })
      .eq('org_id', orgId)
      .eq('audience', audience)
      .or(campusFilter)
      .order('published_at', { ascending: false });

    if (error) return c.json({ error: error.message }, 500);

    const rows = (data ?? []) as unknown as AnnouncementDbRow[];

    const { data: readRows } = await supabase
      .from('announcement_reads')
      .select('announcement_id')
      .eq('user_id', userId);
    const readIds = new Set((readRows ?? []).map((r) => r['announcement_id'] as string));

    return c.json(
      {
        data: rows.map((row) => toResponse(row, readIds)),
        meta: {
          total: count ?? 0,
          unread: rows.filter((row) => !readIds.has(row.id)).length,
        },
      },
      200,
    );
  },
);

// ── POST /api/announcements —— 發布 ─────────────────────────────────────────
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Announcements'],
    summary: '發布公告',
    middleware: [requireRoles('admin')] as const,
    request: { body: { content: { 'application/json': { schema: CreateSchema } } } },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: z.object({ data: AnnouncementSchema }) } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('announcements')
      .insert({
        org_id: orgId,
        title: body.title.trim(),
        body: body.body.trim(),
        audience: body.audience,
        campus_id: body.campusId ?? null,
        created_by: c.get('userId'),
      })
      .select(SELECT)
      .single();

    if (error) return c.json({ error: error.message }, 500);

    return c.json({ data: toResponse(data as unknown as AnnouncementDbRow, new Set()) }, 201);
  },
);

// ── POST /api/announcements/{id}/read —— 標為已讀 ───────────────────────────
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/read',
    tags: ['Announcements'],
    summary: '標記為已讀',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      204: { description: '已標記' },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');

    // 重複標記是正常操作（重新整理、多分頁），複合主鍵讓它天然冪等
    const { error } = await supabase
      .from('announcement_reads')
      .upsert(
        { announcement_id: id, user_id: c.get('userId') },
        { onConflict: 'announcement_id,user_id' },
      );

    if (error) return c.json({ error: error.message }, 500);

    return c.body(null, 204);
  },
);

export default app;
