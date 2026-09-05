import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { loadTeachingScope, taughtClassIds } from '../lib/teacher-scope';
import { logAudit } from '../utils/audit';
import { waitUntilFrom } from '../lib/wait-until';
import { CLASS_LOG_SELECT, toClassLogResponse } from '../lib/class-log-query';

/**
 * 教務日誌（國中模式）：班級 × 日期，一班一天一篇 —— 教學紀錄 + 作業安排。
 *
 * 跟個人聯絡簿（學生 × 日期）是**兩個不同的東西**，也跟既有的 `teaching-log-dialog`
 * 無關（那是授課時數統計）。設計真相：kb/wiki/rules/teaching-log-rules.md
 *
 * `published_at` 是廣播扳機：NULL = 草稿，有值 = 已發布。發布之後家長端可見、
 * LINE 推播與群組組稿都掛在這個時間點上 —— 但**那些都是 P4**，這支只到設定
 * published_at 為止。
 */
const app = new OpenAPIHono<AppEnv>();

const ClassLogSchema = z
  .object({
    id: z.uuid(),
    classId: z.uuid(),
    className: z.string().nullable(),
    logDate: z.string(),
    teachingRecord: z.string(),
    homework: z.string(),
    lastEditedByName: z.string().nullable(),
    publishedAt: z.string().nullable(),
    isPublished: z.boolean(),
  })
  .openapi('ClassLog');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('ClassLogError');

const ListResponseSchema = z
  .object({
    data: z.array(ClassLogSchema),
    meta: z.object({ total: z.number().int().min(0) }),
  })
  .openapi('ClassLogListResponse');

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必須是 YYYY-MM-DD');

const UpsertSchema = z
  .object({
    classId: DbUuidSchema,
    logDate: DateSchema,
    // 兩欄都可以留白：老師可能先寫作業、下課後再補教學紀錄
    teachingRecord: z.string().max(5000).optional(),
    homework: z.string().max(5000).optional(),
  })
  .openapi('UpsertClassLog');

// ── GET /api/class-logs ────────────────────────────────────────────────────
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['ClassLogs'],
    summary: '教務日誌列表',
    request: {
      query: z.object({
        classId: DbUuidSchema.optional(),
        from: DateSchema.optional(),
        to: DateSchema.optional(),
        /** 只看草稿或只看已發布；省略＝兩者都要 */
        published: z.enum(['true', 'false']).optional(),
      }),
    },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: ListResponseSchema } } },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { classId, from, to, published } = c.req.valid('query');

    const scope = await loadTeachingScope(supabase, {
      orgId,
      userId: c.get('userId'),
      roles: c.get('roles') ?? [],
    });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    let query = supabase
      .from('class_logs')
      .select(CLASS_LOG_SELECT, { count: 'exact' })
      .eq('org_id', orgId)
      .order('log_date', { ascending: false });

    if (classId) query = query.eq('class_id', classId);
    if (from) query = query.gte('log_date', from);
    if (to) query = query.lte('log_date', to);
    if (published === 'true') query = query.not('published_at', 'is', null);
    if (published === 'false') query = query.is('published_at', null);

    if (scope.teacherStaffId) {
      const allowed = await taughtClassIds(supabase, orgId, scope.teacherStaffId);
      if (allowed.length === 0) {
        return c.json({ data: [], meta: { total: 0 } }, 200);
      }
      query = query.in('class_id', allowed);
    }

    const { data, count, error } = await query;
    if (error) return c.json({ error: '讀取教務日誌失敗', code: error.code }, 500);

    return c.json(
      {
        data: (data ?? []).map((row) =>
          toClassLogResponse(row as unknown as Record<string, unknown>),
        ),
        meta: { total: count ?? 0 },
      },
      200,
    );
  },
);

// ── PUT /api/class-logs —— 一班一天一篇的 upsert ────────────────────────────
app.openapi(
  createRoute({
    method: 'put',
    path: '/',
    tags: ['ClassLogs'],
    summary: '寫入教務日誌（一班一天一篇，重複寫入視為共同編輯）',
    request: { body: { content: { 'application/json': { schema: UpsertSchema } } } },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: ClassLogSchema } } },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { classId, logDate, teachingRecord, homework } = c.req.valid('json');

    const scope = await loadTeachingScope(supabase, {
      orgId,
      userId,
      roles: c.get('roles') ?? [],
    });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    if (scope.teacherStaffId) {
      const allowed = await taughtClassIds(supabase, orgId, scope.teacherStaffId);
      if (!allowed.includes(classId)) {
        return c.json({ error: '這個班不在你的任課範圍', code: 'FORBIDDEN' }, 403);
      }
    }

    const { data, error } = await supabase
      .from('class_logs')
      .upsert(
        {
          org_id: orgId,
          class_id: classId,
          log_date: logDate,
          teaching_record: teachingRecord ?? '',
          homework: homework ?? '',
          last_edited_by: userId,
        },
        { onConflict: 'class_id,log_date' },
      )
      .select(CLASS_LOG_SELECT)
      .single();

    if (error || !data) {
      return c.json({ error: '寫入教務日誌失敗', code: error?.code }, 500);
    }

    const response = toClassLogResponse(data as unknown as Record<string, unknown>);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class_log',
        resourceId: response.id,
        resourceName: `${response.className ?? response.classId} / ${logDate}`,
        action: 'upsert',
      },
      waitUntilFrom(c),
    );

    return c.json(response, 200);
  },
);

// ── POST /api/class-logs/{id}/publish —— 廣播扳機 ──────────────────────────
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/publish',
    tags: ['ClassLogs'],
    summary: '發布教務日誌（設定 published_at）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: ClassLogSchema } } },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '找不到', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    const scope = await loadTeachingScope(supabase, {
      orgId,
      userId,
      roles: c.get('roles') ?? [],
    });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    const { data: existing } = await supabase
      .from('class_logs')
      .select('id, class_id, published_at')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!existing) {
      return c.json({ error: '找不到這篇教務日誌', code: 'NOT_FOUND' }, 404);
    }

    if (scope.teacherStaffId) {
      const allowed = await taughtClassIds(supabase, orgId, scope.teacherStaffId);
      if (!allowed.includes(existing['class_id'] as string)) {
        return c.json({ error: '這個班不在你的任課範圍', code: 'FORBIDDEN' }, 403);
      }
    }

    // 已經發布過就不重設時間 —— published_at 是「第一次公開」的時間點，
    // 之後 P4 的推播要靠它判斷有沒有送過。
    const publishedAt = (existing['published_at'] as string | null) ?? new Date().toISOString();

    const { data, error } = await supabase
      .from('class_logs')
      .update({ published_at: publishedAt, last_edited_by: userId })
      .eq('id', id)
      .eq('org_id', orgId)
      .select(CLASS_LOG_SELECT)
      .single();

    if (error || !data) {
      return c.json({ error: '發布失敗', code: error?.code }, 500);
    }

    const response = toClassLogResponse(data as unknown as Record<string, unknown>);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class_log',
        resourceId: response.id,
        resourceName: `${response.className ?? response.classId} / ${response.logDate}`,
        action: 'publish',
      },
      waitUntilFrom(c),
    );

    return c.json(response, 200);
  },
);

export default app;
