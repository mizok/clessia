import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../index';
import { getCampusScope, type CampusScope } from '../lib/campus-scope';
import { inOrg } from '../lib/org-scope';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';
import { waitUntilFrom } from '../lib/wait-until';

/**
 * 管理端：公開表單送進來的報名／試聽申請（#1245）。資料來源 `public_applications`（#1123／#1124）。
 *
 * - 掛 `manage_students`，**讀也擋**：這張表是陌生人的個資（家長電話、學生學校）。
 * - **分校範圍**：受限管理員只看得到「任一目標班／課程在自己範圍內」的申請；
 *   目標全被刪（`SET NULL`）的申請只有不受限的看得到。PATCH 用同一判準，範圍外跟不存在一樣 404。
 * - 狀態是聯絡流程，不是狀態機 —— 任意切換（誤標要改得回來）。**不做刪除**：垃圾送件標 `spam`。
 * - 「轉成正式」不在這裡：前端開既有的新增家長表單預填（rules/enrollment-rules.md 1.4：首次收款才建主資料）。
 */

const STATUSES = ['new', 'contacted', 'converted', 'rejected', 'spam'] as const;

const SELECT: string = `
  id, kind, status, parent_name, parent_email, parent_phone, parent_relation,
  student_name, student_grade, student_school, preferred_start_date, preferred_times,
  note, staff_note, created_at,
  public_application_targets(
    class_id, course_id, is_waitlist,
    classes(name, campus_id, campuses(name)),
    courses(name, campus_id, campuses(name))
  )
`;

const ApplicationSchema = z
  .object({
    id: DbUuidSchema,
    kind: z.enum(['enrollment', 'trial']),
    status: z.enum(STATUSES),
    createdAt: z.string(),
    parent: z.object({
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      relation: z.string(),
    }),
    student: z.object({ name: z.string(), grade: z.string(), school: z.string() }),
    preferredStartDate: z.string().nullable(),
    preferredTimes: z.string().nullable(),
    note: z.string().nullable(),
    staffNote: z.string().nullable(),
    targets: z.array(
      z.object({
        type: z.enum(['class', 'course']),
        /** 班或課程被刪了（SET NULL）→ null，`deleted: true` */
        name: z.string().nullable(),
        campusName: z.string().nullable(),
        isWaitlist: z.boolean(),
        deleted: z.boolean(),
      }),
    ),
  })
  .openapi('PublicApplication');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('PublicApplicationAdminError');

type Row = Record<string, any>;
const one = (v: unknown): Row | null => (Array.isArray(v) ? v[0] : v) ?? null;
const targetsOf = (row: Row): Row[] => {
  const t = row['public_application_targets'];
  return Array.isArray(t) ? t : t ? [t] : [];
};
/** 目標班／課程（嵌入的那一列） */
const targetEntity = (t: Row): Row | null => one(t['classes']) ?? one(t['courses']);

function visible(row: Row, scope: CampusScope): boolean {
  if (scope === null) return true;
  return targetsOf(row).some((t) => {
    const campusId = targetEntity(t)?.['campus_id'] as string | undefined;
    return !!campusId && scope.includes(campusId);
  });
}

function toResponse(row: Row) {
  return {
    id: row['id'] as string,
    kind: row['kind'] as 'enrollment' | 'trial',
    status: row['status'] as (typeof STATUSES)[number],
    createdAt: row['created_at'] as string,
    parent: {
      name: row['parent_name'] as string,
      email: (row['parent_email'] as string | null) ?? null,
      phone: (row['parent_phone'] as string | null) ?? null,
      relation: row['parent_relation'] as string,
    },
    student: {
      name: row['student_name'] as string,
      grade: row['student_grade'] as string,
      school: row['student_school'] as string,
    },
    preferredStartDate: (row['preferred_start_date'] as string | null) ?? null,
    preferredTimes: (row['preferred_times'] as string | null) ?? null,
    note: (row['note'] as string | null) ?? null,
    staffNote: (row['staff_note'] as string | null) ?? null,
    targets: targetsOf(row).map((t) => {
      const entity = targetEntity(t);
      return {
        // 班被刪後 class_id 是 null，但它原本是班 —— 從「是不是試聽申請」推不回來，所以看 course_id
        type: (t['course_id'] || one(t['courses']) ? 'course' : 'class') as 'class' | 'course',
        name: (entity?.['name'] as string | undefined) ?? null,
        campusName: (one(entity?.['campuses'])?.['name'] as string | undefined) ?? null,
        isWaitlist: t['is_waitlist'] === true,
        deleted: !entity,
      };
    }),
  };
}

