import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import type { AppEnv } from '../index';
import { enrolledEventIds } from '../lib/enrolled-events';
import { assertAttendanceWindow } from '../lib/attendance-window-check';
import { logAudit } from '../utils/audit';
import { isCampusAllowed } from '../lib/campus-scope';

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

    // **body 帶的分校要自己驗。** 全域的 `campusRequestGuard` 只看 query string ——
    // 它讀不到 body（middleware 讀 body 會跟 zod-openapi 的驗證器搶同一個 stream）。
    // 少了這一段，只管 A 校的人可以替 B 校的學生打卡。
    if (!isCampusAllowed(c.get('campusScope'), body.campusId)) {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }

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

// DELETE /api/daily-checkins/:id —— 取消打卡
//
// **走既有的 `assertAttendanceWindow`**：另寫一套的話，同一間補習班對
// 「昨天的紀錄還能不能改」會有兩個答案，而那兩個答案會出現在不同的畫面上。
//
// 衍生的出勤紀錄**刪掉，不改成 `absent`** —— `attendance-rules.md` 第 6 節：
// 沒有紀錄 ≠ 缺席，而假的缺席會流進扣課與月結。取消打卡之後那幾堂回到
// 「還沒點名」，也就是可標記狀態。
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['DailyCheckins'],
    summary: '取消打卡（連同它寫出來的出勤紀錄一起刪）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '已取消',
        content: {
          'application/json': {
            schema: z.object({ attendanceRecordsRemoved: z.number().int().nonnegative() }),
          },
        },
      },
      403: { description: '已超過補登期限' },
      404: { description: '找不到打卡紀錄' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { data: checkin } = await supabase
      .from('daily_checkins')
      .select('id, student_id, checkin_date, campus_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!checkin) return c.json({ error: '找不到打卡紀錄' }, 404);

    const row = checkin as Record<string, unknown>;
    const checkinDate = row['checkin_date'] as string;
    const studentId = row['student_id'] as string;

    const window = await assertAttendanceWindow(supabase, {
      orgId,
      roles: c.get('roles') ?? [],
      eventDate: checkinDate,
    });
    if (!window.ok) {
      return c.json({ error: '已超過補登期限，請聯繫管理員' }, 403);
    }

    // 打卡當天在這個分校的事件 —— 跟寫入時同一組條件（#178），
    // 否則會刪不乾淨或刪到別人的
    let eventsQuery = supabase
      .from('events')
      .select('id')
      .eq('org_id', orgId)
      .eq('event_date', checkinDate);

    const campusId = (row['campus_id'] as string | null) ?? null;
    if (campusId) eventsQuery = eventsQuery.eq('campus_id', campusId);

    const { data: events } = await eventsQuery;
    const eventIds = ((events ?? []) as Array<{ id: string }>).map((event) => event.id);

    let attendanceRecordsRemoved = 0;
    if (eventIds.length > 0) {
      // **只刪掉打卡寫出來的那些**（`recorded_by_role = 'system'` + `present`）——
      // 老師事後手動改過的不能被一次取消打卡抹掉
      const { data: removed } = await supabase
        .from('attendance_records')
        .delete()
        .eq('org_id', orgId)
        .eq('student_id', studentId)
        .eq('status', 'present')
        .eq('recorded_by_role', 'system')
        .in('event_id', eventIds)
        .select('id');

      attendanceRecordsRemoved = ((removed ?? []) as unknown[]).length;
    }

    await supabase.from('daily_checkins').delete().eq('id', id).eq('org_id', orgId);

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'attendance',
        resourceId: id,
        resourceName: null,
        action: 'cancel_checkin',
        details: {
          studentId,
          checkinDate,
          attendanceRecordsRemoved,
          outOfWindowByAdmin: window.outOfWindowByAdmin,
        },
      },
      waitUntilFrom(c),
    );

    return c.json({ attendanceRecordsRemoved }, 200);
  },
);

export default app;
