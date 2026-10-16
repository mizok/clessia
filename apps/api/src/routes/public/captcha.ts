import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../index';
import { captchaProvider, createAltchaChallenge } from './application-common';

/**
 * 公開表單的機器人驗證設定（#1665，免登入）。表單一打開先打這支：
 * - `altcha`（預設）：回一道新題目，前端交給 `<altcha-widget>` 算，算完的 payload 放進 `captchaToken`
 * - `turnstile`：回 site key，前端掛 Turnstile widget
 * 題目每次都是新的、會過期，所以不給快取。
 */

const ResponseSchema = z
  .discriminatedUnion('provider', [
    z.object({
      provider: z.literal('altcha'),
      challenge: z.object({
        parameters: z.record(z.string(), z.unknown()),
        signature: z.string().optional(),
      }),
    }),
    z.object({ provider: z.literal('turnstile'), siteKey: z.string() }),
  ])
  .openapi('PublicCaptchaResponse');
const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('PublicCaptchaError');

const app = new OpenAPIHono<AppEnv>();

// GET /api/public/captcha
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Public'],
    summary: '公開表單的機器人驗證（ALTCHA 題目或 Turnstile site key）',
    responses: {
      200: { description: '成功', content: { 'application/json': { schema: ResponseSchema } } },
      404: {
        description: '這個部署沒有開放公開頁（PUBLIC_ORG_SLUG 未設定）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      503: {
        description: '驗證設定不完整（不認得的 CAPTCHA_PROVIDER，或 turnstile 缺金鑰）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    c.header('Cache-Control', 'no-store');
    const unavailable = () =>
      c.json({ error: '驗證服務暫時無法使用，請稍後再試', code: 'CAPTCHA_UNAVAILABLE' }, 503);
    const provider = captchaProvider(c);
    if (provider === 'altcha') {
      const { parameters, signature } = await createAltchaChallenge(c);
      return c.json({ provider, challenge: { parameters: { ...parameters }, signature } }, 200);
    }
    const siteKey = c.env.TURNSTILE_SITE_KEY?.trim();
    if (provider === 'turnstile' && siteKey && c.env.TURNSTILE_SECRET_KEY?.trim()) {
      return c.json({ provider, siteKey }, 200);
    }
    return unavailable();
  },
);

export default app;