const app = new OpenAPIHono<AppEnv>();

// GET /api/public-applications
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['PublicApplications'],
    summary: '公開申請列表（預設待處理：new＋contacted）',
    request: {
      query: z.object({
        /** 逗號分隔；預設 new,contacted */
        status: z.string().optional(),
        kind: z.enum(['enrollment', 'trial']).optional(),
      }),
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': { schema: z.object({ data: z.array(ApplicationSchema) }) },
        },
      },
      400: { description: '狀態不合法', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { status, kind } = c.req.valid('query');
    const statuses = (status ?? 'new,contacted').split(',').map((s) => s.trim());
    if (statuses.some((s) => !(STATUSES as readonly string[]).includes(s))) {
      return c.json({ error: '狀態不合法', code: 'INVALID_STATUS' }, 400);
    }

    // 直接 `.eq('org_id')` 不經 `inOrg`：這條 builder 交給 inOrg 的泛型推導會撞 TS2589（同 org-scope.ts:96）
    const { data, error } = await supabase
      .from('public_applications')
      .select(SELECT)
      .eq('org_id', orgId)
      .in('status', statuses)
      .order('created_at', { ascending: false });
    if (error) return c.json({ error: '讀取公開申請失敗', code: 'FETCH_FAILED' }, 500);

    // ponytail: 分校範圍在記憶體濾、不分頁 —— 待處理的申請一間補習班是個位數到幾十筆；
    // 量大了再把範圍下到查詢（要 !inner 兩條 embed）並加分頁
    const scope = getCampusScope(c);
    return c.json(
      {
        data: ((data ?? []) as Row[])
          .filter((row) => (!kind || row['kind'] === kind) && visible(row, scope))
          .map(toResponse),
      },
      200,
    );
  },
);

// PATCH /api/public-applications/:id
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['PublicApplications'],
    summary: '改公開申請的聯絡狀態／櫃檯備註',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              status: z.enum(STATUSES).optional(),
              staffNote: z.string().trim().max(1000).nullable().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ApplicationSchema }) } },
      },
      404: {
        description: '不存在或不在範圍內',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const notFound = () => c.json({ error: '找不到這筆申請', code: 'NOT_FOUND' }, 404);

    // 同 GET：直接 `.eq('org_id')`（inOrg 的泛型在這條 builder 上撞 TS2589）
    const { data: before } = await supabase
      .from('public_applications')
      .select(SELECT)
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (!before || !visible(before as Row, getCampusScope(c))) return notFound();

    const patch: Record<string, unknown> = {};
    if (body.status !== undefined) patch['status'] = body.status;
    if (body.staffNote !== undefined) patch['staff_note'] = body.staffNote || null;
    if (Object.keys(patch).length === 0) return c.json({ data: toResponse(before as Row) }, 200);

    const { error } = await inOrg(
      supabase.from('public_applications').update(patch).eq('id', id),
      orgId,
    );
    if (error) return c.json({ error: '更新失敗', code: 'UPDATE_FAILED' }, 500);

    const prev = before as Row;
    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'public_application',
        resourceId: id,
        resourceName: `${prev['student_name']}（${prev['parent_name']}）`,
        action: 'update',
        details: {
          before: { status: prev['status'], staffNote: prev['staff_note'] ?? null },
          after: {
            status: patch['status'] ?? prev['status'],
            staffNote: 'staff_note' in patch ? patch['staff_note'] : (prev['staff_note'] ?? null),
          },
        },
      },
      waitUntilFrom(c),
    );

    return c.json({ data: toResponse({ ...prev, ...patch }) }, 200);
  },
);

export default app;
