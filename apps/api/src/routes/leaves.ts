import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';

const LeaveRequestSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    studentId: DbUuidSchema,
    studentName: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    reason: z.string().nullable(),
    submittedBy: z.string(),
    submittedByRole: z.enum(['parent', 'admin']),
    submittedByName: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('LeaveRequest');

const LeaveListResponseSchema = z
  .object({
    data: z.array(LeaveRequestSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('LeaveListResponse');

const CreateLeaveSchema = z
  .object({
    studentId: DbUuidSchema,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .optional(),
    reason: z.string().nullable().optional(),
  })
  .openapi('CreateLeave');

function toHHmm(t: string | null | undefined): string | null {
  if (!t) return null;
  return t.slice(0, 5); // "HH:MM:SS" → "HH:MM"
}

interface LeaveValidationInput {
  readonly startDate: string;
  readonly endDate: string;
  readonly startTime?: string | null;
  readonly endTime?: string | null;
}

interface LeaveAttendanceEventRow {
  readonly id: string;
  readonly event_date: string;
  readonly sessions: { class_id: string } | Array<{ class_id: string }> | null;
}

interface LeaveAttendanceEnrollmentRow {
  readonly class_id: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

interface BuildLeaveAttendanceUpsertsInput {
  readonly orgId: string;
  readonly studentId: string;
  readonly recordedBy: string;
  readonly events: ReadonlyArray<LeaveAttendanceEventRow>;
  readonly enrollments: ReadonlyArray<LeaveAttendanceEnrollmentRow>;
}

interface LeaveAuditResourceNameInput {
  readonly studentName?: string | null;
  readonly startDate: string;
  readonly endDate: string;
}

export function buildLeaveAuditResourceName(input: LeaveAuditResourceNameInput): string {
  return `${input.studentName?.trim() || '請假紀錄'} / ${input.startDate} ~ ${input.endDate}`;
}

export function buildLeaveAttendanceAuditDetails(removedRecordCount: number) {
  // 欄位名維持 `affectedEventCount` —— 既有的 audit_logs 資料用的是這個鍵，
  // 改名會讓舊紀錄跟新紀錄對不起來。**值的意思變了**：現在是真的刪掉幾筆紀錄，
  // 而不是「區間裡有幾個 event」（後者跟這個學生根本無關）。
  return { affectedEventCount: removedRecordCount };
}

export function getLeaveValidationError(input: LeaveValidationInput): string | null {
  if (input.endDate < input.startDate) {
    return '結束日期不可早於開始日期';
  }

  if (
    input.startDate === input.endDate &&
    input.startTime &&
    input.endTime &&
    input.endTime < input.startTime
  ) {
    return '同一天請假的結束時間不可早於開始時間';
  }

  return null;
}

export function buildLeaveAttendanceUpserts(input: BuildLeaveAttendanceUpsertsInput) {
  return input.events
    .filter((eventRow) =>
      input.enrollments.some((enrollment) => {
        const sessionRows = Array.isArray(eventRow.sessions)
          ? eventRow.sessions
          : eventRow.sessions
            ? [eventRow.sessions]
            : [];

        return sessionRows.some(
          (sessionRow) =>
            enrollment.class_id === sessionRow.class_id &&
            enrollment.effective_from <= eventRow.event_date &&
            (!enrollment.effective_to || enrollment.effective_to >= eventRow.event_date),
        );
      }),
    )
    .map((eventRow) => ({
      org_id: input.orgId,
      student_id: input.studentId,
      event_id: eventRow.id,
      status: 'on_leave' as const,
      recorded_by: input.recordedBy,
      recorded_by_role: 'system',
    }));
}

export function toLeaveResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    studentId: row['student_id'] as string,
    studentName: row['student_name'] as string,
    startDate: row['start_date'] as string,
    endDate: row['end_date'] as string,
    startTime: toHHmm(row['start_time'] as string | null),
    endTime: toHHmm(row['end_time'] as string | null),
    reason: (row['reason'] as string | null) ?? null,
    submittedBy: row['submitted_by'] as string,
    submittedByRole: row['submitted_by_role'] as 'parent' | 'admin',
    submittedByName: (row['submitted_by_name'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
  };
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/leaves
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Leaves'],
    summary: '查詢請假紀錄',
    request: {
      query: z.object({
        campusId: DbUuidSchema.optional(),
        studentId: DbUuidSchema.optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        coverDate: z.string().optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        description: '請假紀錄列表',
        content: { 'application/json': { schema: LeaveListResponseSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const {
      studentId,
      dateFrom,
      dateTo,
      coverDate,
      page = 1,
      pageSize = 20,
    } = c.req.valid('query');

    let query = supabase
      .from('leave_requests')
      .select(`*, students!inner(name), ba_user!submitted_by(name)`, { count: 'exact' })
      .eq('org_id', orgId);

    if (studentId) query = query.eq('student_id', studentId);
    if (dateFrom) query = query.gte('start_date', dateFrom);
    if (dateTo) query = query.lte('end_date', dateTo);
    // coverDate: 找出請假範圍包含指定日期的紀錄（start_date <= date AND end_date >= date）
    if (coverDate) {
      query = query.lte('start_date', coverDate).gte('end_date', coverDate);
    }

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1).order('created_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      return c.json({ error: '讀取請假紀錄失敗', message: error.message }, 500);
    }

    const rows = (data ?? []).map((r: any) => ({
      ...r,
      student_name: r.students?.name ?? '',
      submitted_by_name: r.ba_user?.name ?? null,
    }));

    const total = count ?? 0;
    return c.json(
      {
        data: rows.map(toLeaveResponse),
        meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      },
      200,
    );
  },
);

// POST /api/leaves
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Leaves'],
    summary: '新增請假（即生效，自動更新出勤狀態）',
    request: {
      body: { content: { 'application/json': { schema: CreateLeaveSchema } } },
    },
    responses: {
      201: {
        description: '建立的請假紀錄',
        content: { 'application/json': { schema: LeaveRequestSchema } },
      },
      400: { description: '參數錯誤' },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    const validationError = getLeaveValidationError(body);
    if (validationError) {
      return c.json({ error: '請假資料無效', message: validationError }, 400);
    }

    // 1. 衝突檢查：同學生是否有重疊的請假紀錄
    const { data: conflicts } = await supabase
      .from('leave_requests')
      .select('id, start_date, end_date')
      .eq('org_id', orgId)
      .eq('student_id', body.studentId)
      .lte('start_date', body.endDate)
      .gte('end_date', body.startDate);

    if (conflicts && conflicts.length > 0) {
      const overlap = conflicts[0] as { start_date: string; end_date: string };
      return c.json(
        {
          error: '請假時間重疊',
          message: `該學生在 ${overlap.start_date} ~ ${overlap.end_date} 已有請假紀錄`,
        },
        409,
      );
    }

    // 2. 建立請假紀錄
    const { data: leave, error: leaveError } = await supabase
      .from('leave_requests')
      .insert({
        org_id: orgId,
        student_id: body.studentId,
        start_date: body.startDate,
        end_date: body.endDate,
        start_time: body.startTime ?? null,
        end_time: body.endTime ?? null,
        reason: body.reason ?? null,
        submitted_by: userId,
        submitted_by_role: 'admin',
      })
      .select('*, students(name), ba_user!submitted_by(name)')
      .single();

    if (leaveError || !leave) {
      return c.json({ error: '新增請假失敗', message: leaveError?.message }, 500);
    }

    // 3. 自動更新對應日期範圍內、且該學生實際有報名的 attendance_records → on_leave
    const { data: events } = await supabase
      .from('events')
      .select('id, event_date, sessions!inner(class_id)')
      .eq('org_id', orgId)
      .eq('event_type', 'session')
      .gte('event_date', body.startDate)
      .lte('event_date', body.endDate);

    if (events && events.length > 0) {
      const classIds = Array.from(
        new Set(
          (events as LeaveAttendanceEventRow[])
            .flatMap((eventRow) =>
              Array.isArray(eventRow.sessions)
                ? eventRow.sessions.map((sessionRow) => sessionRow.class_id)
                : eventRow.sessions?.class_id
                  ? [eventRow.sessions.class_id]
                  : [],
            )
            .filter((classId): classId is string => !!classId),
        ),
      );

      const { data: enrollments } =
        classIds.length === 0
          ? { data: [] }
          : await supabase
              .from('enrollments')
              .select('class_id, effective_from, effective_to')
              .eq('org_id', orgId)
              .eq('student_id', body.studentId)
              .eq('status', 'active')
              .in('class_id', classIds)
              .lte('effective_from', body.endDate)
              .or(`effective_to.is.null,effective_to.gte.${body.startDate}`);

      const attendanceUpserts = buildLeaveAttendanceUpserts({
        orgId,
        studentId: body.studentId,
        recordedBy: userId,
        events: (events ?? []) as LeaveAttendanceEventRow[],
        enrollments: (enrollments ?? []) as LeaveAttendanceEnrollmentRow[],
      });

      if (attendanceUpserts.length > 0) {
        await supabase.from('attendance_records').upsert(attendanceUpserts, {
          onConflict: 'student_id,event_id',
        });
      }

      if (attendanceUpserts.length > 0) {
        logAudit(
          supabase,
          {
            orgId,
            userId,
            resourceType: 'attendance',
            resourceId: leave.id as string,
            resourceName: buildLeaveAuditResourceName({
              studentName: (leave as any).students?.name ?? '',
              startDate: body.startDate,
              endDate: body.endDate,
            }),
            action: 'sync_leave_to_attendance',
            details: buildLeaveAttendanceAuditDetails(attendanceUpserts.length),
          },
          c.executionCtx.waitUntil.bind(c.executionCtx),
        );
      }
    }

    const row = {
      ...leave,
      student_name: (leave as any).students?.name ?? '',
      submitted_by_name: (leave as any).ba_user?.name ?? null,
    };

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'leave',
        resourceId: leave.id as string,
        resourceName: buildLeaveAuditResourceName({
          studentName: row.student_name,
          startDate: body.startDate,
          endDate: body.endDate,
        }),
        action: 'create',
        details: {
          startTime: body.startTime ?? null,
          endTime: body.endTime ?? null,
          reason: body.reason ?? null,
        },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json(toLeaveResponse(row), 201);
  },
);

// DELETE /api/leaves/:id
app.openapi(
  createRoute({
    method: 'delete',
    path: '/:id',
    tags: ['Leaves'],
    summary: '刪除請假（未點名的日子回到無紀錄，已點名的維持不動）',
    request: {
      params: z.object({ id: DbUuidSchema }),
      query: z.object({
        mode: z.enum(['truncate', 'full']).default('truncate').optional(),
      }),
    },
    responses: {
      204: { description: '已刪除' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const { mode = 'truncate' } = c.req.valid('query');

    // 1. 找到請假紀錄
    const { data: leave } = await supabase
      .from('leave_requests')
      .select('id, student_id, start_date, end_date, students(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!leave) {
      return c.json({ error: '找不到請假紀錄' }, 404);
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD (UTC)
    const startDate = (leave as any).start_date as string;
    const endDate = (leave as any).end_date as string;

    /**
     * 把區間內因為這張假而寫下的 `on_leave` 紀錄**刪掉**，讓那幾天回到「還沒點名」。
     *
     * **原本是改成 `absent`，那是錯的**：管理員刪掉一張假，那幾天的學生就全被記成缺席，
     * 而根本沒有人點過那些名。「沒有紀錄」與「缺席」是兩件事（見 #145、#169）——
     * 系統不該替沒發生過的判斷寫一個答案。刪掉之後那幾天回到可標記狀態。
     *
     * **已經點過名的日子維持不動**（`attendance_taken_at` 不是 null）：
     * 那天有人真的看過名單、做過判斷，`on_leave` 是那個判斷的一部分。
     * 假被刪掉不代表可以回頭改寫別人已經做完的事。
     */
    const revertAttendance = async (from: string, to: string) => {
      const { data: events } = await supabase
        .from('events')
        .select('id')
        .eq('org_id', orgId)
        .is('attendance_taken_at', null)
        .gte('event_date', from)
        .lte('event_date', to);

      if (!events || events.length === 0) return 0;

      const { data: removed } = await supabase
        .from('attendance_records')
        .delete()
        .eq('student_id', (leave as any).student_id)
        .eq('status', 'on_leave')
        .in(
          'event_id',
          events.map((e: any) => e.id),
        )
        .select('id');

      // 回傳**真的刪掉幾筆**，不是「區間裡有幾個 event」——
      // 後者本來就跟這個學生無關，寫進稽核只會誤導
      return ((removed ?? []) as unknown[]).length;
    };

    const isActive = startDate <= today && endDate >= today;

    // truncate 模式且為進行中：保留過去，截斷今日起
    if (mode === 'truncate' && isActive) {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      await supabase
        .from('leave_requests')
        .update({ end_date: yesterday })
        .eq('id', id)
        .eq('org_id', orgId);
      const revertedCount = await revertAttendance(today, endDate);

      logAudit(
        supabase,
        {
          orgId,
          userId: c.get('userId'),
          resourceType: 'leave',
          resourceId: id,
          resourceName: buildLeaveAuditResourceName({
            studentName: (leave as any).students?.name ?? '',
            startDate,
            endDate,
          }),
          action: 'truncate_leave',
          details: { truncatedFrom: today, truncatedTo: yesterday },
        },
        c.executionCtx.waitUntil.bind(c.executionCtx),
      );

      if (revertedCount > 0) {
        logAudit(
          supabase,
          {
            orgId,
            userId: c.get('userId'),
            resourceType: 'attendance',
            resourceId: id,
            resourceName: buildLeaveAuditResourceName({
              studentName: (leave as any).students?.name ?? '',
              startDate,
              endDate,
            }),
            action: 'revert_leave_attendance',
            details: buildLeaveAttendanceAuditDetails(revertedCount),
          },
          c.executionCtx.waitUntil.bind(c.executionCtx),
        );
      }

      return new Response(null, { status: 204 });
    }

    // 其他情況（full 模式、未開始、已結束）：完整刪除
    await supabase.from('leave_requests').delete().eq('id', id).eq('org_id', orgId);
    const revertedCount = await revertAttendance(startDate, endDate);

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'leave',
        resourceId: id,
        resourceName: buildLeaveAuditResourceName({
          studentName: (leave as any).students?.name ?? '',
          startDate,
          endDate,
        }),
        action: 'delete',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    if (revertedCount > 0) {
      logAudit(
        supabase,
        {
          orgId,
          userId: c.get('userId'),
          resourceType: 'attendance',
          resourceId: id,
          resourceName: buildLeaveAuditResourceName({
            studentName: (leave as any).students?.name ?? '',
            startDate,
            endDate,
          }),
          action: 'revert_leave_attendance',
          details: buildLeaveAttendanceAuditDetails(revertedCount),
        },
        c.executionCtx.waitUntil.bind(c.executionCtx),
      );
    }

    return new Response(null, { status: 204 });
  },
);

export default app;
