import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../index';
import { taughtClassIds } from '../lib/teacher-scope';
import { describeChange, type ChangeLogRow } from './sessions/change-log';

/**
 * 老師端「這週你的課務異動」（#1488，TS7）。
 *
 * **獨立 mount、只開 teacher**：`/api/sessions` 是 ADMIN_ONLY，而那邊的 `/changes` 沒有老師範圍。
 *
 * **範圍永遠由本人 staff.id 決定，不走 `resolveTeachingScope`**：它對 admin 角色回 null（＝全校），
 * 同時有 admin 與 teacher 角色的帳號打這支就會變全校。這支的「自己的」就是自己的；
 * 管理員要看全部走 `/api/sessions/changes`。
 *
 * 可見課堂 ＝ 區間內，任課班（`schedules.teacher_id`，#1098 判準）的課堂，加上 `sessions.teacher_id`
 * 是本人的課堂（代課）。先查課堂 id 再查異動（兩步），避開 embedded `or` 的行為差異。
 * 操作者姓名不給老師（`createdByName` 一律 null）。
 */

const MAX_RANGE_DAYS = 31;

const QuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const EntrySchema = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    changeType: z.string(),
    summary: z.string(),
    sessionDate: z.string().nullable(),
    className: z.string().nullable(),
    reason: z.string().nullable(),
    createdByName: z.string().nullable(),
    createdAt: z.string(),
    isBatch: z.boolean(),
    batchId: z.string().nullable(),
  })
  .openapi('TeacherSessionChange');

const ErrorSchema = z.object({ error: z.string(), code: z.string().optional() });

const route = createRoute({
  method: 'get',
  path: '/',
  tags: ['Teacher'],
  summary: '老師自己任課班（含代課）的課務異動，預設本週',
  request: { query: QuerySchema },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(EntrySchema),
            meta: z.object({ total: z.number(), page: z.number(), pageSize: z.number() }),
          }),
        },
      },
    },
    400: { description: '區間不合法', content: { 'application/json': { schema: ErrorSchema } } },
    403: { description: '不是教職員', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 台北時區的本週（週一～週日） */
function thisWeek(now = Date.now()): { from: string; to: string } {
  const taipei = now + 8 * 3_600_000;
  const monday = taipei - ((new Date(taipei).getUTCDay() + 6) % 7) * DAY_MS;
  return { from: iso(monday), to: iso(monday + 6 * DAY_MS) };
}

const app = new OpenAPIHono<AppEnv>();

app.openapi(route, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { page, pageSize, ...range } = c.req.valid('query');
  const week = thisWeek();
  const from = range.from ?? week.from;
  const to = range.to ?? week.to;

  if (to < from || (Date.parse(to) - Date.parse(from)) / DAY_MS > MAX_RANGE_DAYS) {
    return c.json({ error: `區間不合法（最長 ${MAX_RANGE_DAYS} 天）`, code: 'INVALID_RANGE' }, 400);
  }

  const { data: staff, error: staffError } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (staffError) throw new Error(`查詢教職員身分失敗：${staffError.message}`);
  if (!staff) return c.json({ error: '不是教職員', code: 'NOT_STAFF' }, 403);
  const staffId = staff['id'] as string;

  const classIds = await taughtClassIds(supabase, orgId, staffId);
  const mine = [`teacher_id.eq.${staffId}`];
  if (classIds.length > 0) mine.push(`class_id.in.(${classIds.join(',')})`);
  const sessions = await supabase
    .from('sessions')
    .select('id')
    .eq('org_id', orgId)
    .gte('session_date', from)
    .lte('session_date', to)
    .or(mine.join(','));
  if (sessions.error) throw new Error(`查詢可見課堂失敗：${sessions.error.message}`);
  const sessionIds = (sessions.data ?? []).map((r) => r['id'] as string);
  if (sessionIds.length === 0) return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);

  const changes = await supabase
    .from('schedule_changes')
    .select(
      `
      id, session_id, change_type, operation_source, batch_id, reason, created_by_name, created_at,
      original_session_date, original_start_time, original_end_time,
      new_session_date, new_start_time, new_end_time,
      original_teacher_name,
      sessions!inner ( session_date, classes!inner ( name ) ),
      staff!substitute_teacher_id ( display_name )
    `,
      { count: 'exact' },
    )
    .eq('org_id', orgId)
    .in('session_id', sessionIds)
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (changes.error) throw new Error(`查詢課務異動失敗：${changes.error.message}`);

  return c.json(
    {
      data: ((changes.data ?? []) as unknown as ChangeLogRow[]).map((row) => ({
        ...describeChange(row),
        createdByName: null,
      })),
      meta: { total: changes.count ?? 0, page, pageSize },
    },
    200,
  );
});

export default app;
