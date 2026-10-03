import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../index';
import { createServiceClientFromEnv } from './supabase';

/**
 * 公開端點（免登入，#1125／#1123／#1124）的 org：**從部署設定 `PUBLIC_ORG_SLUG` 來，不從網址來**。
 *
 * c12 下一個部署＝一個客戶，org 本來就是部署的屬性。從網址帶 slug 在單租戶下是冗餘的，
 * 還會讓同一個 DB 裡的其他 org 列（demo、測試用）可以被外面點名。
 *
 * **沒設、或對不到任何 org → 404 `PUBLIC_DISABLED`**（fail-closed）：沒準備好招生的客戶不會不小心開著。
 *
 * 掛在 `index.ts` 的 `authMiddleware` **之前**；它沒跑過，所以這裡自己建 service client。
 * 已經有人設好 `supabase`（測試替身）就沿用。
 */
export const publicOrgMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const supabase = c.get('supabase') ?? createServiceClientFromEnv(c.env);
  const slug = c.env?.PUBLIC_ORG_SLUG?.trim();
  if (!slug) return c.json({ error: '公開頁未開放', code: 'PUBLIC_DISABLED' }, 404);

  const { data } = await supabase.from('organizations').select('id').eq('slug', slug).maybeSingle();
  if (!data) return c.json({ error: '公開頁未開放', code: 'PUBLIC_DISABLED' }, 404);

  c.set('supabase', supabase);
  c.set('orgId', data.id as string);
  await next();
  return undefined;
};
