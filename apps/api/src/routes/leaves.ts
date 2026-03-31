import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

const LeaveRequestSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    studentId: z.uuid(),
    studentName: z.string(),
    startDate: z.string(),
    endDate: z.string(),
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
    studentId: z.uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().nullable().optional(),
  })
  .openapi('CreateLeave');

export function toLeaveResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    studentId: row['student_id'] as string,
    studentName: row['student_name'] as string,
    startDate: row['start_date'] as string,
    endDate: row['end_date'] as string,
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
        campusId: z.uuid().optional(),
        studentId: z.uuid().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        description: '請假紀錄列表',
        content: { 'application/json': { schema: LeaveListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { studentId, dateFrom, dateTo, page = 1, pageSize = 20 } = c.req.valid('query');

    let query = supabase
      .from('leave_requests')
      .select(`*, students!inner(name), ba_user!submitted_by(name)`, { count: 'exact' })
      .eq('org_id', orgId);

    if (studentId) query = query.eq('student_id', studentId);
    if (dateFrom) query = query.gte('start_date', dateFrom);
    if (dateTo) query = query.lte('end_date', dateTo);

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
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // 1. 建立請假紀錄
    const { data: leave, error: leaveError } = await supabase
      .from('leave_requests')
      .insert({
        org_id: orgId,
        student_id: body.studentId,
        start_date: body.startDate,
        end_date: body.endDate,
        reason: body.reason ?? null,
        submitted_by: userId,
        submitted_by_role: 'admin',
      })
      .select('*, students(name), ba_user!submitted_by(name)')
      .single();

    if (leaveError || !leave) {
      return c.json({ error: '新增請假失敗', message: leaveError?.message }, 500);
    }

    // 2. 自動更新對應日期範圍內的 attendance_records → on_leave
    const { data: events } = await supabase
      .from('events')
      .select('id')
      .eq('org_id', orgId)
      .gte('event_date', body.startDate)
      .lte('event_date', body.endDate);

    if (events && events.length > 0) {
      const eventIds = events.map((e: any) => e.id);
      await supabase
        .from('attendance_records')
        .upsert(
          eventIds.map((eventId: string) => ({
            org_id: orgId,
            student_id: body.studentId,
            event_id: eventId,
            status: 'on_leave',
            recorded_by: userId,
            recorded_by_role: 'system',
          })),
          { onConflict: 'student_id,event_id' },
        );
    }

    const row = {
      ...leave,
      student_name: (leave as any).students?.name ?? '',
      submitted_by_name: (leave as any).ba_user?.name ?? null,
    };

    return c.json(toLeaveResponse(row), 201);
  },
);

// DELETE /api/leaves/:id
app.openapi(
  createRoute({
    method: 'delete',
    path: '/:id',
    tags: ['Leaves'],
    summary: '刪除請假（attendance 恢復為 absent）',
    request: {
      params: z.object({ id: z.uuid() }),
    },
    responses: {
      204: { description: '已刪除' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    // 1. 找到這筆請假的 studentId 和日期範圍
    const { data: leave } = await supabase
      .from('leave_requests')
      .select('student_id, start_date, end_date')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!leave) {
      return c.json({ error: '找不到請假紀錄' }, 404);
    }

    // 2. 刪除請假
    await supabase.from('leave_requests').delete().eq('id', id).eq('org_id', orgId);

    // 3. 將對應 attendance_records 的 on_leave 改回 absent
    const { data: events } = await supabase
      .from('events')
      .select('id')
      .eq('org_id', orgId)
      .gte('event_date', (leave as any).start_date)
      .lte('event_date', (leave as any).end_date);

    if (events && events.length > 0) {
      const eventIds = events.map((e: any) => e.id);
      await supabase
        .from('attendance_records')
        .update({ status: 'absent' })
        .eq('student_id', (leave as any).student_id)
        .eq('status', 'on_leave')
        .in('event_id', eventIds);
    }

    return c.body(null, 204);
  },
);

export default app;
