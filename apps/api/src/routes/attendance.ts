import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { resolveTeacherScope } from './attendance/teacher-scope';
import type { AppEnv } from '../index';
import { formatAuditSessionResourceName, logAudit } from '../utils/audit';

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
    courseName: z.string().nullable(),
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

const AttendanceSessionListResponseSchema = z
  .object({
    data: z.array(EventSessionSummarySchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('AttendanceSessionListResponse');

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
    eventId: z.string(),
    updates: z
      .array(
        z.object({
          studentId: z.string(),
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

type AttendanceSessionStatus = 'scheduled' | 'completed' | 'cancelled';

interface AttendanceAuditResourceNameInput {
  readonly courseName?: string | null;
  readonly className?: string | null;
  readonly eventDate?: string | null;
  readonly startTime?: string | null;
}

interface AttendanceBatchAuditUpdate {
  readonly studentId: string;
  readonly status: 'present' | 'absent';
}

export function buildAttendanceAuditResourceName(
  input: AttendanceAuditResourceNameInput,
): string | null {
  return formatAuditSessionResourceName({
    courseName: input.courseName,
    className: input.className,
    sessionDate: input.eventDate,
    startTime: input.startTime,
  });
}

export function buildAttendanceAuditBatchDetails(
  updates: ReadonlyArray<AttendanceBatchAuditUpdate>,
) {
  return {
    updatedCount: updates.length,
    presentCount: updates.filter((update) => update.status === 'present').length,
    absentCount: updates.filter((update) => update.status === 'absent').length,
  };
}

export function normalizeAttendanceSessionStatuses(
  statuses: string | undefined,
): AttendanceSessionStatus[] | null {
  if (!statuses) {
    return null;
  }

  const normalized = statuses
    .split(',')
    .map((status) => status.trim())
    .filter(
      (status): status is AttendanceSessionStatus =>
        status === 'scheduled' || status === 'completed' || status === 'cancelled',
    );

  return normalized.length > 0 ? normalized : null;
}

export function normalizeAttendanceFilterIds(filterIds: string | undefined): string[] {
  if (!filterIds) {
    return [];
  }

  return Array.from(
    new Set(
      filterIds
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export async function ensureAttendanceSessionEvents(input: {
  readonly supabase: AppEnv['Variables']['supabase'];
  readonly orgId: string;
  readonly campusId?: string;
  readonly courseIdList: readonly string[];
  readonly classIdList: readonly string[];
  readonly statusList: readonly AttendanceSessionStatus[];
  readonly dateFromValue?: string;
  readonly dateToValue?: string;
}): Promise<{ readonly created: number; readonly error: string | null }> {
  const {
    supabase,
    orgId,
    campusId,
    courseIdList,
    classIdList,
    statusList,
    dateFromValue,
    dateToValue,
  } = input;

  let missingSessionsQuery = supabase
    .from('sessions')
    .select(
      `
      id,
      event_id,
      session_date,
      start_time,
      end_time,
      status,
      class_id,
      classes!inner(name, course_id, campus_id, courses(name))
    `,
    )
    .eq('org_id', orgId)
    .is('event_id', null)
    .in('status', [...statusList]);

  if (dateFromValue) {
    missingSessionsQuery = missingSessionsQuery.gte('session_date', dateFromValue);
    missingSessionsQuery = missingSessionsQuery.lte('session_date', dateToValue ?? dateFromValue);
  }

  if (campusId) {
    missingSessionsQuery = missingSessionsQuery.eq('classes.campus_id', campusId);
  }
  if (courseIdList.length > 0) {
    missingSessionsQuery = missingSessionsQuery.in('classes.course_id', [...courseIdList]);
  }
  if (classIdList.length > 0) {
    missingSessionsQuery = missingSessionsQuery.in('class_id', [...classIdList]);
  }

  const { data: missingSessions, error: missingSessionsError } = await missingSessionsQuery;
  if (missingSessionsError) {
    return { created: 0, error: missingSessionsError.message };
  }

  if (!missingSessions || missingSessions.length === 0) {
    return { created: 0, error: null };
  }

  const eventsToInsert = missingSessions.map((session: any) => {
    const classRow = Array.isArray(session.classes) ? session.classes[0] : session.classes;

    return {
      id: crypto.randomUUID(),
      org_id: orgId,
      event_type: 'session' as const,
      title: classRow?.name ?? '課堂',
      campus_id: classRow?.campus_id ?? null,
      event_date: session.session_date,
      start_time: session.start_time,
      end_time: session.end_time,
    };
  });

  const { error: insertEventsError } = await supabase.from('events').insert(eventsToInsert);
  if (insertEventsError) {
    return { created: 0, error: insertEventsError.message };
  }

  const sessionUpdateResults = await Promise.all(
    missingSessions.map((session: any, index) =>
      supabase
        .from('sessions')
        .update({ event_id: eventsToInsert[index]?.id ?? null })
        .eq('id', session.id),
    ),
  );

  const updateError = sessionUpdateResults.find((result) => result.error)?.error;
  if (updateError) {
    return { created: 0, error: updateError.message };
  }

  return { created: missingSessions.length, error: null };
}

export function buildAttendanceSessionListMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

function extractAttendanceAuditContext(source: Record<string, any> | null | undefined) {
  const event = source?.['events'] ?? source;
  const sessionRows = Array.isArray(event?.sessions)
    ? event.sessions
    : event?.sessions
      ? [event.sessions]
      : [];
  const classRow = sessionRows[0]?.classes;
  const courseRow = Array.isArray(classRow?.courses) ? classRow.courses[0] : classRow?.courses;

  return {
    courseName: (courseRow?.name as string | null | undefined) ?? null,
    className: (classRow?.name as string | null | undefined) ?? null,
    eventDate: (event?.event_date as string | null | undefined) ?? null,
    startTime: (event?.start_time as string | null | undefined)?.slice(0, 5) ?? null,
  };
}

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
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const {
      campusId,
      studentId,
      dateFrom,
      dateTo,
      status,
      page = 1,
      pageSize = 20,
    } = c.req.valid('query');

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
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    const { data: ev } = await supabase
      .from('events')
      .select('event_date')
      .eq('id', body.eventId)
      .eq('org_id', orgId)
      .single();

    if (!ev) return c.json({ error: '找不到課堂或無權限', message: undefined }, 500);
    if ((ev as any).event_date > getCurrentTaipeiDateString()) {
      return c.json({ error: '未來課堂尚未開放點名', message: undefined }, 500);
    }

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
        '*, students(name), events(event_date, start_time, end_time, campus_id, campuses(name), sessions(classes(name, courses(name))))',
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

    const auditContext = extractAttendanceAuditContext(data as Record<string, any>);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'attendance',
        resourceId: body.eventId,
        resourceName: buildAttendanceAuditResourceName(auditContext),
        action: 'create',
        details: {
          studentName: row.student_name,
          status: body.status,
          note: body.note ?? null,
        },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json(toAttendanceResponse(row), 201);
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
      .select(
        'id, attendance_taken_at, event_date, start_time, sessions(class_id, classes(name, courses(name)))',
      )
      .eq('id', eventId)
      .eq('org_id', orgId)
      .single();

    if (!ev) return c.json({ error: '找不到課堂或無權限' }, 403);

    const classId = (ev as any).sessions?.[0]?.class_id;
    const eventDate = (ev as any).event_date as string;

    if (eventDate > getCurrentTaipeiDateString()) {
      return c.json({ error: '未來課堂尚未開放點名' }, 400);
    }

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

    const auditContext = extractAttendanceAuditContext(ev as Record<string, any>);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'attendance',
        resourceId: eventId,
        resourceName: buildAttendanceAuditResourceName(auditContext),
        action: 'batch_update_attendance',
        details: buildAttendanceAuditBatchDetails(updates),
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ updated: updates.length, takenAt }, 200);
  },
);

// PATCH /api/attendance/:id
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Attendance'],
    summary: '修改出勤狀態',
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: UpdateAttendanceSchema } } },
    },
    responses: {
      200: {
        description: '更新後的出勤紀錄',
        content: { 'application/json': { schema: AttendanceRecordSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const { data: existing } = await supabase
      .from('attendance_records')
      .select('events(event_date)')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!existing) return c.json({ error: '找不到出勤紀錄或無權限', message: undefined }, 500);
    const existingEventDate = (existing as any).events?.event_date as string | null;
    if (existingEventDate && existingEventDate > getCurrentTaipeiDateString()) {
      return c.json({ error: '未來課堂尚未開放點名', message: undefined }, 500);
    }

    const updates: Record<string, unknown> = { recorded_by: userId, recorded_by_role: 'admin' };
    if (body.status !== undefined) updates['status'] = body.status;
    if (body.note !== undefined) updates['note'] = body.note;

    const { data, error } = await supabase
      .from('attendance_records')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select(
        '*, students(name), events(event_date, start_time, end_time, campus_id, campuses(name), sessions(classes(name, courses(name))))',
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

    const auditContext = extractAttendanceAuditContext(data as Record<string, any>);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'attendance',
        resourceId: row.event_id,
        resourceName: buildAttendanceAuditResourceName(auditContext),
        action: 'update',
        details: {
          studentName: row.student_name,
          status: row.status,
          note: row.note,
        },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

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
        courseIds: z.string().optional(),
        classIds: z.string().optional(),
        statuses: z.string().optional(),
        // 只有管理員說了算：老師一律被蓋成自己（見 attendance/teacher-scope.ts）
        teacherId: z.uuid().optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        description: '課堂出勤摘要',
        content: { 'application/json': { schema: AttendanceSessionListResponseSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const {
      date,
      dateFrom,
      dateTo,
      campusId,
      courseIds,
      classIds,
      statuses,
      teacherId,
      page = 1,
      pageSize = 20,
    } = c.req.valid('query');

    const dateFromValue = date ?? dateFrom;
    const dateToValue = date ?? dateTo;

    const roles = c.get('roles') ?? [];

    // 管理員不受老師範圍限制，所以不必查 staff —— 這支 route 每次請求都會跑
    let ownStaffId: string | null = null;
    if (!roles.includes('admin')) {
      const { data: ownStaff } = await supabase
        .from('staff')
        .select('id')
        .eq('user_id', c.get('userId'))
        .eq('org_id', orgId)
        .maybeSingle();
      ownStaffId = (ownStaff?.id as string | undefined) ?? null;
    }

    const scope = resolveTeacherScope({ roles, requested: teacherId, ownStaffId });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    const courseIdList = normalizeAttendanceFilterIds(courseIds);
    const classIdList = normalizeAttendanceFilterIds(classIds);
    const statusList = normalizeAttendanceSessionStatuses(statuses) ?? ['scheduled', 'completed'];
    const fromIndex = (page - 1) * pageSize;
    const toIndex = fromIndex + pageSize - 1;

    const ensureEventsResult = await ensureAttendanceSessionEvents({
      supabase,
      orgId,
      campusId,
      courseIdList,
      classIdList,
      statusList,
      dateFromValue,
      dateToValue,
    });
    if (ensureEventsResult.error) {
      return c.json({ error: '補齊課堂事件失敗', message: ensureEventsResult.error }, 500);
    }

    let sessionsQuery = supabase
      .from('sessions')
      .select(
        `
        event_id,
        session_date,
        start_time,
        end_time,
        status,
        class_id,
        classes!inner(name, course_id, campus_id, campuses(name), courses(name)),
        events!event_id!inner(
          id,
          event_date,
          start_time,
          end_time,
          attendance_taken_at,
          campus_id,
          campuses(name)
        )
      `,
        { count: 'exact' },
      )
      .eq('org_id', orgId)
      .order('session_date', { ascending: true })
      .order('start_time', { ascending: true })
      .range(fromIndex, toIndex);

    if (dateFromValue) {
      sessionsQuery = sessionsQuery.gte('session_date', dateFromValue);
      sessionsQuery = sessionsQuery.lte('session_date', dateToValue ?? dateFromValue);
    }

    if (campusId) sessionsQuery = sessionsQuery.eq('classes.campus_id', campusId);
    if (courseIdList.length > 0) {
      sessionsQuery = sessionsQuery.in('classes.course_id', courseIdList);
    }
    if (classIdList.length > 0) {
      sessionsQuery = sessionsQuery.in('class_id', classIdList);
    }
    if (scope.teacherId) sessionsQuery = sessionsQuery.eq('teacher_id', scope.teacherId);
    sessionsQuery = sessionsQuery.in('status', statusList);

    const { data: sessions, error: sessionsError, count } = await sessionsQuery;
    if (sessionsError)
      return c.json({ error: '查詢課堂失敗', message: sessionsError.message }, 500);

    const results = await Promise.all(
      (sessions ?? []).map(async (session: any) => {
        const classRow = session.classes;
        const courseRow = Array.isArray(classRow?.courses)
          ? classRow.courses[0]
          : classRow?.courses;
        const classCampusRow = Array.isArray(classRow?.campuses)
          ? classRow.campuses[0]
          : classRow?.campuses;
        const eventRow = Array.isArray(session.events) ? session.events[0] : session.events;
        const classId = session.class_id ?? null;
        const eventId = session.event_id ?? eventRow?.id ?? null;
        const sessionDate = eventRow?.event_date ?? session.session_date ?? null;

        let presentCount = 0,
          onLeaveCount = 0,
          absentCount = 0;

        if (eventId) {
          const { data: records } = await supabase
            .from('attendance_records')
            .select('status')
            .eq('event_id', eventId)
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
          .lte('effective_from', sessionDate)
          .or(`effective_to.is.null,effective_to.gte.${sessionDate}`);

        return {
          eventId: eventId ?? '',
          classId: classId ?? '',
          className: classRow?.name ?? '',
          courseName: courseRow?.name ?? null,
          teacherName: null,
          campusId: eventRow?.campus_id ?? classRow?.campus_id ?? null,
          campusName: eventRow?.campuses?.name ?? classCampusRow?.name ?? null,
          eventDate: sessionDate ?? '',
          startTime: (eventRow?.start_time ?? session.start_time)?.slice(0, 5) ?? null,
          endTime: (eventRow?.end_time ?? session.end_time)?.slice(0, 5) ?? null,
          enrolledCount: enrolledCount ?? 0,
          presentCount,
          onLeaveCount,
          absentCount,
          takenAt: eventRow?.attendance_taken_at ?? null,
        };
      }),
    );

    return c.json(
      {
        data: results,
        meta: buildAttendanceSessionListMeta(count ?? 0, page, pageSize),
      },
      200,
    );
  },
);

// GET /api/attendance/roster/:eventId
app.openapi(
  createRoute({
    method: 'get',
    path: '/roster/{eventId}',
    tags: ['Attendance'],
    summary: '取得課堂點名名單（懶建立，不寫 DB）',
    request: {
      params: z.object({ eventId: z.string() }),
    },
    responses: {
      200: {
        description: '課堂點名名單',
        content: { 'application/json': { schema: AttendanceRosterSchema } },
      },
      404: { description: '找不到資源' },
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
      .select('student_id, students(name, grade, schools(id, name, short_name))')
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
        grade: e.students?.grade ?? null,
        school: e.students?.schools?.short_name ?? e.students?.schools?.name ?? null,
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

function getCurrentTaipeiDateString(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
}

export default app;
