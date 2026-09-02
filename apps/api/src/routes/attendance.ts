import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { resolveTeacherScope } from './attendance/teacher-scope';
import type { AppEnv } from '../index';
import { isAttendanceEditable } from '../lib/attendance-window';
import { isSubstituteSession } from '../lib/session-substitute';
import { countExamsBySession, sessionExamKey } from '../lib/session-exams';
import { resolveRecordedByRole } from '../lib/recorded-by-role';
import { leaveCoversSession } from '../lib/leave-covers-session';
import { countEnrolledOn, tallyAttendance, type EnrollmentRange } from '../lib/session-roster';
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
    /** 課堂本身的 id。**這才是穩定的鍵** —— eventId 可能是 null（見下） */
    sessionId: z.uuid(),
    /**
     * 出勤事件的 id。**停課的課堂可能沒有** —— 出勤事件是列表時才補建的，
     * 而停課的課堂刻意不補（不會發生的課不該在行事曆上長出一筆）。
     * 沒有 eventId 就不能點名，前端要據此關掉點名入口。
     */
    eventId: z.uuid().nullable(),
    /** `scheduled` / `completed` / `cancelled` —— 停課要顯示成灰底 */
    status: z.enum(['scheduled', 'completed', 'cancelled']),
    /** 實際上這堂課的老師跟課表排定的不一致 */
    isSubstitute: z.boolean(),
    /**
     * 這個班在這一天排了幾場校內考（`academy_exams`）。0 就是沒有。
     * **刻意只回數量**，不回考試內容 —— 課表格子要的是一個記號，
     * 塞整包考試資料進列表只會把每頁的體積放大而沒人用得到。
     */
    examCount: z.number().int().nonnegative(),
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
    /**
     * 這個學生今天有一張蓋到這堂課的請假單。
     *
     * **跟 `status === 'on_leave'` 是兩件事**：`status` 是「紀錄上寫了什麼」，
     * 這個是「有沒有請假這件事」。請假連動只寫得到**建立請假當下已經存在的** event，
     * 而出勤事件是懶生成的 —— 先請假、之後才生成的課堂，紀錄上什麼都沒有。
     * 所以這一欄是**讀取時推導**的，不看紀錄。
     *
     * 兩欄都給，是因為「老師明確標了缺席、但這人其實有請假」也要看得出來 ——
     * 用推導的值覆蓋掉 `status` 會把那個資訊蓋掉。
     *
     * ⚠️ **不要拿這一欄去鎖住那一列**（本註解原本寫的是
     * `status === 'on_leave' || hasLeaveRequest` 全鎖，2026-09-02 裁決推翻）：
     * 矛盾態本身就滿足那個 `||`，全鎖會讓老師看到一個他動不了的問題；
     * 而這一欄是推導的，誤判一次就鎖死一格，而銷假出口目前還不存在。
     * 鎖住的條件只有 `status === 'on_leave'`，理由見
     * `attendance-roster-panel.component.ts` 的 `isLocked`。
     */
    hasLeaveRequest: z.boolean(),
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

    const window = await assertAttendanceWindow(supabase, {
      orgId,
      roles: c.get('roles') ?? [],
      eventDate: (ev as any).event_date as string,
    });
    if (!window.ok) {
      return c.json({ error: '已超過補登期限，請聯繫管理員', message: undefined }, 500);
    }
    if (window.outOfWindowByAdmin) {
      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'attendance',
          resourceId: body.eventId,
          action: 'retroactive_edit',
          details: { eventDate: (ev as any).event_date as string },
        },
        c.executionCtx.waitUntil.bind(c.executionCtx),
      );
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
        recorded_by_role: resolveRecordedByRole(c.get('roles') ?? []),
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

    const window = await assertAttendanceWindow(supabase, {
      orgId,
      roles: c.get('roles') ?? [],
      eventDate: eventDate,
    });
    if (!window.ok) {
      return c.json({ error: '已超過補登期限，請聯繫管理員' }, 403);
    }
    if (window.outOfWindowByAdmin) {
      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'attendance',
          resourceId: eventId,
          action: 'retroactive_edit',
          details: { eventDate: eventDate },
        },
        c.executionCtx.waitUntil.bind(c.executionCtx),
      );
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
      recorded_by_role: resolveRecordedByRole(c.get('roles') ?? []),
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

    if (existingEventDate) {
      const window = await assertAttendanceWindow(supabase, {
        orgId,
        roles: c.get('roles') ?? [],
        eventDate: existingEventDate,
      });
      if (!window.ok) {
        return c.json({ error: '已超過補登期限，請聯繫管理員', message: undefined }, 500);
      }
      if (window.outOfWindowByAdmin) {
        logAudit(
          supabase,
          {
            orgId,
            userId,
            resourceType: 'attendance',
            resourceId: id,
            action: 'retroactive_edit',
            details: { eventDate: existingEventDate },
          },
          c.executionCtx.waitUntil.bind(c.executionCtx),
        );
      }
    }

    const updates: Record<string, unknown> = {
      recorded_by: userId,
      recorded_by_role: resolveRecordedByRole(c.get('roles') ?? []),
    };
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

    // **停課的課堂不補建出勤事件。** 出勤事件是「這堂課要點名」的載體，而停課的課
    // 不會發生 —— 補建的話行事曆與出勤相關的視圖會多出一筆不存在的課。
    // 代價是這些課堂的 `eventId` 是 null，回應 schema 明著標成 nullable。
    const ensureStatusList = statusList.filter((status) => status !== 'cancelled');
    if (ensureStatusList.length > 0) {
      const ensureEventsResult = await ensureAttendanceSessionEvents({
        supabase,
        orgId,
        campusId,
        courseIdList,
        classIdList,
        statusList: ensureStatusList,
        dateFromValue,
        dateToValue,
      });
      if (ensureEventsResult.error) {
        return c.json({ error: '補齊課堂事件失敗', message: ensureEventsResult.error }, 500);
      }
    }

    let sessionsQuery = supabase
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
        teacher_id,
        teacher:staff!teacher_id(display_name),
        schedules!schedule_id(teacher_id),
        classes!inner(name, course_id, campus_id, campuses(name), courses(name)),
        events!event_id(
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

    // ── 兩支批次查詢取代每堂各兩支 ─────────────────────────────
    //
    // 原本是 `sessions.map(async ...)` 裡各發一支 attendance_records 與一支
    // enrollments count —— 100 堂課就是 200 次往返，而儀表板一次要兩份列表。
    // 空 DB 感覺不到，有資料之後它隨課堂數線性成長。
    const sessionRows = (sessions ?? []) as any[];
    const eventIds = Array.from(
      new Set(
        sessionRows
          .map((session) => {
            const eventRow = Array.isArray(session.events) ? session.events[0] : session.events;
            return session.event_id ?? eventRow?.id ?? null;
          })
          .filter((id: string | null): id is string => Boolean(id)),
      ),
    );
    const rosterClassIds = Array.from(
      new Set(
        sessionRows
          .map((session) => session.class_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    // 考試掛在 (班級, 日期) 上，不是掛在 session 上 —— 所以用這一頁實際出現的班級與
    // 日期區間去撈，跟出勤/在籍一樣是一支批次查詢，不隨課堂數成長。
    const sessionDates = sessionRows
      .map((session) => session.session_date as string | null)
      .filter((date): date is string => Boolean(date))
      .sort();

    const [{ data: attendanceRows }, { data: enrollmentRows }, { data: examRows }] =
      await Promise.all([
        eventIds.length > 0
          ? supabase
              .from('attendance_records')
              .select('event_id, status')
              .eq('org_id', orgId)
              .in('event_id', eventIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
        rosterClassIds.length > 0
          ? supabase
              .from('enrollments')
              .select('class_id, effective_from, effective_to')
              .eq('org_id', orgId)
              .eq('status', 'active')
              .in('class_id', rosterClassIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
        rosterClassIds.length > 0 && sessionDates.length > 0
          ? supabase
              .from('academy_exam_classes')
              .select('class_id, academy_exams!inner(exam_date, org_id)')
              .eq('academy_exams.org_id', orgId)
              .in('class_id', rosterClassIds)
              .gte('academy_exams.exam_date', sessionDates[0])
              .lte('academy_exams.exam_date', sessionDates[sessionDates.length - 1])
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      ]);

    const examCounts = countExamsBySession(
      ((examRows ?? []) as Array<Record<string, unknown>>).map((row) => {
        const exam = Array.isArray(row['academy_exams'])
          ? row['academy_exams'][0]
          : (row['academy_exams'] as { exam_date?: string } | null);
        return {
          class_id: (row['class_id'] as string) ?? '',
          exam_date: exam?.exam_date ?? '',
        };
      }),
    );

    const tally = tallyAttendance(
      ((attendanceRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        eventId: row['event_id'] as string,
        status: row['status'] as string,
      })),
    );
    const enrollmentRanges: EnrollmentRange[] = (
      (enrollmentRows ?? []) as Array<Record<string, unknown>>
    ).map((row) => ({
      classId: row['class_id'] as string,
      effectiveFrom: row['effective_from'] as string,
      effectiveTo: (row['effective_to'] as string | null) ?? null,
    }));

    const results = sessionRows.map((session: any) => {
      const classRow = session.classes;
      const courseRow = Array.isArray(classRow?.courses) ? classRow.courses[0] : classRow?.courses;
      const classCampusRow = Array.isArray(classRow?.campuses)
        ? classRow.campuses[0]
        : classRow?.campuses;
      const eventRow = Array.isArray(session.events) ? session.events[0] : session.events;
      const classId = session.class_id ?? null;
      const eventId = session.event_id ?? eventRow?.id ?? null;
      const sessionDate = eventRow?.event_date ?? session.session_date ?? null;

      // 沒有出勤記錄的課堂不會出現在 tally 裡 —— 那是「還沒點名」，不是「全缺席」
      const counts = (eventId ? tally.get(eventId) : undefined) ?? {
        presentCount: 0,
        onLeaveCount: 0,
        absentCount: 0,
      };

      const scheduleRow = Array.isArray(session.schedules)
        ? session.schedules[0]
        : session.schedules;
      const teacherRow = Array.isArray(session.teacher) ? session.teacher[0] : session.teacher;

      return {
        sessionId: session.id as string,
        // 停課的課堂沒有出勤事件（ensure 刻意跳過）—— 這裡誠實回 null，
        // 讓前端關掉點名入口，而不是給一個空字串讓它以為點得下去
        eventId: eventId ?? null,
        status: (session.status ?? 'scheduled') as 'scheduled' | 'completed' | 'cancelled',
        examCount:
          examCounts.get(sessionExamKey(classId ?? '', (session.session_date as string) ?? '')) ??
          0,
        isSubstitute: isSubstituteSession({
          sessionTeacherId: (session.teacher_id as string | null) ?? null,
          scheduleTeacherId: (scheduleRow?.teacher_id as string | null) ?? null,
        }),
        classId: classId ?? '',
        className: classRow?.name ?? '',
        courseName: courseRow?.name ?? null,
        // 實際上這堂課的老師（代課時就是代課老師）—— 原本寫死 null
        teacherName: (teacherRow?.display_name as string | null) ?? null,
        campusId: eventRow?.campus_id ?? classRow?.campus_id ?? null,
        campusName: eventRow?.campuses?.name ?? classCampusRow?.name ?? null,
        eventDate: sessionDate ?? '',
        startTime: (eventRow?.start_time ?? session.start_time)?.slice(0, 5) ?? null,
        endTime: (eventRow?.end_time ?? session.end_time)?.slice(0, 5) ?? null,
        enrolledCount: classId ? countEnrolledOn(enrollmentRanges, classId, sessionDate) : 0,
        presentCount: counts.presentCount,
        onLeaveCount: counts.onLeaveCount,
        absentCount: counts.absentCount,
        takenAt: eventRow?.attendance_taken_at ?? null,
      };
    });

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
      .select('id, event_date, start_time, end_time, attendance_taken_at, sessions(class_id)')
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

    // 這一天蓋到這堂課的請假單。**推導不查紀錄** —— 理由見 RosterStudentSchema
    // 的 `hasLeaveRequest`：請假連動寫不到「請假之後才生成」的 event。
    const rosterStudentIds = (enrollments ?? []).map((e: any) => e.student_id as string);
    const { data: leaves } =
      rosterStudentIds.length === 0
        ? { data: [] as Array<Record<string, unknown>> }
        : await supabase
            .from('leave_requests')
            .select('student_id, start_date, end_date, start_time, end_time')
            .eq('org_id', orgId)
            .in('student_id', rosterStudentIds)
            .lte('start_date', eventDate)
            .gte('end_date', eventDate);

    const sessionWindow = {
      date: eventDate,
      startTime: ((ev as any).start_time as string | null) ?? null,
      endTime: ((ev as any).end_time as string | null) ?? null,
    };
    const onLeaveStudentIds = new Set(
      ((leaves ?? []) as Array<Record<string, unknown>>)
        .filter((row) =>
          leaveCoversSession(
            {
              startDate: row['start_date'] as string,
              endDate: row['end_date'] as string,
              startTime: (row['start_time'] as string | null) ?? null,
              endTime: (row['end_time'] as string | null) ?? null,
            },
            sessionWindow,
          ),
        )
        .map((row) => row['student_id'] as string),
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
        hasLeaveRequest: onLeaveStudentIds.has(e.student_id),
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

/**
 * 補登窗的伺服器端檢查。**在 2026-08-30 之前這個窗只在前端讀**
 * （`teacher/schedule.page.ts:122-127`），老師直接打 API 可以改任何日期的出勤 ——
 * 前端隱藏不構成限制，跟 c1 的道理一樣。
 *
 * 這裡照抄前端的兩個條件（見 `lib/attendance-window.ts`）：這個切片是**把規則搬到
 * 伺服器，不是改變規則**。管理員豁免，但窗外的修改會留下 audit log。
 */
async function assertAttendanceWindow(
  supabase: AppEnv['Variables']['supabase'],
  params: { orgId: string; roles: readonly string[]; eventDate: string },
): Promise<{ ok: true; outOfWindowByAdmin: boolean } | { ok: false }> {
  const { data: org } = await supabase
    .from('organizations')
    .select('attendance_responsible, attendance_retroactive_days')
    .eq('id', params.orgId)
    .maybeSingle();

  const responsible =
    ((org as { attendance_responsible?: string } | null)?.attendance_responsible as
      'admin' | 'teacher') ?? 'admin';
  const retroactiveDays = Number(
    (org as { attendance_retroactive_days?: number } | null)?.attendance_retroactive_days ?? 0,
  );
  const isAdmin = params.roles.includes('admin');
  const today = getCurrentTaipeiDateString();

  if (
    !isAttendanceEditable({
      isAdmin,
      responsible,
      retroactiveDays,
      eventDate: params.eventDate,
      today,
    })
  ) {
    return { ok: false };
  }

  // 管理員在窗外動手是低頻但高風險的動作 —— 記一筆，不然「誰把三個月前的出勤改掉了」
  // 沒有人查得出來
  const outOfWindowByAdmin =
    isAdmin &&
    !isAttendanceEditable({
      isAdmin: false,
      responsible,
      retroactiveDays,
      eventDate: params.eventDate,
      today,
    });

  return { ok: true, outOfWindowByAdmin };
}

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
