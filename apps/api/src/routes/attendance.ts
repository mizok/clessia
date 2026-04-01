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

const EventSessionSummarySchema = z
  .object({
    eventId: z.uuid(),
    classId: z.uuid(),
    className: z.string(),
    teacherName: z.string().nullable(),
    campusId: z.uuid().nullable(),
    campusName: z.string().nullable(),
    eventDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    enrolledCount: z.number(),
    presentCount: z.number(),
    onLeaveCount: z.number(),
    absentCount: z.number(),
    takenAt: z.string().nullable(),
  })
  .openapi('EventSessionSummary');

const RosterStudentSchema = z
  .object({
    studentId: z.uuid(),
    studentName: z.string(),
    grade: z.string().nullable(),
    school: z.string().nullable(),
    recordId: z.uuid().nullable(),
    status: AttendanceStatusSchema.nullable(),
  })
  .openapi('RosterStudent');

const AttendanceRosterSchema = z
  .object({
    eventId: z.uuid(),
    takenAt: z.string().nullable(),
    students: z.array(RosterStudentSchema),
  })
  .openapi('AttendanceRoster');

const BatchAttendanceUpdateSchema = z
  .object({
    eventId: z.uuid(),
    updates: z
      .array(
        z.object({
          studentId: z.uuid(),
          status: z.enum(['present', 'absent']),
        }),
      )
      .min(1),
  })
  .openapi('BatchAttendanceUpdate');

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
        events!inner(event_date, start_time, end_time, campus_id, campuses(name), sessions(class_id, classes(name)))
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

