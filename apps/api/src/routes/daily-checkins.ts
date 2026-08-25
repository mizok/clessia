import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

const DailyCheckinSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    studentId: z.uuid(),
    campusId: z.uuid().nullable(),
    checkinDate: z.string(),
    checkedInAt: z.string(),
    createdAt: z.string(),
  })
  .openapi('DailyCheckin');

const CreateDailyCheckinSchema = z
  .object({
    studentId: z.uuid(),
    campusId: z.uuid().optional(),
    checkinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .openapi('CreateDailyCheckin');

const app = new OpenAPIHono<AppEnv>();

// POST /api/daily-checkins
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['DailyCheckins'],
    summary: '日到班打卡（批次建立當日出勤紀錄）',
    request: {
      body: { content: { 'application/json': { schema: CreateDailyCheckinSchema } } },
    },
    responses: {
      201: {
        description: '打卡紀錄',
        content: { 'application/json': { schema: DailyCheckinSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // 1. 建立打卡紀錄（UPSERT 防重複，UNIQUE: student_id, checkin_date）
    const { data: checkin, error } = await supabase
      .from('daily_checkins')
      .upsert(
        {
          org_id: orgId,
          student_id: body.studentId,
          campus_id: body.campusId ?? null,
          checkin_date: body.checkinDate,
          checked_in_at: new Date().toISOString(),
          checked_in_by: userId,
        },
        { onConflict: 'student_id,checkin_date' },
      )
      .select()
      .single();

    if (error || !checkin) {
      return c.json({ error: '打卡失敗', message: error?.message }, 500);
    }

    // 2. 找出該學生當天在此分校的所有 events → 批次建立 attendance_records（present）
    let eventsQuery = supabase
      .from('events')
      .select('id')
      .eq('org_id', orgId)
      .eq('event_date', body.checkinDate);

    if (body.campusId) {
      eventsQuery = eventsQuery.eq('campus_id', body.campusId);
    }

    const { data: events } = await eventsQuery;

    if (events && events.length > 0) {
      const eventIds = events.map((e: any) => e.id);
      await supabase.from('attendance_records').upsert(
        eventIds.map((eventId: string) => ({
          org_id: orgId,
          student_id: body.studentId,
          event_id: eventId,
          status: 'present',
          recorded_by: userId,
          recorded_by_role: 'system',
        })),
        { onConflict: 'student_id,event_id', ignoreDuplicates: false },
      );
    }

    return c.json(
      {
        id: (checkin as any).id,
        orgId: (checkin as any).org_id,
        studentId: (checkin as any).student_id,
        campusId: (checkin as any).campus_id ?? null,
        checkinDate: (checkin as any).checkin_date,
        checkedInAt: (checkin as any).checked_in_at,
        createdAt: (checkin as any).created_at,
      },
      201,
    );
  },
);

export default app;
