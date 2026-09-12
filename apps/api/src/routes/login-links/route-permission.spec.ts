import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import loginLinksRoute from '../login-links';

/**
 * #464 的接線：**純函式對了不代表接上了。**
 *
 * `requiredPermissionsForTarget` 有自己的測試，但那不會發現 handler 根本沒呼叫它。
 * 這一組打真的 route，斷言「權限不足的呼叫端拿到 403」。
 */
describe('POST /api/login-links —— 依對象要求權限（#464）', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  const TARGET = 'target-user';

  /** 對象的角色由這個替身決定；`mint` 那一段永遠走不到（403 在它之前） */
  function fakeDb(targetRoles: string[]) {
    const make = (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder as never;
      Object.assign(builder, {
        select: () => chain(),
        eq: () => chain(),
        in: () => chain(),
        maybeSingle: () =>
          Promise.resolve({
            data: table === 'ba_user' ? { email: 'x@example.test', orgId: ORG } : null,
            error: null,
          }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({
            data: table === 'user_roles' ? targetRoles.map((role) => ({ role })) : [],
            error: null,
          }),
      });
      return builder;
    };
    return { from: (table: string) => make(table) };
  }

  async function post(callerPermissions: string[], targetRoles: string[]) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', fakeDb(targetRoles));
      set('orgId', ORG);
      set('userId', 'caller');
      set('roles', ['admin']);
      set('permissions', callerPermissions);
      set('campusScope', null);
      await next();
    });
    app.route('/', loginLinksRoute as unknown as Hono);

    return app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: TARGET }),
    });
  }

  it('只有 basic_operations 的行政不能替家長產生連結', async () => {
    const res = await post(['basic_operations'], ['parent']);

    expect(res.status).toBe(403);
  });

  it('只有 manage_students 的人不能替職員產生連結', async () => {
    const res = await post(['manage_students'], ['teacher']);

    expect(res.status).toBe(403);
  });

  /**
   * **反向對照 1**：權限對得上就不能被這一層擋掉。
   *
   * 斷言的是「**不是 403**」而不是 200 —— 後面還有 `mint` 要打真的 auth，
   * 那不在這一層的職責裡。**擋住這條的話就是守衛太嚴。**
   */
  it('有 manage_students 的人替家長產生連結時，不被權限層擋下', async () => {
    const res = await post(['manage_students'], ['parent']);

    expect(res.status).not.toBe(403);
  });

  /**
   * **反向對照 2**：`*` 通吃。bootstrap 建的第一個管理員拿的就是它，
   * 擋住他等於沒有人能用這支端點。
   */
  it('萬用權限 * 照樣可以', async () => {
    const res = await post(['*'], ['teacher', 'parent']);

    expect(res.status).not.toBe(403);
  });

  /**
   * **老師同時也是家長的對象要兩個權限都有**（`seed.sql` 的 `teacher0005` 就是）。
   * 只有一個的話擋下來 —— 失效方向選「太嚴」。
   */
  it('對象同時是老師與家長時，只有一個權限不夠', async () => {
    const res = await post(['manage_staff'], ['teacher', 'parent']);

    expect(res.status).toBe(403);
  });
});