// GET /api/attendance/sessions
app.openapi(
  createRoute({
    method: 'get',
    path: '/sessions',
    tags: ['Attendance'],
    summary: '取得課堂出勤摘要列表（by 日期）',
    request: {
      query: z.object({
        date: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        campusId: z.uuid().optional(),
      }),
    },
    responses: {
      200: {
        description: '課堂出勤摘要',
        content: { 'application/json': { schema: z.array(EventSessionSummarySchema) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { date, dateFrom, dateTo, campusId } = c.req.valid('query');

    const from = date ?? dateFrom;
    const to = date ?? dateTo;

    if (!from) return c.json({ error: 'date 或 dateFrom 為必填' }, 400);

    let eventsQuery = supabase
      .from('events')
      .select(`
        id, event_date, start_time, end_time, attendance_taken_at,
        campus_id, campuses(name),
        sessions(
          class_id,
          classes(name, teacher_id, ba_user:teacher_id(name))
        )
      `)
      .eq('org_id', orgId)
      .gte('event_date', from)
      .lte('event_date', to ?? from)
      .order('start_time', { ascending: true });

    if (campusId) eventsQuery = eventsQuery.eq('campus_id', campusId);

    const { data: events, error: eventsError } = await eventsQuery;
    if (eventsError) return c.json({ error: '查詢課堂失敗', message: eventsError.message }, 500);

    const results = await Promise.all(
      (events ?? []).map(async (ev: any) => {
        const session = ev.sessions?.[0];
        const classRow = session?.classes;
        const classId = session?.class_id ?? null;

        let presentCount = 0, onLeaveCount = 0, absentCount = 0;

        if (ev.attendance_taken_at) {
          const { data: records } = await supabase
            .from('attendance_records')
            .select('status')
            .eq('event_id', ev.id)
            .eq('org_id', orgId);

          for (const r of records ?? []) {
            if (r.status === 'present') presentCount++;
            else if (r.status === 'on_leave') onLeaveCount++;
            else if (r.status === 'absent') absentCount++;
          }
        }

        const { count: enrolledCount } = await supabase
          .from('enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('class_id', classId)
          .eq('status', 'active')
          .lte('effective_from', ev.event_date)
          .or(`effective_to.is.null,effective_to.gte.${ev.event_date}`);

        return {
          eventId: ev.id,
          classId: classId ?? '',
          className: classRow?.name ?? '',
          teacherName: classRow?.ba_user?.name ?? null,
          campusId: ev.campus_id ?? null,
          campusName: ev.campuses?.name ?? null,
          eventDate: ev.event_date,
          startTime: ev.start_time ? ev.start_time.slice(0, 5) : null,
          endTime: ev.end_time ? ev.end_time.slice(0, 5) : null,
          enrolledCount: enrolledCount ?? 0,
          presentCount,
          onLeaveCount,
          absentCount,
          takenAt: ev.attendance_taken_at ?? null,
        };
      }),
    );

    return c.json(results, 200);
  },
);

// GET /api/attendance/roster/:eventId
app.openapi(
  createRoute({
    method: 'get',
    path: '/roster/:eventId',
    tags: ['Attendance'],
    summary: '取得課堂點名名單（懶建立，不寫 DB）',
    request: {
      params: z.object({ eventId: z.uuid() }),
    },
    responses: {
      200: {
        description: '課堂點名名單',
        content: { 'application/json': { schema: AttendanceRosterSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { eventId } = c.req.valid('param');

    const { data: ev, error: evError } = await supabase
      .from('events')
      .select('id, event_date, attendance_taken_at, sessions(class_id)')
      .eq('id', eventId)
      .eq('org_id', orgId)
      .single();

    if (evError || !ev) return c.json({ error: '找不到課堂' }, 404);

    const classId = (ev as any).sessions?.[0]?.class_id;
    const eventDate = (ev as any).event_date as string;

    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('student_id, students(name, grade_level, school)')
      .eq('class_id', classId)
      .eq('status', 'active')
      .lte('effective_from', eventDate)
      .or(`effective_to.is.null,effective_to.gte.${eventDate}`);

    const { data: records } = await supabase
      .from('attendance_records')
      .select('id, student_id, status')
      .eq('event_id', eventId)
      .eq('org_id', orgId);

    const recordMap = new Map(
      (records ?? []).map((r: any) => [r.student_id, { id: r.id, status: r.status }]),
    );

    const students = (enrollments ?? []).map((e: any) => {
      const rec = recordMap.get(e.student_id);
      return {
        studentId: e.student_id,
        studentName: e.students?.name ?? '',
        grade: e.students?.grade_level ?? null,
        school: e.students?.school ?? null,
        recordId: rec?.id ?? null,
        status: rec?.status ?? null,
      };
    });

    return c.json(
      {
        eventId,
        takenAt: (ev as any).attendance_taken_at ?? null,
        students,
      },
      200,
    );
  },
);

// PATCH /api/attendance/batch
app.openapi(
  createRoute({
    method: 'patch',
    path: '/batch',
    tags: ['Attendance'],
    summary: '批次儲存點名結果（原子性，同步更新 attendance_taken_at）',
    request: {
      body: { content: { 'application/json': { schema: BatchAttendanceUpdateSchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({ updated: z.number(), takenAt: z.string() }),
          },
        },
      },
      400: { description: '參數錯誤' },
      403: { description: '無權限' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { eventId, updates } = c.req.valid('json');

    const { data: ev } = await supabase
      .from('events')
      .select('id, attendance_taken_at, sessions(class_id), event_date')
      .eq('id', eventId)
      .eq('org_id', orgId)
      .single();

    if (!ev) return c.json({ error: '找不到課堂或無權限' }, 403);

    const classId = (ev as any).sessions?.[0]?.class_id;
    const eventDate = (ev as any).event_date as string;

    const { data: validEnrollments } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('class_id', classId)
      .eq('status', 'active')
      .lte('effective_from', eventDate)
      .or(`effective_to.is.null,effective_to.gte.${eventDate}`);

    const validIds = new Set((validEnrollments ?? []).map((e: any) => e.student_id));
    const invalidIds = updates.filter((u) => !validIds.has(u.studentId));
    if (invalidIds.length > 0) {
      return c.json({ error: '部分學生不在此課堂修課名單中' }, 400);
    }

    const records = updates.map((u) => ({
      org_id: orgId,
      event_id: eventId,
      student_id: u.studentId,
      status: u.status,
      recorded_by: userId,
      recorded_by_role: 'admin',
    }));

    const { error: upsertError } = await supabase
      .from('attendance_records')
      .upsert(records, { onConflict: 'event_id,student_id' });

    if (upsertError) {
      return c.json({ error: '儲存出勤失敗', message: upsertError.message }, 500);
    }

    const takenAt = (ev as any).attendance_taken_at ?? new Date().toISOString();

    if (!(ev as any).attendance_taken_at) {
      await supabase
        .from('events')
        .update({ attendance_taken_at: takenAt })
        .eq('id', eventId)
        .eq('org_id', orgId);
    }

    return c.json({ updated: updates.length, takenAt }, 200);
  },
);

export default app;
