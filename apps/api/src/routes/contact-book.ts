import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { loadTeachingScope, taughtStudentIds } from '../lib/teacher-scope';
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
        data: (data ?? []).map((row) => toContactBookEntryResponse(row as unknown as Record<string, unknown>)),
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

export default app;
