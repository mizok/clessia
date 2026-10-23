import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { editedAfterSign } from '../lib/contact-book-sign';
import { loadTeachingScope, taughtClassIds, taughtStudentIds } from '../lib/teacher-scope';
import {
  datesInRange,
  missingContactBookByDate,
  missingContactBookStudents,
  type ContactBookCandidate,
  type SessionOnDate,
} from '../lib/contact-book-missing';
import { logAudit } from '../utils/audit';
import { getCampusScope } from '../lib/campus-scope';
import { classWriteScope, studentWriteScope } from '../lib/campus-write-guard';
import { waitUntilFrom } from '../lib/wait-until';

/**
 * 個人聯絡簿（國小模式）：學生 × 日期，每生每日唯一一則自由文字。
 *
 * 跟教務日誌（班級 × 日期）是**兩個不同的東西**，只是補習班口語裡都叫「聯絡簿」。
 * 設計真相：kb/wiki/rules/contact-book-rules.md
 *
 * 家長簽收在 `routes/parent/contact-book.ts`（#1100 #26）；這支把簽收狀態讀出來給老師端看，
 * 並標「簽收後有修改」（kb/wiki/architecture/parent-contact-book-sign.md）。
 */
const app = new OpenAPIHono<AppEnv>();

const ContactBookEntrySchema = z
  .object({
    id: DbUuidSchema,
    studentId: DbUuidSchema,
    studentName: z.string().nullable(),
    entryDate: z.string(),
    content: z.string(),
    lastEditedByName: z.string().nullable(),
    signedBy: z.string().nullable(),
    signedByName: z.string().nullable(),
    signedAt: z.string().nullable(),
    isSigned: z.boolean(),
    /** 簽收之後內容又改過（#1100 #26）—— 簽收保留，畫面標「簽收後有修改」 */
    editedAfterSign: z.boolean(),
  })
  .openapi('ContactBookEntry');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('ContactBookError');

const ListResponseSchema = z
  .object({
    data: z.array(ContactBookEntrySchema),
    meta: z.object({ total: z.number().int().min(0) }),
  })
  .openapi('ContactBookListResponse');

const UpsertSchema = z
  .object({
    studentId: DbUuidSchema,
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必須是 YYYY-MM-DD'),
    content: z.string().min(1).max(5000),
  })
  .openapi('UpsertContactBookEntry');

interface ContactBookRow {
  id: string;
  student_id: string;
  entry_date: string;
  content: string;
  last_edited_by: string | null;
  signed_by: string | null;
  signed_at: string | null;
  updated_at: string;
  students?: { name: string } | null;
  editor?: { name: string } | null;
  signer?: { name: string } | null;
}

export function toContactBookEntryResponse(row: Record<string, unknown>) {
  const typed = row as unknown as ContactBookRow;
  return {
    id: typed.id,
    studentId: typed.student_id,
    studentName: typed.students?.name ?? null,
    entryDate: typed.entry_date,
    content: typed.content,
    lastEditedByName: typed.editor?.name ?? null,
    signedBy: typed.signed_by,
    signedByName: typed.signer?.name ?? null,
    signedAt: typed.signed_at,
    isSigned: Boolean(typed.signed_at),
    editedAfterSign: editedAfterSign(typed.updated_at, typed.signed_at),
  };
}

const SELECT =
  'id, student_id, entry_date, content, last_edited_by, signed_by, signed_at, updated_at, ' +
  'students(name), editor:ba_user!last_edited_by(name), signer:ba_user!signed_by(name)';

