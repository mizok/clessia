import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { requireRoles } from './auth';

/**
 * 這組測試守的是「忘記宣告時該拒絕」。
 *
 * 這個洞當初長出來的方式就是：新增 route 時沒有人想到要限制角色，而預設是全開。
 * 見 kb/wiki/architecture/role-authorization.md
 */
function appWithRoles(roles: string[] | undefined, allowed: string[]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('roles', roles);
    await next();
  });
  app.use('*', requireRoles(...allowed));
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}

describe('requireRoles', () => {
  it('角色在允許清單裡就放行', async () => {
    const res = await appWithRoles(['teacher'], ['admin', 'teacher']).request('/');

    expect(res.status).toBe(200);
  });

  it('角色不在允許清單裡回 403', async () => {
    const res = await appWithRoles(['parent'], ['admin']).request('/');

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('多重角色只要命中一個就放行', async () => {
    const res = await appWithRoles(['parent', 'admin'], ['admin']).request('/');

    expect(res.status).toBe(200);
  });

  // 沒有任何角色的帳號（例如只建了 ba_user 沒建 user_roles）不該因此變成通行證
  it('沒有角色時拒絕', async () => {
    expect((await appWithRoles([], ['admin']).request('/')).status).toBe(403);
  });

  it('context 裡根本沒有 roles 時拒絕，而不是當成全開', async () => {
    expect((await appWithRoles(undefined, ['admin']).request('/')).status).toBe(403);
  });

  // 允許清單空的通常代表呼叫端寫錯了，這時放行是最糟的失敗方式
  it('允許清單是空的就全部拒絕', async () => {
    expect((await appWithRoles(['admin'], []).request('/')).status).toBe(403);
  });
});
