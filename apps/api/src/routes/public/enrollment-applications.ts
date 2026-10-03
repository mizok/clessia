import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../index';
import { isOpenClass, takenSeats, type Row } from '../../lib/catalog-class';
import { getCurrentTaipeiDateString } from '../../lib/taipei-date';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 公開報名送出（#1123，免登入）。`specs/public/enrollment.md`。
 *
 * 寫進 `public_applications`（未驗證的申請，計畫席 10-04 裁 A）—— **不建家長、學生、帳號**：
 * 那是首次收款時的事（rules/enrollment-rules.md 1.4），而且讓匿名請求建帳號是最大的濫用面。
 * 管理員在審核頁（#1245）聯絡過才走既有的建檔與報名流程。
 *
 * **班與額滿一律伺服器判定**：班要是部署 org 的、開放中的（同公開目錄），任一不符整筆不寫；
 * 額滿（同目錄的名額算法）的那幾班記成候補（使用者 10-03 裁）。
 *
 * 防濫用（Turnstile／rate limit／honeypot）在 #1126；正式環境 `PUBLIC_ORG_SLUG` 沒設之前這支是關著的。
 */

const GRADES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J2', 'J3', 'S1', 'S2', 'S3'] as const;

/** 台灣手機：去掉空白與連字號後是 09 開頭 10 碼 */
const MobileSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^09\d{8}$/, '手機號碼格式不正確'));

const text = (max: number) => z.string().trim().min(1).max(max);

const CreateApplicationSchema = z
  .object({
    parent: z.object({
      name: text(50),
      email: z.string().trim().email().max(254).optional(),
      phone: MobileSchema.optional(),
      relation: z.enum(['father', 'mother', 'other']),
    }),
    student: z.object({
      name: text(50),
      grade: z.enum(GRADES),
      school: text(100),
    }),
    classIds: z.array(DbUuidSchema).min(1).max(10),
    preferredStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    note: z.string().trim().max(500).optional(),
    /** 個資同意；沒勾不收 */
    consent: z.literal(true),
  })
  .openapi('PublicEnrollmentApplicationInput');

const CreatedSchema = z
  .object({
    id: DbUuidSchema,
    /** 送出當下額滿、記成候補的班 —— 成功頁要講清楚 */
    waitlistClassIds: z.array(DbUuidSchema),
  })
  .openapi('PublicEnrollmentApplicationCreated');
const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('PublicApplicationError');

const app = new OpenAPIHono<AppEnv>();

// POST /api/public/enrollment-applications
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Public'],
    summary: '公開報名送出（免登入；寫成待聯絡的申請，不建帳號）',
    request: { body: { content: { 'application/json': { schema: CreateApplicationSchema } } } },
    responses: {
      201: { description: '已送出', content: { 'application/json': { schema: CreatedSchema } } },
      400: {
        description: '班不開放／聯絡方式缺',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: '這個部署沒有開放公開頁',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');
    const failed = () => c.json({ error: '送出失敗，請稍後再試', code: 'SUBMIT_FAILED' }, 500);

    if (!body.parent.email && !body.parent.phone) {
      return c.json({ error: 'Email 或手機號碼至少填一個', code: 'EMAIL_OR_PHONE_REQUIRED' }, 400);
    }

    const classIds = [...new Set(body.classIds)];
    const today = getCurrentTaipeiDateString();
    const { data: rows, error } = await supabase
      .from('classes')
      .select('id, max_students, is_active, end_date, courses(is_active)')
      .eq('org_id', orgId)
      .in('id', classIds);
    if (error) return failed();
    const open = new Map(
      ((rows ?? []) as Row[])
        .filter((row) => isOpenClass(row, today))
        .map((row) => [row['id'] as string, row]),
    );
    // 別 org、不存在、停用、已結束、課程停用 —— 都跟「沒有這個班」一樣回（不透露哪一種）
    if (classIds.some((cid) => !open.has(cid))) {
      return c.json(
        { error: '選的班目前不開放報名，請重新整理後再選', code: 'INVALID_CLASS' },
        400,
      );
    }

    const { taken, error: countError } = await takenSeats(supabase, orgId, classIds);
    if (countError) return failed();
    const isFull = (cid: string) =>
      (taken.get(cid) ?? 0) >= (open.get(cid)!['max_students'] as number);

    const { data: created, error: insertError } = await supabase
      .from('public_applications')
      .insert({
        org_id: orgId,
        kind: 'enrollment',
        parent_name: body.parent.name,
        parent_email: body.parent.email ?? null,
        parent_phone: body.parent.phone ?? null,
        parent_relation: body.parent.relation,
        student_name: body.student.name,
        student_grade: body.student.grade,
        student_school: body.student.school,
        preferred_start_date: body.preferredStartDate ?? null,
        note: body.note || null,
        consented_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (insertError || !created) return failed();
    const applicationId = (created as { id: string }).id;

    const { error: targetsError } = await supabase.from('public_application_targets').insert(
      classIds.map((cid) => ({
        application_id: applicationId,
        class_id: cid,
        is_waitlist: isFull(cid),
      })),
    );
    if (targetsError) {
      // 沒有班的申請沒有用 —— 把主列收回，讓對方重送（targets 會跟著 CASCADE）
      await supabase
        .from('public_applications')
        .delete()
        .eq('id', applicationId)
        .eq('org_id', orgId);
      return failed();
    }

    return c.json({ id: applicationId, waitlistClassIds: classIds.filter(isFull) }, 201);
  },
);

export default app;
