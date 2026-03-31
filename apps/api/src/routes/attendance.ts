import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

const AttendanceStatusSchema = z
  .enum(['present', 'absent', 'on_leave'])
  .openapi('AttendanceStatus');

const AttendanceRecordSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    studentId: z.uuid(),
    studentName: z.string(),
    eventId: z.uuid(),
    eventDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    campusName: z.string().nullable(),
    className: z.string().nullable(),
    status: AttendanceStatusSchema,
    note: z.string().nullable(),
    recordedBy: z.string().nullable(),
    recordedByRole: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AttendanceRecord');

const AttendanceListResponseSchema = z
  .object({
    data: z.array(AttendanceRecordSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('AttendanceListResponse');

const UpdateAttendanceSchema = z
  .object({
    status: AttendanceStatusSchema.optional(),
    note: z.string().nullable().optional(),
  })
  .openapi('UpdateAttendance');

const CreateAttendanceSchema = z
  .object({
    studentId: z.uuid(),
    eventId: z.uuid(),
    status: AttendanceStatusSchema,
    note: z.string().nullable().optional(),
  })
  .openapi('CreateAttendance');

export function toAttendanceResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    studentId: row['student_id'] as string,
    studentName: row['student_name'] as string,
    eventId: row['event_id'] as string,
    eventDate: row['event_date'] as string,
    startTime: (row['start_time'] as string | null) ?? null,
    endTime: (row['end_time'] as string | null) ?? null,
    campusName: (row['campus_name'] as string | null) ?? null,
    className: (row['class_name'] as string | null) ?? null,
    status: row['status'] as 'present' | 'absent' | 'on_leave',
    note: (row['note'] as string | null) ?? null,
    recordedBy: (row['recorded_by'] as string | null) ?? null,
    recordedByRole: (row['recorded_by_role'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/attendance
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Attendance'],
    summary: '查詢出勤紀錄',
    request: {
      query: z.object({
        campusId: z.uuid().optional(),
        studentId: z.uuid().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        status: AttendanceStatusSchema.optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        description: '出勤紀錄列表',
        content: { 'application/json': { schema: AttendanceListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { campusId, studentId, dateFrom, dateTo, status, page = 1, pageSize = 20 } =
      c.req.valid('query');

    let query = supabase
      .from('attendance_records')
      .select(
        `
        id, org_id, student_id, event_id, status, note, recorded_by, recorded_by_role, created_at, updated_at,
        students!inner(name),
        events!inner(event_date, start_time, end_time, campus_id, campuses(name)),
        events!inner(sessions(class_id, classes(name)))
        `,
        { count: 'exact' },
      )
      .eq('org_id', orgId);

    if (studentId) query = query.eq('student_id', studentId);
    if (status) query = query.eq('status', status);
    if (dateFrom) query = query.gte('events.event_date', dateFrom);
    if (dateTo) query = query.lte('events.event_date', dateTo);
    if (campusId) query = query.eq('events.campus_id', campusId);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1).order('created_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      return c.json({ error: '讀取出勤紀錄失敗', message: error.message }, 500);
    }

    const rows = (data ?? []).map((r: any) => ({
      id: r.id,
      org_id: r.org_id,
      student_id: r.student_id,
      student_name: r.students?.name ?? '',
      event_id: r.event_id,
      event_date: r.events?.event_date ?? '',
      start_time: r.events?.start_time ?? null,
      end_time: r.events?.end_time ?? null,
      campus_name: r.events?.campuses?.name ?? null,
      class_name: r.events?.sessions?.[0]?.classes?.name ?? null,
      status: r.status,
      note: r.note,
      recorded_by: r.recorded_by,
      recorded_by_role: r.recorded_by_role,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    const total = count ?? 0;
    return c.json(
      {
        data: rows.map(toAttendanceResponse),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      },
      200,
    );
  },
);

// POST /api/attendance
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Attendance'],
    summary: '新增出勤紀錄',
    request: {
      body: { content: { 'application/json': { schema: CreateAttendanceSchema } } },
    },
    responses: {
      201: {
        description: '建立的出勤紀錄',
        content: { 'application/json': { schema: AttendanceRecordSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('attendance_records')
      .insert({
        org_id: orgId,
        student_id: body.studentId,
        event_id: body.eventId,
        status: body.status,
        note: body.note ?? null,
        recorded_by: userId,
        recorded_by_role: 'admin',
      })
      .select(
        '*, students(name), events(event_date, start_time, end_time, campus_id, campuses(name))',
      )
      .single();

    if (error || !data) {
      return c.json({ error: '新增出勤紀錄失敗', message: error?.message }, 500);
    }

    const row = {
      ...data,
      student_name: (data as any).students?.name ?? '',
      event_date: (data as any).events?.event_date ?? '',
      start_time: (data as any).events?.start_time ?? null,
      end_time: (data as any).events?.end_time ?? null,
      campus_name: (data as any).events?.campuses?.name ?? null,
      class_name: null,
    };

    return c.json(toAttendanceResponse(row), 201);
  },
);

// PATCH /api/attendance/:id
app.openapi(
  createRoute({
    method: 'patch',
    path: '/:id',
    tags: ['Attendance'],
    summary: '修改出勤狀態',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateAttendanceSchema } } },
    },
    responses: {
      200: {
        description: '更新後的出勤紀錄',
        content: { 'application/json': { schema: AttendanceRecordSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const updates: Record<string, unknown> = { recorded_by: userId, recorded_by_role: 'admin' };
    if (body.status !== undefined) updates['status'] = body.status;
    if (body.note !== undefined) updates['note'] = body.note;

    const { data, error } = await supabase
      .from('attendance_records')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select(
        '*, students(name), events(event_date, start_time, end_time, campus_id, campuses(name))',
      )
      .single();

    if (error || !data) {
      return c.json({ error: '更新出勤紀錄失敗', message: error?.message }, 500);
    }

    const row = {
      ...data,
      student_name: (data as any).students?.name ?? '',
      event_date: (data as any).events?.event_date ?? '',
      start_time: (data as any).events?.start_time ?? null,
      end_time: (data as any).events?.end_time ?? null,
      campus_name: (data as any).events?.campuses?.name ?? null,
      class_name: null,
    };

    return c.json(toAttendanceResponse(row), 200);
  },
);

export default app;
