import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../index';
import { loadTenure } from '../lib/teacher-scope';
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
 * 是本人的課堂（代課）。操作者姓名不給老師（`createdByName` 一律 null）。
 *
 * **一支 pg SQL，不把 id 清單放進 URL**（#1928 A#11，計畫席 11-05 裁定）：舊寫法先撈課堂 id 再
 * `.in('session_id', ids)`，31 天內 >200 堂就 414。任期判準**不在 SQL 重寫**：照舊由 `loadTenure` 算出
 * 現任班與前任段，SQL 只用 `= any` 接清單（判準只有 lib/teacher-scope.ts 一份）。
 * 沒有 pool → 500，不留 builder 退路（同 workbench #2227、#2230 (c)）。
 */

/**
 * $1 org、$2..$3 區間、$4 本人 staff.id、$5 現任班、$6/$7/$8 前任段（班、起、迄，平行陣列）、$9 limit、$10 offset。
 * 回一列 `{ total, rows }`；rows 的形狀同 `ChangeLogRow`（時間欄位在 Postgres 組成 JSON，格式同 PostgREST）。
 * 末鍵 `id`：批次異動的 `created_at` 相同，沒有末鍵時跨頁會重複或漏。
 */
export const TEACHER_CHANGES_SQL = `
with visible as (
  select s.id, s.class_id, s.session_date
  from public.sessions s
  where s.org_id = $1
    and s.session_date between $2::date and $3::date
    and (
      s.teacher_id = $4::uuid
      or s.class_id = any($5::uuid[])
      or exists (
        select 1 from unnest($6::uuid[], $7::date[], $8::date[]) as p(class_id, term_from, term_to)
        where p.class_id = s.class_id and s.session_date between p.term_from and p.term_to
      )
    )
), hit as (
  select sc.*, v.class_id as v_class_id, v.session_date as v_session_date
  from public.schedule_changes sc
  join visible v on v.id = sc.session_id
  where sc.org_id = $1
), page as (
  select * from hit order by created_at desc, id limit $9 offset $10
)
select json_build_object(
  'total', (select count(*) from hit),
  'rows', coalesce((
    select json_agg(json_build_object(
      'id', p.id, 'session_id', p.session_id, 'change_type', p.change_type,
      'operation_source', p.operation_source, 'batch_id', p.batch_id, 'reason', p.reason,
      'created_by_name', p.created_by_name, 'created_at', p.created_at,
      'original_session_date', p.original_session_date, 'original_start_time', p.original_start_time,
      'original_end_time', p.original_end_time, 'new_session_date', p.new_session_date,
      'new_start_time', p.new_start_time, 'new_end_time', p.new_end_time,
      'original_teacher_name', p.original_teacher_name,
      'sessions', json_build_object('session_date', p.v_session_date, 'classes', json_build_object('name', c.name)),
      'staff', (select json_build_object('display_name', st.display_name)
                from public.staff st where st.id = p.substitute_teacher_id and st.org_id = $1)
    ) order by p.created_at desc, p.id)
    from page p join public.classes c on c.id = p.v_class_id and c.org_id = $1
  ), '[]'::json)
) as result`;

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
    sessionStartTime: z.string().nullable(),
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
    500: { description: '沒有 DB 池', content: { 'application/json': { schema: ErrorSchema } } },
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

  const pool = c.get('auth')?.pool;
  if (!pool) return c.json({ error: '查詢課務異動失敗', code: 'DB_POOL_UNAVAILABLE' }, 500);

  // 任課班：現任＝全期、前任＝只限任期內的課堂（#2049 R2）；自己上的課（含代課）照舊都算
  const tenure = await loadTenure(supabase, orgId, staffId);
  const terms = [...tenure.past].flatMap(([classId, ts]) => ts.map((t) => ({ classId, ...t })));
  const { rows } = await pool.query(TEACHER_CHANGES_SQL, [
    orgId,
    from,
    to,
    staffId,
    tenure.current,
    terms.map((t) => t.classId),
    terms.map((t) => t.from),
    terms.map((t) => t.to),
    pageSize,
    (page - 1) * pageSize,
  ]);
  const result = (rows[0] as { result?: { total: number; rows: ChangeLogRow[] } } | undefined)
    ?.result;
  if (!result) throw new Error('查詢課務異動失敗：SQL 沒有回結果');

  return c.json(
    {
      data: result.rows.map((row) => ({
        ...describeChange(row),
        createdByName: null,
      })),
      meta: { total: result.total, page, pageSize },
    },
    200,
  );
});

export default app;
