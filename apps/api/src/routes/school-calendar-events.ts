import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';
import { auditDeleteSnapshot, auditFieldDiff } from '../lib/audit-diff';
import { waitUntilFrom } from '../lib/wait-until';

/**
 * 學校行事曆（#1160，設計 kb/wiki/specs/admin/settings/school-calendar.md）。
 * 掛在 `/api/schools` 底下（schools.ts `app.route('/', …)`），權限跟學校一樣：讀 ADMIN_ONLY、寫 manage_courses。
 *
 * - 只存日期區間、不存學年學期（gate Q1 (a)）：查詢以「重疊」篩 —— `start_date <= to` 且 `end_date >= from`
 * - 新增可「同時加到」其他學校（Q2 (a)）：一次寫 N 列、各自獨立可改。每一所都先驗屬於本 org（c1）
 * - GET 順帶回期（billing_periods）的 id／名稱／起訖（Q6 (a)）：`/api/billing-periods` 要 manage_finance，
 *   只有 manage_courses 的主任也要能用期選範圍。只有日期，不含金額
 * - audit 記在 `resource_type='school'`、`resource_id` 是學校（Q5 (a)），action 帶 `calendar_event.` 前綴，
 *   跟改學校本身（裸的 create／update／delete）分得開
 */

const KindSchema = z.enum([
  'semester_start',
  'semester_end',
  'winter_break',
  'summer_break',
  'makeup_day',
  'no_class',
  'other',
]);

const DateSchema = z.string().date();

