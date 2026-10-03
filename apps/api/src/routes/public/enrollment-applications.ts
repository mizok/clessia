import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../index';
import { isOpenClass, takenSeats, type Row } from '../../lib/catalog-class';
import { getCurrentTaipeiDateString } from '../../lib/taipei-date';
import { DbUuidSchema } from '../../lib/validation';
import {
  ApplicantFields,
  ApplicationErrorSchema as ErrorSchema,
  EMAIL_OR_PHONE_REQUIRED,
  guardSubmission,
  hasContact,
  insertApplication,
} from './application-common';

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

const CreateApplicationSchema = z
  .object({
    ...ApplicantFields,
    classIds: z.array(DbUuidSchema).min(1).max(10),
    preferredStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .openapi('PublicEnrollmentApplicationInput');

const CreatedSchema = z
  .object({
    id: DbUuidSchema,
    /** 送出當下額滿、記成候補的班 —— 成功頁要講清楚 */
    waitlistClassIds: z.array(DbUuidSchema),
  })
  .openapi('PublicEnrollmentApplicationCreated');

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
      429: {
        description: '送出太多次（#1126 rate limit）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      503: {
        description: '機器人驗證服務暫時無法使用（fail-closed）',
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

    // #1126：honeypot → rate limit → CAPTCHA，都過了才走原本的驗證
    const guard = await guardSubmission(c, body, 'enrollment');
    // honeypot：回假成功、不寫 —— 不讓機器人知道被擋
    if (guard.kind === 'honeypot')
      return c.json({ id: crypto.randomUUID(), waitlistClassIds: [] }, 201);
    if (guard.kind === 'reject') {
      if (guard.status === 429) {
        c.header('Retry-After', String(guard.retryAfterSeconds));
        return c.json(guard.body, 429);
      }
      if (guard.status === 503) return c.json(guard.body, 503);
      return c.json(guard.body, 400);
    }

    if (!hasContact(body)) return c.json(EMAIL_OR_PHONE_REQUIRED, 400);

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

    const applicationId = await insertApplication(
      supabase,
      orgId,
      'enrollment',
      body,
      { preferred_start_date: body.preferredStartDate ?? null, client_ip_hash: guard.ipHash },
      classIds.map((cid) => ({ class_id: cid, is_waitlist: isFull(cid) })),
    );
    if (!applicationId) return failed();

    return c.json({ id: applicationId, waitlistClassIds: classIds.filter(isFull) }, 201);
  },
);

export default app;