// ── GET /api/contact-book —— 依學生或日期區間列出 ──────────────────────────
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['ContactBook'],
    summary: '聯絡簿列表',
    request: {
      query: z.object({
        studentId: DbUuidSchema.optional(),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    },
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: ListResponseSchema } } },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { studentId, from, to } = c.req.valid('query');

    const scope = await loadTeachingScope(supabase, {
      orgId,
      userId: c.get('userId'),
      roles: c.get('roles') ?? [],
    });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    let query = supabase
      .from('contact_book_entries')
      .select(SELECT, { count: 'exact' })
      .eq('org_id', orgId)
      .order('entry_date', { ascending: false });

    if (studentId) query = query.eq('student_id', studentId);
    if (from) query = query.gte('entry_date', from);
    if (to) query = query.lte('entry_date', to);

    // 老師只看得到自己任課班級的學生
    if (scope.teacherStaffId) {
      const allowed = await taughtStudentIds(supabase, orgId, scope.teacherStaffId);
      if (allowed.length === 0) {
        return c.json({ data: [], meta: { total: 0 } }, 200);
      }
      query = query.in('student_id', allowed);
    }

    const { data, count, error } = await query;
    if (error) return c.json({ error: '讀取聯絡簿失敗', code: error.code }, 500);

    return c.json(
      {
        data: (data ?? []).map((row) =>
          toContactBookEntryResponse(row as unknown as Record<string, unknown>),
        ),
        meta: { total: count ?? 0 },
      },
      200,
    );
  },
);

// ── PUT /api/contact-book —— 每生每日一則的 upsert ─────────────────────────
app.openapi(
  createRoute({
    method: 'put',
    path: '/',
    tags: ['ContactBook'],
    summary: '寫入聯絡簿（每生每日一則，重複寫入視為共同編輯）',
    request: {
      body: { content: { 'application/json': { schema: UpsertSchema } } },
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: ContactBookEntrySchema } },
      },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '學生不存在', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { studentId, entryDate, content } = c.req.valid('json');

    const scope = await loadTeachingScope(supabase, {
      orgId,
      userId: c.get('userId'),
      roles: c.get('roles') ?? [],
    });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    if (scope.teacherStaffId) {
      const allowed = await taughtStudentIds(supabase, orgId, scope.teacherStaffId);
      if (!allowed.includes(studentId)) {
        return c.json({ error: '這位學生不在你的任課班級', code: 'FORBIDDEN' }, 403);
      }
    }
    // 老師由任課範圍把關（上面）；受限的管理員由分校（#966）
    const scoped = await studentWriteScope(supabase, orgId, getCampusScope(c), studentId);
    if (scoped === 'not-found') {
      return c.json({ error: '學生不存在', code: 'NOT_FOUND' }, 404);
    }
    if (scoped === 'out-of-scope') {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }

    // **內容沒變就不寫**（#1100 #26，計畫席 10-23）：upsert 會讓 trigger 跳 `updated_at`，
    // 老師原文照存一次就讓已簽收的那則變成「簽收後有修改」，標記就沒有意義了。
    // 家長看得到的只有內容與最後編輯者 —— 原文照存連編輯者也不換（沒有人真的改了什麼）。
    const { data: existing, error: existingError } = await supabase
      .from('contact_book_entries')
      .select(SELECT)
      .eq('org_id', orgId)
      .eq('student_id', studentId)
      .eq('entry_date', entryDate)
      .maybeSingle();
    if (existingError) {
      return c.json({ error: '寫入聯絡簿失敗', code: existingError.code }, 500);
    }
    if (existing && (existing as unknown as ContactBookRow).content === content) {
      return c.json(toContactBookEntryResponse(existing as unknown as Record<string, unknown>), 200);
    }

    // 每生每日一則（rules 1）。共編＝覆寫同一列並換掉 last_edited_by，
    // 不做分段作者（rules 3）。
    const { data, error } = await supabase
      .from('contact_book_entries')
      .upsert(
        {
          org_id: orgId,
          student_id: studentId,
          entry_date: entryDate,
          content,
          last_edited_by: userId,
        },
        { onConflict: 'student_id,entry_date' },
      )
      .select(SELECT)
      .single();

    if (error || !data) {
      return c.json({ error: '寫入聯絡簿失敗', code: error?.code }, 500);
    }

    const response = toContactBookEntryResponse(data as unknown as Record<string, unknown>);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'contact_book_entry',
        resourceId: response.id,
        resourceName: `${response.studentName ?? response.studentId} / ${entryDate}`,
        action: 'upsert',
      },
      waitUntilFrom(c),
    );

    return c.json(response, 200);
  },
);

