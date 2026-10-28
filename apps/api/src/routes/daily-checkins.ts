import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import type { AppEnv } from '../index';
import { enrolledClassIdsOn } from '../lib/enrolled-events';
import { isCancelledSession } from '../lib/cancelled-session';
import { writeDailyCheckin } from '../lib/daily-checkin-write';
import { assertAttendanceWindow } from '../lib/attendance-window-check';
import { logAudit } from '../utils/audit';
import { getCampusScope, isCampusAllowed } from '../lib/campus-scope';
import { resourceCampusAllowed, studentWriteScope } from '../lib/campus-write-guard';
import { DbUuidSchema } from '../lib/validation';
import { resolveAttendanceMode } from '../lib/attendance-mode';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import { normalizeCardCode } from '../lib/checkin-cards';

const DailyCheckinSchema = z
  .object({
    id: DbUuidSchema,
    orgId: DbUuidSchema,
    studentId: DbUuidSchema,
    campusId: DbUuidSchema.nullable(),
    checkinDate: z.string(),
    checkedInAt: z.string(),
    createdAt: z.string(),
  })
  .openapi('DailyCheckin');

/** #1127：機台掃完給學生看的確認資訊 —— 只有剛打卡的那一位 */
const CheckinConfirmationSchema = DailyCheckinSchema.extend({
  student: z.object({ name: z.string() }),
  /** 這次是重掃（當天已經打過）—— 不是錯誤，畫面講第一次的時間（`checkedInAt` 就是那一次） */
  alreadyCheckedIn: z.boolean(),
  /** 這次打卡套用的出勤模式（分校層級）。課堂模式只記到班，出席由老師點名 */
  attendanceMode: z.enum(['daily_checkin', 'per_session']),
  todaySessions: z.array(
    z.object({
      sessionId: DbUuidSchema,
      className: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      /** 有假單蓋到這堂（跟點名名單同一個判準 `leaveCoversSession`） */
      onLeave: z.boolean(),
      /** 寫完之後這堂**實際**的出勤紀錄；沒有就是 null（課堂模式、或當天 event 還沒生成） */
      attendance: z.enum(['present', 'absent', 'on_leave']).nullable(),
    }),
  ),
}).openapi('DailyCheckinConfirmation');

const CreateDailyCheckinSchema = z
  .object({
    /** 跟 `cardCode` 二擇一：行政在名單上選人、或舊版卡（QR＝學生 id） */
    studentId: DbUuidSchema.optional(),
    /**
     * 到班卡代碼（#1100 #42）：`CK1-`＋16 碼，分組的連字號、大小寫都收（卡面可手打）。
     * 查不到 404、已作廢 409 `CARD_REVOKED`
     */
    cardCode: z.string().max(40).optional(),
    campusId: DbUuidSchema.optional(),
    checkinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /**
     * 到班來源（#1100 #52）：行政的掃碼站帶 `scan`。**沒帶當 manual**（沒有證據說是掃碼，就不寫掃碼）。
     * 機台帳號不看這個參數，一律 scan
     */
    source: z.enum(['scan', 'manual']).optional(),
  })
  .openapi('CreateDailyCheckin');

const app = new OpenAPIHono<AppEnv>();

/** 純機台帳號（#1127）：kiosk 角色、沒有同時是管理員 */
const isKioskOnly = (roles: readonly string[] | undefined) =>
  (roles ?? []).includes('kiosk') && !(roles ?? []).includes('admin');

/**
 * #1127：掃碼機台是放在門口、誰都摸得到的平板 —— **只能打卡**。這支 route 的讀（當日名單）
 * 與刪除都不開給它。掛載層（`index.ts`）只看角色，分不出方法，所以在這裡擋。
 */