const EventSchema = z
  .object({
    id: DbUuidSchema,
    schoolId: DbUuidSchema,
    kind: KindSchema,
    startDate: z.string(),
    endDate: z.string(),
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SchoolCalendarEvent');

const PeriodSchema = z
  .object({ id: DbUuidSchema, name: z.string(), startDate: z.string(), endDate: z.string() })
  .openapi('SchoolCalendarPeriod');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('SchoolCalendarError');

const NoteSchema = z.string().max(200).nullable().optional();

const CreateSchema = z
  .object({
    kind: KindSchema,
    startDate: DateSchema,
    /** 不給＝單日（開學、休業式、補課） */
    endDate: DateSchema.optional(),
    note: NoteSchema,
    /** 同時加到這些學校（Q2 (a)）；自己那所不用列 */
    alsoSchoolIds: z.array(DbUuidSchema).max(200).optional(),
  })
  .openapi('CreateSchoolCalendarEvent');

const UpdateSchema = z
  .object({
    kind: KindSchema.optional(),
    startDate: DateSchema.optional(),
    endDate: DateSchema.optional(),
    note: NoteSchema,
  })
  .openapi('UpdateSchoolCalendarEvent');

const SELECT = 'id, school_id, kind, start_date, end_date, note, created_at, updated_at';

type EventRow = {
  id: string;
  school_id: string;
  kind: z.infer<typeof KindSchema>;
  start_date: string;
  end_date: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const toEvent = (r: EventRow): z.infer<typeof EventSchema> => ({
  id: r.id,
  schoolId: r.school_id,
  kind: r.kind,
  startDate: r.start_date,
  endDate: r.end_date,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** 只寫進稽核的欄位（id、時間戳不算內容） */
const auditFields = (r: Pick<EventRow, 'kind' | 'start_date' | 'end_date' | 'note'>) => ({
  kind: r.kind,
  start_date: r.start_date,
  end_date: r.end_date,
  note: r.note,
});

const notFound = { error: '找不到學校', code: 'NOT_FOUND' } as const;
const eventNotFound = { error: '找不到這筆行事曆', code: 'NOT_FOUND' } as const;
const badRange = { error: '結束日不能早於開始日', code: 'INVALID_RANGE' } as const;

const SchoolParams = z.object({ id: DbUuidSchema });
const EventParams = z.object({ id: DbUuidSchema, eventId: DbUuidSchema });

const app = new OpenAPIHono<AppEnv>();

// GET /api/schools/:id/calendar-events
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/calendar-events',
    tags: ['Schools'],
    summary: '某校的行事曆（區間重疊即列）＋期的起訖',
    request: {
      params: SchoolParams,
      query: z.object({ from: DateSchema.optional(), to: DateSchema.optional() }),
    },
    responses: {
      200: {
        description: 'OK',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(EventSchema),
              meta: z.object({ periods: z.array(PeriodSchema) }),
            }),
          },
        },
      },
      404: { description: '找不到學校', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');
    const { from, to } = c.req.valid('query');

    const school = await supabase
      .from('schools')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (school.error) return c.json({ error: school.error.message, code: 'DB_ERROR' }, 500);
    if (!school.data) return c.json(notFound, 404);

    let query = supabase
      .from('school_calendar_events')
      .select(SELECT)
      .eq('org_id', orgId)
      .eq('school_id', id);
    if (to) query = query.lte('start_date', to);
    if (from) query = query.gte('end_date', from);

    const [events, periods] = await Promise.all([
      query.order('start_date', { ascending: true }),
      supabase
        .from('billing_periods')
        .select('id, name, start_date, end_date')
        .eq('org_id', orgId)
        .order('start_date', { ascending: false }),
    ]);
    if (events.error) return c.json({ error: events.error.message, code: 'DB_ERROR' }, 500);
    if (periods.error) return c.json({ error: periods.error.message, code: 'DB_ERROR' }, 500);

    return c.json(
      {
        data: ((events.data ?? []) as EventRow[]).map(toEvent),
        meta: {
          periods: (
            (periods.data ?? []) as Array<{
              id: string;
              name: string;
              start_date: string;
              end_date: string;
            }>
          ).map((p) => ({ id: p.id, name: p.name, startDate: p.start_date, endDate: p.end_date })),
        },
      },
      200,
    );
  },
);

// POST /api/schools/:id/calendar-events
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/calendar-events',
    tags: ['Schools'],
    summary: '新增行事曆（可同時加到其他學校）',
    request: {
      params: SchoolParams,
      body: { content: { 'application/json': { schema: CreateSchema } } },
    },
    responses: {
      201: {
        description: '建立成功（每所學校一筆，自己那所在第一筆）',
        content: { 'application/json': { schema: z.object({ data: z.array(EventSchema) }) } },
      },
      400: { description: '區間不合法', content: { 'application/json': { schema: ErrorSchema } } },
      404: {
        description: '有學校不在本機構',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const endDate = body.endDate ?? body.startDate;
    if (endDate < body.startDate) return c.json(badRange, 400);

    const schoolIds = [...new Set([id, ...(body.alsoSchoolIds ?? [])])];
    const schools = await supabase
      .from('schools')
      .select('id, name')
      .eq('org_id', orgId)
      .in('id', schoolIds);
    if (schools.error) return c.json({ error: schools.error.message, code: 'DB_ERROR' }, 500);
    const names = new Map(
      ((schools.data ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
    );
    // 任何一所不在本 org 就整批不寫 —— 部分成功會讓「同時加到」變成要逐校對帳
    if (schoolIds.some((s) => !names.has(s))) return c.json(notFound, 404);

    const note = body.note?.trim() || null;
    const { data, error } = await supabase
      .from('school_calendar_events')
      .insert(
        schoolIds.map((schoolId) => ({
          org_id: orgId,
          school_id: schoolId,
          kind: body.kind,
          start_date: body.startDate,
          end_date: endDate,
          note,
        })),
      )
      .select(SELECT);
    if (error) return c.json({ error: error.message, code: 'DB_ERROR' }, 500);

    const rows = (data ?? []) as EventRow[];
    for (const row of rows) {
      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'school',
          resourceId: row.school_id,
          resourceName: names.get(row.school_id) ?? '',
          action: 'calendar_event.create',
          details: { eventId: row.id, ...auditFieldDiff(null, auditFields(row)) },
        },
        waitUntilFrom(c),
      );
    }

    // 自己那所排第一（前端拿它就地插進列表）
    rows.sort((a, b) => Number(b.school_id === id) - Number(a.school_id === id));
    return c.json({ data: rows.map(toEvent) }, 201);
  },
);

/** 讀一筆：必須是本 org、而且屬於網址上的那所學校 */
async function readEvent(
  supabase: AppEnv['Variables']['supabase'],
  orgId: string,
  schoolId: string,
  eventId: string,
) {
  return supabase
    .from('school_calendar_events')
    .select(`${SELECT}, schools(name)`)
    .eq('id', eventId)
    .eq('org_id', orgId)
    .eq('school_id', schoolId)
    .maybeSingle();
}

// PATCH /api/schools/:id/calendar-events/:eventId
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/calendar-events/{eventId}',
    tags: ['Schools'],
    summary: '修改一筆行事曆',
    request: {
      params: EventParams,
      body: { content: { 'application/json': { schema: UpdateSchema } } },
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: z.object({ data: EventSchema }) } },
      },
      400: { description: '區間不合法', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '找不到', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const supabase = c.get('supabase');
    const { id, eventId } = c.req.valid('param');
    const body = c.req.valid('json');

    const existing = await readEvent(supabase, orgId, id, eventId);
    if (existing.error) return c.json({ error: existing.error.message, code: 'DB_ERROR' }, 500);
    if (!existing.data) return c.json(eventNotFound, 404);
    const before = existing.data as unknown as EventRow & { schools: { name: string } | null };

    const next = {
      kind: body.kind ?? before.kind,
      start_date: body.startDate ?? before.start_date,
      end_date: body.endDate ?? before.end_date,
      note: body.note === undefined ? before.note : body.note?.trim() || null,
    };
    if (next.end_date < next.start_date) return c.json(badRange, 400);

    const { data, error } = await supabase
      .from('school_calendar_events')
      .update(next)
      .eq('id', eventId)
      .eq('org_id', orgId)
      .select(SELECT)
      .single();
    if (error) return c.json({ error: error.message, code: 'DB_ERROR' }, 500);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'school',
        resourceId: id,
        resourceName: before.schools?.name ?? '',
        action: 'calendar_event.update',
        details: { eventId, ...auditFieldDiff(auditFields(before), next) },
      },
      waitUntilFrom(c),
    );

    return c.json({ data: toEvent(data as EventRow) }, 200);
  },
);

// DELETE /api/schools/:id/calendar-events/:eventId
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/calendar-events/{eventId}',
    tags: ['Schools'],
    summary: '刪除一筆行事曆',
    request: { params: EventParams },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: { description: '找不到', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const supabase = c.get('supabase');
    const { id, eventId } = c.req.valid('param');

    const existing = await readEvent(supabase, orgId, id, eventId);
    if (existing.error) return c.json({ error: existing.error.message, code: 'DB_ERROR' }, 500);
    if (!existing.data) return c.json(eventNotFound, 404);
    const before = existing.data as unknown as EventRow & { schools: { name: string } | null };

    const { error } = await supabase
      .from('school_calendar_events')
      .delete()
      .eq('id', eventId)
      .eq('org_id', orgId);
    if (error) return c.json({ error: error.message, code: 'DB_ERROR' }, 500);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'school',
        resourceId: id,
        resourceName: before.schools?.name ?? '',
        action: 'calendar_event.delete',
        details: {
          eventId,
          ...auditDeleteSnapshot(before, ['kind', 'start_date', 'end_date', 'note']),
        },
      },
      waitUntilFrom(c),
    );

    return c.json({ success: true }, 200);
  },
);

export default app;