// ============================================================
// GET /api/contact-book/missing?date=YYYY-MM-DD
//
// 「這一天該寫但還沒寫的學生」。差集算在**伺服器端**，不是讓前端拿現有 API 自己拼 ——
// 前端拼要自己處理「班級清單沒有 usesContactBook 篩選」與「分頁截斷」，兩個都會靜靜地
// 漏掉班級，而漏掉的那一班不會有任何跡象。
//
// **每生一列，不是每班一列**（理由見 lib/contact-book-missing.ts）。
// ============================================================

const MissingResponseSchema = z
  .object({
    data: z.array(
      z.object({
        studentId: DbUuidSchema,
        studentName: z.string(),
        /** 脈絡：這個學生在哪些開了聯絡簿的班。要寫的仍然只有一則 */
        classes: z.array(z.object({ classId: DbUuidSchema, className: z.string() })),
      }),
    ),
    meta: z.object({ total: z.number() }),
  })
  .openapi('ContactBookMissingResponse');

app.openapi(
  createRoute({
    method: 'get',
    path: '/missing',
    tags: ['ContactBook'],
    summary: '某一天該寫但還沒寫聯絡簿的學生',
    request: {
      query: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: MissingResponseSchema } },
      },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { date } = c.req.valid('query');

    const scope = await loadTeachingScope(supabase, {
      orgId,
      userId: c.get('userId'),
      roles: c.get('roles') ?? [],
    });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    // 老師只看自己固定任課的班。沒有任何班就回空 —— 不是回全部（c1：範圍限制在伺服器）
    let taught: string[] | null = null;
    if (scope.teacherStaffId) {
      taught = await taughtClassIds(supabase, orgId, scope.teacherStaffId);
      if (taught.length === 0) {
        return c.json({ data: [], meta: { total: 0 } }, 200);
      }
    }

    // `classes!inner` + 對嵌套欄位下條件 = 一趟就把「開了聯絡簿的班的在籍學生」撈齊
    let candidateQuery = supabase
      .from('enrollments')
      .select('student_id, class_id, students(name), classes!inner(name, uses_contact_book)')
      .eq('org_id', orgId)
      .in('status', ['active', 'pending_payment'])
      .eq('classes.uses_contact_book', true);

    if (taught) candidateQuery = candidateQuery.in('class_id', taught);

    const [
      { data: candidateRows, error: candidateError },
      { data: writtenRows, error: writtenError },
      { data: sessionRows, error: sessionError },
    ] = await Promise.all([
      candidateQuery,
      supabase
        .from('contact_book_entries')
        .select('student_id')
        .eq('org_id', orgId)
        .eq('entry_date', date),
      // 「今天該寫」綁的是「這個班今天有課」—— 停課與非上課日不列入
      supabase
        .from('sessions')
        .select('class_id, status')
        .eq('org_id', orgId)
        .eq('session_date', date),
    ]);

    if (candidateError || writtenError || sessionError) {
      return c.json({ error: '讀取聯絡簿缺漏名單失敗', code: 'DB_ERROR' }, 500);
    }

    const candidates: ContactBookCandidate[] = (
      (candidateRows ?? []) as unknown as Record<string, unknown>[]
    ).map((row) => ({
      studentId: row['student_id'] as string,
      studentName: (row['students'] as { name?: string } | null)?.name ?? '',
      classId: row['class_id'] as string,
      className: (row['classes'] as { name?: string } | null)?.name ?? '',
    }));

    const written = new Set(
      ((writtenRows ?? []) as unknown as Record<string, unknown>[]).map(
        (row) => row['student_id'] as string,
      ),
    );

    const sessionsOnDate = ((sessionRows ?? []) as unknown as Record<string, unknown>[]).map(
      (row) => ({ classId: row['class_id'] as string, status: row['status'] as string }),
    );

    const missing = missingContactBookStudents(candidates, written, sessionsOnDate);

    return c.json({ data: missing, meta: { total: missing.length } }, 200);
  },
);

