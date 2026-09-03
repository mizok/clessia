import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { requireRoles } from '../middleware/auth';
import { audienceFor, campusOrFilter } from './announcements/visibility';
import { campusFilterIds } from '../lib/campus-scope';

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
    // **公告不能用 `.in()` 過濾分校** —— `campus_id` 為 null 代表「全分校公告」，
    // `.in()` 會把它們一起排除掉，受限的管理員就看不到全機構公告了。
    // 用跟收件匣同一支 `campusOrFilter`（`campus_id is null OR campus_id in (…)`）。
    const campusIds = campusFilterIds(c.get('campusScope'), campusId);
    if (campusIds) {
      query = query.or(campusOrFilter(campusIds));
    }

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

    // 全分校公告（campus_id is null）加上自己分校的。**跟「全部標為已讀」共用同一份** ——
    // 兩邊各長一份的話，全部已讀會標到看不見的、或漏掉看得見的，而兩種都不會報錯
    const campusFilter = campusOrFilter(campusIds);

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

// ── POST /api/announcements/read-all —— 全部標為已讀 ────────────────────────
//
// 前端已經有「逐一呼叫 `/{id}/read`」的版本。這支是**效率與原子性的升級**：
// 30 則公告從 30 次往返變成 1 次，而且要嘛全標要嘛都沒標 ——
// 逐一版在中途失敗時會留下一半已讀，而使用者看到的是「按了但紅點還在」。
//
// **可見範圍與收件匣同源**（`campusOrFilter` + `audienceFor`）。兩邊各算一次的話，
// 這支會標到使用者看不見的公告（多標，之後那些公告永遠不會再出現在他的未讀裡），
// 或漏掉看得見的（少標，按完紅點還在）—— **兩種都不報錯**。
app.openapi(
  createRoute({
    method: 'post',
    path: '/read-all',
    tags: ['Announcements'],
    summary: '把收件匣裡的公告全部標為已讀',
    responses: {
      200: {
        description: '已標記',
        content: {
          'application/json': {
            schema: z.object({ marked: z.number().int().nonnegative() }),
          },
        },
      },
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

    const { data: visible, error: visibleError } = await supabase
      .from('announcements')
      .select('id')
      .eq('org_id', orgId)
      .eq('audience', audience)
      .or(campusOrFilter(campusIds));

    if (visibleError) return c.json({ error: visibleError.message }, 500);

    const ids = ((visible ?? []) as Array<{ id: string }>).map((row) => row.id);
    // 收件匣是空的就沒有東西可標 —— 回 0 而不是打一支空的 upsert
    if (ids.length === 0) return c.json({ marked: 0 }, 200);

    // 一次 upsert，**一個語句就是一個 transaction** —— 這是「原子性升級」的實質。
    // 重複標記是正常操作（重新整理、多分頁），複合主鍵讓它天然冪等。
    const { error } = await supabase.from('announcement_reads').upsert(
      ids.map((announcementId) => ({ announcement_id: announcementId, user_id: userId })),
      { onConflict: 'announcement_id,user_id' },
    );

    if (error) return c.json({ error: error.message }, 500);

    // 回「這次涵蓋了幾則」而不是「新標了幾則」：upsert 不區分新增與既有，
    // 硬要區分得先查一次已讀，那就多一次往返 —— 而前端要的是「按完之後未讀是 0」，
    // 不是「這次新標了幾則」
    return c.json({ marked: ids.length }, 200);
  },
);

export default app;
