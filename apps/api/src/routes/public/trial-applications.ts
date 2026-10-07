import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../index';
import { isOpenClass, type Row } from '../../lib/catalog-class';
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
 * 公開試聽申請（#1124，免登入）。`specs/public/trial.md`。
 *
 * 同 #1123 寫進 `public_applications`（`kind='trial'`）—— 不寫 `trial_requests`（家長端表，要學生與帳號）。
 * 課程清單不另開端點：前端把公開目錄依課程分組。**課程要有至少一個公開開放中的班**
 * （同目錄的判準）—— 沒有開放班的課程試聽不了。試聽不佔名額，沒有候補。
 */

const CreateTrialSchema = z
  .object({
    ...ApplicantFields,
    courseIds: z.array(DbUuidSchema).min(1).max(10),
    /** 方便的時段（「週三晚上」） */
    preferredTimes: z.string().trim().max(100).optional(),
  })
  .openapi('PublicTrialApplicationInput');

const CreatedSchema = z.object({ id: DbUuidSchema }).openapi('PublicTrialApplicationCreated');

const app = new OpenAPIHono<AppEnv>();

// POST /api/public/trial-applications
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Public'],
    summary: '公開試聽申請（免登入；寫成待聯絡的申請，不建帳號）',
    request: { body: { content: { 'application/json': { schema: CreateTrialSchema } } } },
    responses: {
      201: { description: '已送出', content: { 'application/json': { schema: CreatedSchema } } },
      400: {
        description: '課程不開放／聯絡方式缺',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      429: {
        description: '送出太多次（#1126 rate limit）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      503: {
        description: '機器人驗證服務或限流計數暫時無法使用（fail-closed）',
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
    const guard = await guardSubmission(c, body, 'trial');
    // honeypot：回假成功、不寫 —— 不讓機器人知道被擋
    if (guard.kind === 'honeypot') return c.json({ id: crypto.randomUUID() }, 201);
    if (guard.kind === 'reject') {
      if (guard.status === 429) {
        c.header('Retry-After', String(guard.retryAfterSeconds));
        return c.json(guard.body, 429);
      }
      if (guard.status === 503) return c.json(guard.body, 503);
      return c.json(guard.body, 400);
    }

    if (!hasContact(body)) return c.json(EMAIL_OR_PHONE_REQUIRED, 400);

    const courseIds = [...new Set(body.courseIds)];
    const today = getCurrentTaipeiDateString();
    const { data: rows, error } = await supabase
      .from('classes')
      .select('id, course_id, is_active, end_date, courses(is_active)')
      .eq('org_id', orgId)
      .in('course_id', courseIds);
    if (error) return failed();
    const openCourses = new Set(
      ((rows ?? []) as Row[])
        .filter((row) => isOpenClass(row, today))
        .map((row) => row['course_id'] as string),
    );
    // 別 org、不存在、停用、沒有開放班 —— 都跟「沒有這門課」一樣回（不透露哪一種）
    if (courseIds.some((id) => !openCourses.has(id))) {
      return c.json(
        { error: '選的課程目前不開放試聽，請重新整理後再選', code: 'INVALID_COURSE' },
        400,
      );
    }

    const applicationId = await insertApplication(
      supabase,
      orgId,
      'trial',
      body,
      { preferred_times: body.preferredTimes || null, client_ip_hash: guard.ipHash },
      courseIds.map((courseId) => ({ course_id: courseId })),
    );
    if (!applicationId) return failed();

    return c.json({ id: applicationId }, 201);
  },
);

export default app;