app.use('*', async (c, next) => {
  if (
    isKioskOnly(c.get('roles')) &&
    !(c.req.method === 'POST' && c.req.path.endsWith('/daily-checkins'))
  ) {
    return c.json({ error: '掃碼機台只能打卡', code: 'FORBIDDEN' }, 403);
  }
  return next();
});

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
        description: '打卡紀錄＋確認資訊（學生名、今日課堂）',
        content: { 'application/json': { schema: CheckinConfirmationSchema } },
      },
      400: { description: 'studentId 與 cardCode 要剛好給一個' },
      404: { description: '學生不存在／認不得這張卡（CARD_NOT_FOUND）' },
      409: { description: '卡已作廢（CARD_REVOKED）／舊版卡已被新卡取代（LEGACY_CARD）' },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { cardCode, studentId: givenStudentId, ...rest } = c.req.valid('json');
    if ((cardCode === undefined) === (givenStudentId === undefined)) {
      return c.json({ error: 'studentId 與 cardCode 要剛好給一個', code: 'BAD_REQUEST' }, 400);
    }
    const scanned = isKioskOnly(c.get('roles')) || rest.source === 'scan';

    let studentId: string;
    if (cardCode !== undefined) {
      // 到班卡（#1100 #42）：代碼查卡 → 學生，接回下面同一條流程（分校、日期、寫入都一樣）
      const code = normalizeCardCode(cardCode);
      const { data: card, error } = code
        ? await supabase
            .from('checkin_cards')
            .select('student_id, revoked_at')
            .eq('org_id', orgId)
            .eq('code', code)
            .maybeSingle()
        : { data: null, error: null };
      if (error) return c.json({ error: '讀取到班卡失敗', message: error.message }, 500);
      if (!card) return c.json({ error: '認不得這張卡', code: 'CARD_NOT_FOUND' }, 404);
      const row = card as { student_id: string; revoked_at: string | null };
      if (row.revoked_at) {
        return c.json({ error: '這張卡已作廢，請找櫃台補發', code: 'CARD_REVOKED' }, 409);
      }
      studentId = row.student_id;
    } else {
      studentId = givenStudentId!;
      // 舊版卡的 QR 就是學生 id（過渡期，計畫席 10-23：上線後 30 天另開 PR 關掉）。
      // **該生一印過新卡，舊卡就失效** —— 否則補發作廢不了拍照、遺失的舊卡。
      // 只管掃碼：行政在名單上選人（manual）不是拿卡，照舊
      if (scanned) {
        const { data: cards, error } = await supabase
          .from('checkin_cards')
          .select('id')
          .eq('org_id', orgId)
          .eq('student_id', studentId)
          .limit(1);
        if (error) return c.json({ error: '讀取到班卡失敗', message: error.message }, 500);
        if ((cards ?? []).length > 0) {
          return c.json({ error: '舊版卡片已停用，請用新的到班卡', code: 'LEGACY_CARD' }, 409);
        }
      }
    }
    const body = { ...rest, studentId };

    // #1127：機台的分校是帳號綁的那一個、日期是台北今天。body 給別的就拒絕 ——
    // 默默改掉會讓「機台設定錯了」看起來像打卡成功。
    if (isKioskOnly(c.get('roles'))) {
      const scope = getCampusScope(c);
      if (!scope || scope.length !== 1) {
        return c.json({ error: '機台帳號要綁定剛好一個分校', code: 'FORBIDDEN' }, 403);
      }
      const [kioskCampus] = scope;
      if (body.campusId !== undefined && body.campusId !== kioskCampus) {
        return c.json({ error: '機台只能替自己的分校打卡', code: 'FORBIDDEN' }, 403);
      }
      if (body.checkinDate !== getCurrentTaipeiDateString()) {
        return c.json({ error: '機台只能打今天的卡', code: 'FORBIDDEN' }, 403);
      }
      body.campusId = kioskCampus;
    }

    // **body 帶的分校要自己驗。** 全域的 `campusRequestGuard` 只看 query string ——
    // 它讀不到 body（middleware 讀 body 會跟 zod-openapi 的驗證器搶同一個 stream）。
    // 少了這一段，只管 A 校的人可以替 B 校的學生打卡。
    if (!isCampusAllowed(getCampusScope(c), body.campusId)) {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }
    // 打卡分校填自己的、學生卻是別校的 —— 上面那道擋不到（#966）
    const scoped = await studentWriteScope(supabase, orgId, getCampusScope(c), body.studentId);
    if (scoped === 'not-found') {
      return c.json({ error: '學生不存在', code: 'NOT_FOUND' }, 404);
    }
    if (scoped === 'out-of-scope') {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }

    // 0. 出勤模式（#1099）。**在任何寫入之前讀** —— 讀不到就不知道該不該替課堂寫出勤，
    //    停在這裡比「到班寫了、課堂出勤猜一個」好。分校層級（#1112）：打卡帶了分校就看
    //    那個分校的設定，沒設定或沒帶分校沿用機構預設。
    const { mode: attendanceMode, error: modeError } = await resolveAttendanceMode(
      supabase,
      orgId,
      body.campusId,
    );
    if (modeError) {
      return c.json({ error: '讀取出勤模式失敗', message: modeError.message }, 500);
    }

    // 1–2. 打卡紀錄＋日到班的課堂出勤（共用 lib：老師「他到了」也走它，#1314 TS3）
    const written = await writeDailyCheckin(supabase, {
      orgId,
      userId,
      studentId: body.studentId,
      campusId: body.campusId,
      checkinDate: body.checkinDate,
      campusScope: getCampusScope(c),
      mode: attendanceMode,
      source: isKioskOnly(c.get('roles')) ? 'scan' : (body.source ?? 'manual'),
    });
    if (written.error) {
      return c.json({ error: '打卡失敗', message: written.error.message }, 500);
    }
    const { checkin, alreadyCheckedIn, enrollmentRows, coveredByLeave, eventIds } = written;

    // 取消打卡（DELETE）一直有稽核，建立卻沒有 —— 於是「這個人今天被標成到班過」
    // 在 `audit_logs` 上只留得下後半段（#919）。`details` 帶衍生出勤列的筆數，
    // 跟 `cancel_checkin` 的 `attendanceRecordsRemoved` 對得起來。
    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'attendance',
        resourceId: (checkin as any).id,
        resourceName: null,
        action: 'checkin',
        details: {
          studentId: body.studentId,
          checkinDate: body.checkinDate,
          attendanceRecordsCreated: eventIds.length,
        },
      },
      waitUntilFrom(c),
    );

    // 確認資訊（#1127）。課堂讀 `sessions` 不讀 `events`：events 是讀取時才補建的，
    // 當天還沒人開過課表時它不存在。分校條件跟寫出勤同一組（指名分校，或呼叫者的範圍）。
    const classIds = [...enrolledClassIdsOn(enrollmentRows, body.checkinDate)];
    const confirmationScope = body.campusId ? [body.campusId] : getCampusScope(c);
    let sessionsQuery = supabase
      .from('sessions')
      .select('id, event_id, start_time, end_time, status, classes!inner(name, campus_id)')
      .eq('org_id', orgId)
      .eq('session_date', body.checkinDate)
      .in('class_id', classIds);
    if (confirmationScope !== null) {
      sessionsQuery = sessionsQuery.in('classes.campus_id', [...confirmationScope]);
    }
    const [{ data: student }, { data: sessionRows }] = await Promise.all([
      supabase
        .from('students')
        .select('name')
        .eq('org_id', orgId)
        .eq('id', body.studentId)
        .maybeSingle(),
      classIds.length > 0 ? sessionsQuery : Promise.resolve({ data: [] }),
    ]);
    const liveSessions = ((sessionRows ?? []) as Array<Record<string, any>>).filter(
      (row) => !isCancelledSession(row),
    );
    // 寫完之後讀回實際紀錄 —— 畫面講「已記出席／請假」要講真的，不是猜這次寫了什麼
    const sessionEventIds = liveSessions
      .map((row) => row['event_id'] as string | null)
      .filter((id): id is string => !!id);
    const { data: recordRows } =
      sessionEventIds.length > 0
        ? await supabase
            .from('attendance_records')
            .select('event_id, status')
            .eq('org_id', orgId)
            .eq('student_id', body.studentId)
            .in('event_id', sessionEventIds)
        : { data: [] };
    const statusByEvent = new Map(
      ((recordRows ?? []) as Array<{ event_id: string; status: string }>).map((r) => [
        r.event_id,
        r.status,
      ]),
    );
    const todaySessions = liveSessions
      .map((row) => {
        const klass = Array.isArray(row['classes']) ? row['classes'][0] : row['classes'];
        const startTime = row['start_time'] as string;
        const endTime = row['end_time'] as string;
        const sessionId = row['id'] as string;
        const eventId = row['event_id'] as string | null;
        return {
          sessionId,
          className: (klass?.name as string | undefined) ?? '',
          startTime,
          endTime,
          onLeave: coveredByLeave({ sessionId, date: body.checkinDate, startTime, endTime }),
          attendance: ((eventId && statusByEvent.get(eventId)) || null) as
            'present' | 'absent' | 'on_leave' | null,
        };
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    return c.json(
      {
        student: { name: ((student as { name?: string } | null)?.name as string) ?? '' },
        alreadyCheckedIn,
        attendanceMode,
        todaySessions,
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
    request: { params: z.object({ id: DbUuidSchema }) },
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

    // 分校範圍（#966）：打卡有記分校就看它；沒記（舊資料、不指名的打卡）退回學生的分校
    const checkinCampusId = (row['campus_id'] as string | null) ?? null;
    const scope = getCampusScope(c);
    const scoped = checkinCampusId
      ? resourceCampusAllowed(scope, checkinCampusId)
        ? 'ok'
        : 'out-of-scope'
      : await studentWriteScope(supabase, orgId, scope, studentId);
    if (scoped === 'not-found') {
      return c.json({ error: '學生不存在', code: 'NOT_FOUND' }, 404);
    }
    if (scoped === 'out-of-scope') {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }

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
