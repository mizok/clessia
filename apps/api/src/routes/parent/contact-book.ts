import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { editedAfterSign } from '../../lib/contact-book-sign';
import { getAuth } from '../../lib/get-auth';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 家長讀孩子的個人聯絡簿、按「已閱簽收」（#1100 #26，保留類：家長讀取＋寫入面）。
 *
 * 個人聯絡簿是**學生 × 日期**（國小模式），跟教務日誌（班級 × 日期，`/api/me/class-logs`）是兩個東西。
 * 讀取走 `childDb`（scope 條件已經帶上）；簽收走 `childDb.signContactBookEntry`（為什麼走 pg 見那支）。
 * 規則：kb/wiki/rules/contact-book-rules.md 第 4 節。
 */

/** 課表詳情「之前的聯絡簿」要的窗（跟作業歷史同寬） */
const MAX_WINDOW_DAYS = 120;

const SELECT =
  'id, student_id, entry_date, content, updated_at, signed_at, ' +
  'editor:ba_user!last_edited_by(name), signer:ba_user!signed_by(name)';

const ParentContactBookEntrySchema = z
  .object({
    id: DbUuidSchema,
    entryDate: z.string(),
    content: z.string(),
    lastEditedByName: z.string().nullable(),
    updatedAt: z.string(),
    signedAt: z.string().nullable(),
    /** 簽收的人（可能是另一位家長） */
    signedByName: z.string().nullable(),
    /** 簽收之後內容又改過 —— 家長端顯示「有更新」 */
    editedAfterSign: z.boolean(),
  })
  .openapi('ParentContactBookEntry');

const ListResponseSchema = z
  .object({ data: z.array(ParentContactBookEntrySchema) })
  .openapi('ParentContactBookListResponse');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('ParentContactBookError');

type Row = Record<string, unknown>;
const one = (value: unknown): Row | null => (Array.isArray(value) ? value[0] : value) as Row | null;

function toEntry(row: Row) {
  const updatedAt = row['updated_at'] as string;
  const signedAt = (row['signed_at'] as string | null) ?? null;
  return {
    id: row['id'] as string,
    entryDate: row['entry_date'] as string,
    content: row['content'] as string,
    lastEditedByName: (one(row['editor'])?.['name'] as string | undefined) ?? null,
    updatedAt,
    signedAt,
    signedByName: (one(row['signer'])?.['name'] as string | undefined) ?? null,
    editedAfterSign: editedAfterSign(updatedAt, signedAt),
  };
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/contact-book
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '這個孩子在日期窗內的個人聯絡簿',
    request: {
      query: z.object({
        childId: DbUuidSchema,
        dateFrom: z.string().date(),
        dateTo: z.string().date(),
      }),
    },
    responses: {
      200: { description: '成功', content: { 'application/json': { schema: ListResponseSchema } } },
      400: {
        description: `日期窗不合法（倒置或超過 ${MAX_WINDOW_DAYS} 天）`,
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: '不是家長身分或這個孩子不在範圍內',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(c.get('roles') ?? []).includes('parent')) {
      return c.json({ error: '不是家長身分', code: 'NOT_PARENT' }, 403);
    }
    const { childId, dateFrom, dateTo } = c.req.valid('query');
    const days = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000;
    if (days < 0 || days > MAX_WINDOW_DAYS) {
      return c.json({ error: '日期區間不合法', code: 'INVALID_DATE_RANGE' }, 400);
    }
    if (!isChildAllowed(c.get('studentScope'), childId)) {
      return c.json({ error: '沒有這個孩子的權限', code: 'CHILD_OUT_OF_SCOPE' }, 403);
    }

    const { data, error } = await c
      .get('childDb')
      .from('contact_book_entries', 'student_id')
      .select(SELECT)
      .eq('student_id', childId)
      .gte('entry_date', dateFrom)
      .lte('entry_date', dateTo)
      .order('entry_date', { ascending: false });
    if (error) {
      return c.json({ error: '讀取聯絡簿失敗', code: 'FETCH_CONTACT_BOOK_FAILED' }, 500);
    }
    return c.json({ data: ((data ?? []) as unknown as Row[]).map(toEntry) }, 200);
  },
);

// POST /api/me/contact-book/{id}/sign
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/sign',
    tags: ['Me'],
    summary: '已閱簽收（已簽過的不覆蓋，回現狀）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '已簽收（含本來就簽過）',
        content: { 'application/json': { schema: ParentContactBookEntrySchema } },
      },
      403: { description: '不是家長身分', content: { 'application/json': { schema: ErrorSchema } } },
      404: {
        description: '沒有這則，或不是自己孩子的',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(c.get('roles') ?? []).includes('parent')) {
      return c.json({ error: '不是家長身分', code: 'NOT_PARENT' }, 403);
    }
    const { id } = c.req.valid('param');
    const pool = getAuth(c).pool;
    if (!pool) return c.json({ error: '簽收失敗，請稍後再試', code: 'DB_POOL_UNAVAILABLE' }, 500);

    const childDb = c.get('childDb');
    let result: Awaited<ReturnType<typeof childDb.signContactBookEntry>>;
    try {
      result = await childDb.signContactBookEntry(pool, id, c.get('userId'));
    } catch (e) {
      console.error('[parent/contact-book] 簽收失敗:', e);
      return c.json({ error: '簽收失敗，請稍後再試', code: 'SIGN_FAILED' }, 500);
    }
    if (result === 'not-found') {
      return c.json({ error: '找不到這則聯絡簿', code: 'NOT_FOUND' }, 404);
    }

    const { data, error } = await childDb
      .from('contact_book_entries', 'student_id')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) {
      return c.json({ error: '簽收失敗，請稍後再試', code: 'SIGN_FAILED' }, 500);
    }
    return c.json(toEntry(data as unknown as Row), 200);
  },
);

export default app;