// ============================================================
// GET /api/contact-book/missing/summary?dateFrom=&dateTo=
//
// 同一件事的**週形狀**：區間內每天各有幾個學生還沒寫。老師端的週檢視要在有待辦的
// 那幾天點一個 ●，一天打一支 `/missing` 就是七趟往返，而七趟各自重撈同一份在籍名單。
//
// **另開端點而不是給 `/missing` 加參數**：回傳的形狀不一樣（每天一列 vs 每生一列），
// 同一個端點回兩種形狀，消費端就得先判斷自己拿到的是哪一種。逐生的那支保留不動。
// ============================================================

/** 一次最多問幾天。週檢視要 7 天，留到 31 天讓月檢視也能用；再長就是有人拿它當報表用了 */
const MISSING_SUMMARY_MAX_DAYS = 31;

const MissingSummaryResponseSchema = z
  .object({
    /** 區間內的**每一天**，包含 0 的那些 —— 前端不必自己補洞 */
    data: z.array(
      z.object({
        date: z.string(),
        missingCount: z.number().int().nonnegative(),
      }),
    ),
    /** 整個區間的總數，可以直接當週徽章 */
    meta: z.object({ total: z.number() }),
  })
  .openapi('ContactBookMissingSummaryResponse');

app.openapi(
  createRoute({
    method: 'get',
    path: '/missing/summary',
    tags: ['ContactBook'],
    summary: '一段期間內每天該寫但還沒寫聯絡簿的人數',
    request: {
      query: z.object({
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: MissingSummaryResponseSchema } },
      },
      400: { description: '區間不合法', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { dateFrom, dateTo } = c.req.valid('query');

    const dates = datesInRange(dateFrom, dateTo);
    if (dates.length === 0) {
      return c.json({ error: 'dateFrom 不能晚於 dateTo', code: 'INVALID_RANGE' }, 400);
    }
    if (dates.length > MISSING_SUMMARY_MAX_DAYS) {
      return c.json(
        { error: `一次最多查詢 ${MISSING_SUMMARY_MAX_DAYS} 天`, code: 'RANGE_TOO_LONG' },
        400,
      );
    }

    const scope = await loadTeachingScope(supabase, {
      orgId,
      userId: c.get('userId'),
      roles: c.get('roles') ?? [],
    });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    // 老師只看自己固定任課的班（c1：範圍限制在伺服器）。一班都沒有就是整個區間都 0，
    // **不是空陣列** —— 前端畫的還是同一列格子
    let taught: string[] | null = null;
    if (scope.teacherStaffId) {
      taught = await taughtClassIds(supabase, orgId, scope.teacherStaffId);
      if (taught.length === 0) {
        return c.json(
          { data: dates.map((date) => ({ date, missingCount: 0 })), meta: { total: 0 } },
          200,
        );
      }
    }

    let candidateQuery = supabase
      .from('enrollments')
      .select('student_id, class_id, students(name), classes!inner(name, uses_contact_book)')
      .eq('org_id', orgId)
      .in('status', ['active', 'pending_payment'])
      .eq('classes.uses_contact_book', true);

    if (taught) candidateQuery = candidateQuery.in('class_id', taught);

    const [
      { data: candidateRows, error: candidateError },
      { data: writtenRows, error: writtenError },
      { data: sessionRows, error: sessionError },
    ] = await Promise.all([
      candidateQuery,
      // 逐日只換這兩份 —— 在籍名單整個區間共用一份，這正是這支端點存在的理由
      supabase
        .from('contact_book_entries')
        .select('student_id, entry_date')
        .eq('org_id', orgId)
        .gte('entry_date', dateFrom)
        .lte('entry_date', dateTo),
      supabase
        .from('sessions')
        .select('class_id, status, session_date')
        .eq('org_id', orgId)
        .gte('session_date', dateFrom)
        .lte('session_date', dateTo),
    ]);

    if (candidateError || writtenError || sessionError) {
      return c.json({ error: '讀取聯絡簿缺漏名單失敗', code: 'DB_ERROR' }, 500);
    }

    const candidates: ContactBookCandidate[] = (
      (candidateRows ?? []) as unknown as Record<string, unknown>[]
    ).map((row) => ({
      studentId: row['student_id'] as string,
      studentName: (row['students'] as { name?: string } | null)?.name ?? '',
      classId: row['class_id'] as string,
      className: (row['classes'] as { name?: string } | null)?.name ?? '',
    }));

    const writtenByDate = new Map<string, Set<string>>();
    for (const row of (writtenRows ?? []) as unknown as Record<string, unknown>[]) {
      const date = row['entry_date'] as string;
      const bucket = writtenByDate.get(date) ?? new Set<string>();
      bucket.add(row['student_id'] as string);
      writtenByDate.set(date, bucket);
    }

    const sessionsByDate = new Map<string, SessionOnDate[]>();
    for (const row of (sessionRows ?? []) as unknown as Record<string, unknown>[]) {
      const date = row['session_date'] as string;
      const bucket = sessionsByDate.get(date) ?? [];
      bucket.push({ classId: row['class_id'] as string, status: row['status'] as string });
      sessionsByDate.set(date, bucket);
    }

    const days = missingContactBookByDate(candidates, writtenByDate, sessionsByDate, dates);

    return c.json(
      { data: days, meta: { total: days.reduce((sum, day) => sum + day.missingCount, 0) } },
      200,
    );
  },
);

// ============================================================
// POST /api/contact-book/remind —— 提醒那堂老師補寫（#1100 #27，計畫席 10-23）
//
// - 只給 admin；班級要在分校範圍內（別 org 404、範圍外 403）
// - 還沒寫的學生由伺服器算（跟 `/missing` 同一支 `missingContactBookStudents`），不吃前端的名單
// - 收件人＝那天這班**實際上課**的老師（`sessions.teacher_id`，代課就是代課老師；停課的堂不算）
// - 同一位老師同班同天只一則（去重鍵）—— 重按回 `alreadyReminded`，不洗版
// ============================================================

const RemindSchema = z
  .object({
    classId: DbUuidSchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必須是 YYYY-MM-DD'),
  })
  .openapi('ContactBookRemindRequest');

const RemindResponseSchema = z
  .object({
    sent: z.number().int().min(0),
    /** 這幾位老師今天已經為這班這天收過提醒（去重鍵擋下） */
    alreadyReminded: z.boolean(),
    teacherNames: z.array(z.string()),
    missingCount: z.number().int().min(1),
  })
  .openapi('ContactBookRemindResponse');

/** 通知內文最多點名幾位；再多寫「等 N 位」 */
const REMIND_NAME_LIMIT = 5;

app.openapi(
  createRoute({
    method: 'post',
    path: '/remind',
    tags: ['ContactBook'],
    summary: '提醒那天這班實際上課的老師補寫聯絡簿',
    request: { body: { content: { 'application/json': { schema: RemindSchema } } } },
    responses: {
      200: {
        description: 'OK（含今天已提醒過）',
        content: { 'application/json': { schema: RemindResponseSchema } },
      },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '班級不存在', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: '這班這天沒有缺的（NOTHING_MISSING）或沒有上課老師（NO_TEACHER）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(c.get('roles') ?? []).includes('admin')) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { classId, date } = c.req.valid('json');

    const scoped = await classWriteScope(supabase, orgId, getCampusScope(c), classId);
    if (scoped === 'not-found') return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    if (scoped === 'out-of-scope') {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }

    const [
      { data: candidateRows, error: candidateError },
      { data: writtenRows, error: writtenError },
      { data: sessionRows, error: sessionError },
    ] = await Promise.all([
      supabase
        .from('enrollments')
        .select('student_id, class_id, students(name), classes!inner(name, uses_contact_book)')
        .eq('org_id', orgId)
        .eq('class_id', classId)
        .in('status', ['active', 'pending_payment'])
        .eq('classes.uses_contact_book', true),
      supabase
        .from('contact_book_entries')
        .select('student_id')
        .eq('org_id', orgId)
        .eq('entry_date', date),
      supabase
        .from('sessions')
        .select('class_id, status, teacher_id')
        .eq('org_id', orgId)
        .eq('class_id', classId)
        .eq('session_date', date),
    ]);
    if (candidateError || writtenError || sessionError) {
      return c.json({ error: '提醒失敗，請稍後再試', code: 'DB_ERROR' }, 500);
    }

    const candidates: ContactBookCandidate[] = (
      (candidateRows ?? []) as unknown as Record<string, unknown>[]
    ).map((row) => ({
      studentId: row['student_id'] as string,
      studentName: (row['students'] as { name?: string } | null)?.name ?? '',
      classId: row['class_id'] as string,
      className: (row['classes'] as { name?: string } | null)?.name ?? '',
    }));
    const written = new Set(
      ((writtenRows ?? []) as unknown as Record<string, unknown>[]).map(
        (row) => row['student_id'] as string,
      ),
    );
    const sessions = ((sessionRows ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      classId: row['class_id'] as string,
      status: row['status'] as string,
      teacherId: (row['teacher_id'] as string | null) ?? null,
    }));
    const missing = missingContactBookStudents(candidates, written, sessions);
    if (missing.length === 0) {
      return c.json({ error: '這班這天的聯絡簿都寫了', code: 'NOTHING_MISSING' }, 409);
    }

    const staffIds = [
      ...new Set(
        sessions
          .filter((s) => s.status !== 'cancelled' && s.teacherId)
          .map((s) => s.teacherId as string),
      ),
    ];
    const { data: staffRows, error: staffError } = staffIds.length
      ? await supabase
          .from('staff')
          .select('user_id, display_name')
          .eq('org_id', orgId)
          .eq('status', 'active')
          .in('id', staffIds)
      : { data: [], error: null };
    if (staffError) return c.json({ error: '提醒失敗，請稍後再試', code: 'DB_ERROR' }, 500);
    const staff = (
      (staffRows ?? []) as Array<{ user_id: string | null; display_name: string }>
    ).filter((s): s is { user_id: string; display_name: string } => !!s.user_id);
    const { data: roleRows, error: roleError } = staff.length
      ? await supabase
          .from('user_roles')
          .select('user_id')
          .eq('role', 'teacher')
          .in(
            'user_id',
            staff.map((s) => s.user_id),
          )
      : { data: [], error: null };
    if (roleError) return c.json({ error: '提醒失敗，請稍後再試', code: 'DB_ERROR' }, 500);
    const isTeacher = new Set(
      ((roleRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    );
    const teachers = staff.filter((s) => isTeacher.has(s.user_id));
    if (teachers.length === 0) {
      return c.json({ error: '這堂沒有可以通知的上課老師', code: 'NO_TEACHER' }, 409);
    }

    const className = candidates[0]?.className ?? '';
    const [, m, d] = date.split('-').map(Number);
    const names = missing.map((s) => s.studentName);
    const listed =
      names.length > REMIND_NAME_LIMIT
        ? `${names.slice(0, REMIND_NAME_LIMIT).join('、')} 等 ${names.length} 位`
        : names.join('、');
    // 不走 `notify()`：那支吞錯回 0（通知是附帶的那種），這裡通知**就是**這次請求要做的事 ——
    // 寫失敗要回 500，不能說成「今天已提醒過」
    const { data: inserted, error: insertError } = await supabase
      .from('notifications')
      .upsert(
        teachers.map((t) => ({
          org_id: orgId,
          user_id: t.user_id,
          role: 'teacher',
          kind: 'contact_book_reminder',
          dedupe_key: `contact_book_reminder:${classId}:${date}`,
          payload: {
            title: '請補寫聯絡簿',
            body: `${className} ${m}/${d} 還有 ${missing.length} 位沒寫：${listed}`,
            url: '/teacher/schedule',
          },
          push_status: 'skipped',
          push_error: 'ROLE_PUSH_DISABLED',
        })),
        { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
      )
      .select('id');
    if (insertError) return c.json({ error: '提醒失敗，請稍後再試', code: 'DB_ERROR' }, 500);

    const sent = (inserted ?? []).length;
    return c.json(
      {
        sent,
        alreadyReminded: sent === 0,
        teacherNames: teachers.map((t) => t.display_name),
        missingCount: missing.length,
      },
      200,
    );
  },
);

export default app;
