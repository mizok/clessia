import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { loadTeachingScope, taughtClassIds, taughtStudentIds } from '../lib/teacher-scope';
import { missingContactBookStudents, type ContactBookCandidate } from '../lib/contact-book-missing';
import { logAudit } from '../utils/audit';

/**
 * 個人聯絡簿（國小模式）：學生 × 日期，每生每日唯一一則自由文字。
 *
 * 跟教務日誌（班級 × 日期）是**兩個不同的東西**，只是補習班口語裡都叫「聯絡簿」。
 * 設計真相：kb/wiki/rules/contact-book-rules.md
 *
 * 家長簽收端點不在這裡 —— 那是 P4 的家長端工作。欄位（signed_by / signed_at）
 * 已經在 schema 裡，這支只負責把簽收狀態讀出來給老師端看。
 */
const app = new OpenAPIHono<AppEnv>();

const ContactBookEntrySchema = z
  .object({
    id: z.uuid(),
    studentId: z.uuid(),
    studentName: z.string().nullable(),
    entryDate: z.string(),
    content: z.string(),
    lastEditedByName: z.string().nullable(),
    signedBy: z.string().nullable(),
    signedAt: z.string().nullable(),
    isSigned: z.boolean(),
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
  students?: { name: string } | null;
  editor?: { name: string } | null;
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
    signedAt: typed.signed_at,
    isSigned: Boolean(typed.signed_at),
  };
}

const SELECT =
  'id, student_id, entry_date, content, last_edited_by, signed_by, signed_at, ' +
  'students(name), editor:ba_user!last_edited_by(name)';

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
      c.executionCtx?.waitUntil?.bind(c.executionCtx),
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
        studentId: z.uuid(),
        studentName: z.string(),
        /** 脈絡：這個學生在哪些開了聯絡簿的班。要寫的仍然只有一則 */
        classes: z.array(z.object({ classId: z.uuid(), className: z.string() })),
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

export default app;
