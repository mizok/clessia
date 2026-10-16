import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppEnv } from '../index';
import meRoute from './me';

/**
 * #1595 P2a：GET /api/me 原本自己查 5 支（其中 user_roles 跟 auth middleware 完全重複，
 * staff／parents 也是 middleware 剛查過的那幾列）。現在角色、權限、staff／parents
 * 都從 middleware 放進 context 的值拿，只剩 profiles、ba_user 兩支。
 */
describe('GET /api/me —— 查詢次數（#1595 P2a）', () => {
  function fakeSupabase(queried: string[]) {
    return {
      from(table: string) {
        queried.push(table);
        const row =
          table === 'ba_user' ? { name: 'ba 名', email: 'a@example.com', phone: '0912' } : null;
        const builder: Record<string, unknown> = {};
        Object.assign(builder, {
          select: () => builder,
          eq: () => builder,
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
          single: () => Promise.resolve({ data: row, error: null }),
        });
        return builder;
      },
    };
  }

  function appWith(queried: string[], selfRows: AppEnv['Variables']['selfRows']) {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('userId', 'u1');
      c.set('orgId', 'o1');
      c.set('roles', ['admin', 'teacher']);
      c.set('permissions', ['manage_students']);
      c.set('selfRows', selfRows);
      c.set('supabase', fakeSupabase(queried) as never);
      c.set('auth', {} as never); // 沒有 pool → 走 REST 那條（SQL 那條由 identity-sql spec 守）
      await next();
    });
    app.route('/api/me', meRoute);
    return app;
  }

  it('只查 profiles 與 ba_user；角色、權限、名稱、生日來自 middleware', async () => {
    const queried: string[] = [];
    const res = await appWith(queried, {
      staff: { display_name: '王主任', birthday: '1990-01-02', nickname: '王老師' },
      parent: null,
      assignedCampusIds: [],
    }).request('/api/me');

    expect(res.status).toBe(200);
    expect(queried.sort()).toEqual(['ba_user', 'profiles']);
    expect(await res.json()).toMatchObject({
      displayName: '王主任',
      birthday: '1990-01-02',
      nickname: '王老師',
      email: 'a@example.com',
      phone: '0912',
      roles: ['admin', 'teacher'],
      permissions: ['manage_students'],
    });
  });

  it('家長：名稱用 parents.name；沒有 staff 列時生日是 null', async () => {
    const res = await appWith([], {
      staff: null,
      parent: { name: '林媽媽' },
      assignedCampusIds: [],
    }).request('/api/me');
    expect(await res.json()).toMatchObject({
      displayName: '林媽媽',
      birthday: null,
      nickname: null,
    });
  });

  // #1607：前端挑預設分校用。值就是 middleware 算 campusScope 的那份，不另查
  it('assignedCampusIds 原樣回 middleware 的值，不多查任何表', async () => {
    const queried: string[] = [];
    const res = await appWith(queried, {
      staff: { display_name: '王主任' },
      parent: null,
      assignedCampusIds: ['c2', 'c1'],
    }).request('/api/me');
    expect(queried.sort()).toEqual(['ba_user', 'profiles']);
    expect(await res.json()).toMatchObject({ assignedCampusIds: ['c2', 'c1'] });
  });
});
