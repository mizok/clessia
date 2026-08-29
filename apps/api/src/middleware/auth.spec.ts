import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { requirePermission, requireRoles } from './auth';

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

/**
 * 細部權限的准入。**在這支之前，API 完全沒有 permission 層** —— `permissions` 只經由
 * `/api/me` 回給前端，由 web 的 `permissionGuard` 擋。那是畫面控制不是授權：
 * 直接打 API 就繞過去了。金流是第一個真的需要它的地方（`manage_finance`）。
 *
 * 一律 fail-closed，理由同 requireRoles：授權的洞幾乎都長在「不確定的時候放行」上。
 */
function appWithPermissions(permissions: string[] | undefined, required: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('permissions', permissions);
    await next();
  });
  app.use('*', requirePermission(required));
  app.get('/', (c) => c.json({ ok: true }));
  return app;
}

describe('requirePermission', () => {
  it('有這個權限就放行', async () => {
    expect(
      (await appWithPermissions(['manage_finance'], 'manage_finance').request('/')).status,
    ).toBe(200);
  });

  // `*` 是萬用權限，bootstrap 建的第一個管理員拿的就是它（`user_roles.permissions = ["*"]`）。
  // web 的 `auth.hasPermission()` 也是這個規則 —— 兩邊不一致的話會出現「畫面看得到、
  // API 打不進去」。
  it('`*` 通吃', async () => {
    expect((await appWithPermissions(['*'], 'manage_finance').request('/')).status).toBe(200);
  });

  it('沒有這個權限回 403', async () => {
    const res = await appWithPermissions(['manage_staff'], 'manage_finance').request('/');

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('權限清單是空的就拒絕', async () => {
    expect((await appWithPermissions([], 'manage_finance').request('/')).status).toBe(403);
  });

  // 這條最重要：middleware 忘了把 permissions 放進 context 時，不能變成全開
  it('context 裡根本沒有 permissions 時拒絕，而不是當成全開', async () => {
    expect((await appWithPermissions(undefined, 'manage_finance').request('/')).status).toBe(403);
  });
});
