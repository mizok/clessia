import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

import type { AppEnv } from '../index';
import { getCampusScope } from '../lib/campus-scope';
import { findInOrg } from '../lib/org-scope';
import { DbUuidSchema } from '../lib/validation';
import { outOfCampusScope, teacherCannotRead } from './students/read-scope';

/**
 * 聯絡紀錄（#1314 D2）：儀表板「該到沒到」的打電話、學生檔案的打電話／傳 LINE 都記一筆。
 *
 * **獨立 mount 而不是 `/students/{id}/contacts`**：`/api/students/*` 整段寫入吃 `manage_students`，
 * 而聯絡紀錄要「`basic_operations` 或 `manage_students` 任一」（櫃台要能記），掛在學生底下一定先被擋
 *（計畫席 10-10 裁 A）。授權仍跟學生單筆同一套（`students/read-scope.ts`）。
 *
 * 只增不改不刪（v1）：記錯就再記一筆更正。不另寫稽核 —— 這張表本身就是紀錄。
 */

const ChannelSchema = z.enum(['phone', 'line', 'other']).openapi('ContactChannel');

const ContactLogSchema = z
  .object({
    id: DbUuidSchema,
    studentId: DbUuidSchema,
    channel: ChannelSchema,
    note: z.string().nullable(),
    parentId: DbUuidSchema.nullable(),
    parentName: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdByName: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('ContactLog');

const ErrorSchema = z.object({ error: z.string(), code: z.string().optional() });

const SELECT =
  'id, student_id, channel, note, parent_id, created_by, created_at, parents(name), creator:ba_user!created_by(name)';

type Row = Record<string, unknown>;

function toContactLog(row: Row): z.infer<typeof ContactLogSchema> {
  return {
    id: row['id'] as string,
    studentId: row['student_id'] as string,
    channel: row['channel'] as z.infer<typeof ChannelSchema>,
    note: (row['note'] as string | null) ?? null,
    parentId: (row['parent_id'] as string | null) ?? null,
    parentName: ((row['parents'] as Row | null)?.['name'] as string | undefined) ?? null,
    createdBy: (row['created_by'] as string | null) ?? null,
    createdByName: ((row['creator'] as Row | null)?.['name'] as string | undefined) ?? null,
    createdAt: row['created_at'] as string,
  };
}

/** 授權同 `GET /students/{id}`：org → 分校範圍（#1394，範圍外 404）→ 老師只碰任課學生（#1098，403） */
async function denyStudent(c: Context<AppEnv>, studentId: string): Promise<Response | null> {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  if (
    !(await findInOrg(supabase, 'students', orgId, studentId)) ||
    (await outOfCampusScope(supabase, orgId, studentId, getCampusScope(c)))
  ) {
    return c.json({ error: '學生不存在', code: 'STUDENT_NOT_FOUND' }, 404);
  }
  if (await teacherCannotRead(supabase, orgId, c.get('userId'), c.get('roles') ?? [], studentId)) {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }
  return null;
}

const app = new OpenAPIHono<AppEnv>();

app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['ContactLogs'],
    summary: '一個學生的聯絡紀錄（新到舊）',
    request: {
      query: z.object({
        studentId: DbUuidSchema,
        limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
      }),
    },
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: z.object({ data: z.array(ContactLogSchema) }) } },
      },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: '學生不存在', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '查詢失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { studentId, limit = 50 } = c.req.valid('query');
    const denied = await denyStudent(c, studentId);
    if (denied) return denied as never;

    const { data, error } = await c
      .get('supabase')
      .from('contact_logs')
      .select(SELECT)
      .eq('org_id', c.get('orgId'))
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (error) return c.json({ error: '讀取聯絡紀錄失敗', code: 'LIST_FAILED' }, 500);

    return c.json({ data: ((data ?? []) as unknown as Row[]).map(toContactLog) }, 200);
  },
);

app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['ContactLogs'],
    summary: '記一筆聯絡',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              studentId: DbUuidSchema,
              channel: ChannelSchema,
              /** 打給哪位家長；必須是這個學生的家長 */
              parentId: DbUuidSchema.optional(),
              note: z.string().trim().max(500).optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: '已記錄',
        content: { 'application/json': { schema: z.object({ data: ContactLogSchema }) } },
      },
      403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
      404: {
        description: '學生或家長不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '寫入失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    const denied = await denyStudent(c, body.studentId);
    if (denied) return denied as never;

    // 家長要是**這個學生的**家長（且在本 org）—— 不然紀錄會掛到別人家的家長身上
    if (body.parentId) {
      const { data: relation } = await supabase
        .from('parent_student_relations')
        .select('parent_id, parents!inner(org_id)')
        .eq('student_id', body.studentId)
        .eq('parent_id', body.parentId)
        .eq('parents.org_id', orgId)
        .maybeSingle();
      if (!relation) return c.json({ error: '家長不存在', code: 'PARENT_NOT_FOUND' }, 404);
    }

    const { data, error } = await supabase
      .from('contact_logs')
      .insert({
        org_id: orgId,
        student_id: body.studentId,
        parent_id: body.parentId ?? null,
        channel: body.channel,
        note: body.note ? body.note : null,
        created_by: c.get('userId'),
      })
      .select(SELECT)
      .single();
    if (error || !data) return c.json({ error: '記錄聯絡失敗', code: 'CREATE_FAILED' }, 500);

    return c.json({ data: toContactLog(data as unknown as Row) }, 201);
  },
);

export default app;
