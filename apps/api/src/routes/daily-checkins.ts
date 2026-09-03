import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { enrolledEventIds } from '../lib/enrolled-events';

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

    // 2. 替該學生當天**實際有報名**的課堂建立 attendance_records（present）
    //
    // **原本是「當天這個分校的所有課堂」** —— 包含他根本沒報名的班，於是出勤紀錄裡
    // 會冒出他從來沒上過的課，而那些紀錄會流進扣課與月結（使用者 2026-09-03 裁定）。
    //
    // 到班紀錄（步驟 1）與課堂出勤是**兩層**：人到了就是到了，即使他今天一堂課都沒有。
    // 所以這一段一筆都寫不出來是正常結果，不是失敗。
    let eventsQuery = supabase
      .from('events')
      .select('id, sessions(class_id)')
      .eq('org_id', orgId)
      .eq('event_date', body.checkinDate);

    if (body.campusId) {
      eventsQuery = eventsQuery.eq('campus_id', body.campusId);
    }

    const [{ data: events }, { data: enrollments }] = await Promise.all([
      eventsQuery,
      // 在籍條件照抄 roster（`status = 'active'` + 生效區間）—— 掃碼寫得出來的紀錄，
      // 必須是那堂課點名時看得到的人，否則會出現「有出勤紀錄但名單上沒這個人」的鬼影
      supabase
        .from('enrollments')
        .select('class_id, effective_from, effective_to')
        .eq('org_id', orgId)
        .eq('student_id', body.studentId)
        .eq('status', 'active'),
    ]);

    const eventIds = enrolledEventIds(
      (events ?? []) as Array<{
        id: string;
        sessions?: { class_id?: string | null } | Array<{ class_id?: string | null }> | null;
      }>,
      (enrollments ?? []) as Array<{
        class_id: string;
        effective_from: string;
        effective_to: string | null;
      }>,
      body.checkinDate,
    );

    if (eventIds.length > 0) {
      await supabase.from('attendance_records').upsert(
        eventIds.map((eventId: string) => ({
          org_id: orgId,
          student_id: body.studentId,
          event_id: eventId,
          status: 'present',
          recorded_by: userId,
          recorded_by_role: 'system',
        })),
        // **只補沒有的，不動已經存在的。** 掃碼是機器讀到一張卡，不該推翻老師的判斷 ——
        // 老師改成缺席、學生事後補掃，原本會被改回 present 而且不留痕跡。
        // 掃碼寫的永遠是 `present`，所以「跳過已存在的」不會漏掉任何資訊。
        { onConflict: 'student_id,event_id', ignoreDuplicates: true },
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
