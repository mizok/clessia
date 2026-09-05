import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import childrenRoute from './children';

/**
 * 這支只測「角色擋不擋得住」與「childDb 的錯誤有沒有變成 500」——
 * 查詢本身的範圍限縮邏輯屬於 `lib/child-db.spec.ts`。
 */
function appWith(roles: string[], childDb: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('childDb', childDb);
    await next();
  });
  app.route('/', childrenRoute as unknown as Hono);
  return app;
}

describe('GET /api/me/children', () => {
  it('不是家長身分回 403', async () => {
    const app = appWith(['teacher'], {
      from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    });

    const res = await app.request('/');
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'NOT_PARENT' });
  });

  it('是家長時回 childDb 撈到的清單', async () => {
    const rows = [{ id: 's1', name: '王小明', grade: 'g1', school: '一小' }];
    const app = appWith(['parent'], {
      from: (table: string, col: string) => {
        expect(table).toBe('students');
        expect(col).toBe('id');
        return { select: () => Promise.resolve({ data: rows, error: null }) };
      },
    });

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: rows });
  });

  it('childDb 查詢失敗時回 500 而不是把 DB 錯誤吐給前端', async () => {
    const app = appWith(['parent'], {
      from: () => ({
        select: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      }),
    });

    const res = await app.request('/');
    expect(res.status).toBe(500);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: 'FETCH_CHILDREN_FAILED',
    });
  });
});
