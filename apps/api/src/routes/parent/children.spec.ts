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

  it('是家長時回 childDb 撈到的清單 —— 學校名從 `schools` embed 攤平出來', async () => {
    // DB 回的形狀是巢狀的（`schools(name)`），回應要攤平成 `school`
    const rows = [{ id: 's1', name: '王小明', grade: 'g1', schools: { name: '一小' } }];
    const app = appWith(['parent'], {
      from: (table: string, col: string) => {
        expect(table).toBe('students');
        expect(col).toBe('id');
        return { select: () => Promise.resolve({ data: rows, error: null }) };
      },
    });

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: [{ id: 's1', name: '王小明', grade: 'g1', school: '一小' }],
    });
  });

  it('沒有指定學校 → `school` 是 null，不是空字串', async () => {
    // `students.school_id` 是 nullable。回 `''` 會讓「沒設定」跟
    // 「學校叫做空字串」長得一樣，而畫面要決定的是「要不要顯示這一行」
    const app = appWith(['parent'], {
      from: () => ({
        select: () =>
          Promise.resolve({
            data: [{ id: 's1', name: '王小明', grade: 'g1', schools: null }],
            error: null,
          }),
      }),
    });

    const res = await app.request('/');
    expect(await res.json()).toEqual({
      data: [{ id: 's1', name: '王小明', grade: 'g1', school: null }],
    });
  });

  it('PostgREST 的巢狀關聯回陣列時也要處理', async () => {
    const app = appWith(['parent'], {
      from: () => ({
        select: () =>
          Promise.resolve({
            data: [{ id: 's1', name: '王小明', grade: 'g1', schools: [{ name: '一小' }] }],
            error: null,
          }),
      }),
    });

    const res = await app.request('/');
    expect(await res.json()).toEqual({
      data: [{ id: 's1', name: '王小明', grade: 'g1', school: '一小' }],
    });
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

/**
 * **`students.school` 這個欄位不存在** —— `20260421000003_seed_schools_from_students.sql:37`
 * 就把它 `DROP COLUMN` 了，取代它的是 `school_id` FK 指向 `schools`。
 *
 * 而這支端點一直 `select('id, name, grade, school')`，所以**對每一個家長、
 * 每一次呼叫都回 500**（PostgREST `42703: column students.school does not exist`，
 * 對本機 DB 實跑確認過）。
 *
 * ## 為什麼單元測試抓不到，而且不是加更多單元測試就會抓到
 *
 * 這支的替身回的是**它自己寫好的資料**，`select` 的字串長什麼樣它完全不管 ——
 * **「欄位存在」與「欄位不存在」在替身眼裡是同一件事**。所以這裡改測**送出去的
 * select 字串**：那是替身分不出對錯時唯一有辨識力的觀察點。
 *
 * ⚠️ 它仍然驗不到「這個 select 在真的 DB 上跑不跑得動」——**沒有任何單元測試做得到**。
 * 那一半只能靠真的打一次（見 PR 內文的實測紀錄）。
 */
describe('GET /api/me/children —— select 的欄位要真的存在', () => {
  function captureSelect() {
    const selects: string[] = [];
    const childDb = {
      from: () => ({
        select: (columns: string) => {
          selects.push(columns);
          return Promise.resolve({ data: [], error: null });
        },
      }),
    };
    return { childDb, selects };
  }

  it('⚠️ 不能 select 裸 `school` —— 那個欄位已經被 migration DROP 掉了', async () => {
    const { childDb, selects } = captureSelect();
    await appWith(['parent'], childDb).request('/');

    expect(selects).toHaveLength(1);
    // `school_id` / `schools(` 都含 "school" 這個字，所以要認的是**獨立的欄位名**
    expect(selects[0]).not.toMatch(/(^|,)\s*school\s*(,|$)/);
  });

  it('學校名走 `schools` 這個 embed 取 —— 取代 DROP 掉的那個欄位', async () => {
    const { childDb, selects } = captureSelect();
    await appWith(['parent'], childDb).request('/');

    expect(selects[0]).toMatch(/schools\s*\(/);
  });
});
