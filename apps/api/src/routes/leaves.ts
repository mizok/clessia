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
    studentId: z.uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    reason: z.string().nullable().optional(),
  })
  .openapi('CreateLeave');

function toHHmm(t: string | null | undefined): string | null {
  if (!t) return null;
  return t.slice(0, 5); // "HH:MM:SS" → "HH:MM"
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
        campusId: z.uuid().optional(),
        studentId: z.uuid().optional(),
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
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { studentId, dateFrom, dateTo, coverDate, page = 1, pageSize = 20 } = c.req.valid('query');

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
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

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
      .select('student_id, start_date, end_date')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!leave) {
      return c.json({ error: '找不到請假紀錄' }, 404);
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD (UTC)
    const startDate = (leave as any).start_date as string;
    const endDate = (leave as any).end_date as string;

    // 內部工具：將指定日期區間的 on_leave attendance 改回 absent
    const revertAttendance = async (from: string, to: string) => {
      const { data: events } = await supabase
        .from('events')
        .select('id')
        .eq('org_id', orgId)
        .gte('event_date', from)
        .lte('event_date', to);
      if (events && events.length > 0) {
        await supabase
          .from('attendance_records')
          .update({ status: 'absent' })
          .eq('student_id', (leave as any).student_id)
          .eq('status', 'on_leave')
          .in('event_id', events.map((e: any) => e.id));
      }
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
      await revertAttendance(today, endDate);
      return new Response(null, { status: 204 });
    }

    // 其他情況（full 模式、未開始、已結束）：完整刪除
    await supabase.from('leave_requests').delete().eq('id', id).eq('org_id', orgId);
    await revertAttendance(startDate, endDate);
    return new Response(null, { status: 204 });
  },
);

export default app;
