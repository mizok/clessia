import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import * as schoolsRoute from './schools';

const buildSchoolListQuery = (schoolsRoute as Record<string, unknown>)['buildSchoolListQuery'] as
  | ((params: { search?: string; isActive?: boolean }) => {
      searchFilter: string | null;
      isActiveFilter: boolean | null;
    })
  | undefined;

describe('buildSchoolListQuery', () => {
  it('returns nulls when no filters', () => {
    expect(buildSchoolListQuery?.({})).toEqual({
      searchFilter: null,
      isActiveFilter: null,
    });
  });

  it('builds search ilike with name + short_name', () => {
    expect(buildSchoolListQuery?.({ search: '明湖' })).toEqual({
      searchFilter: 'name.ilike.%明湖%,short_name.ilike.%明湖%',
      isActiveFilter: null,
    });
  });

  it('passes through isActive', () => {
    expect(buildSchoolListQuery?.({ isActive: true })).toEqual({
      searchFilter: null,
      isActiveFilter: true,
    });
  });
});

/**
 * **#837：學校的稽核 `details` 比分校好一點但仍不完整** ——
 * `update` 是 `details: payload`（**只有新值**），`create` / `delete` 是 `{}`。
 *
 * 只記新值的話，稽核答得出「現在是什麼」—— 而那查資料表就有答案。
 * 要問稽核的是**「原本是什麼」**。
 *
 * `delete` 這支跟分校不同：PostgREST 的 delete 會 returning 被刪掉的那一列，
 * 所以快照不必多查一次（`select('*')` 就夠）。
 */
describe('schools 的稽核 details（#837）', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  // ⚠️ 必須是合法 UUID —— 第一版寫 `…0000s1`，`s` 不是 hex，於是 zod 擋在 handler 之前
  // 而測到的是驗證器不是 details（這一輪第六次踩到 fixture）
  const SCHOOL = '00000000-0000-0000-0000-0000000000d1';
  const BEFORE = {
    id: SCHOOL,
    name: '大安國中',
    short_name: '大安',
    is_active: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };

  function fakeDb() {
    const auditRows: Array<Record<string, unknown>> = [];
    let mutated = false;
    let after: Record<string, unknown> = BEFORE;

    const make = (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder as never;
      Object.assign(builder, {
        select: () => chain(),
        eq: () => chain(),
        in: () => chain(),
        order: () => chain(),
        ilike: () => chain(),
        limit: () => chain(),
        insert: (rows: Record<string, unknown>) => {
          if (table === 'audit_logs') {
            auditRows.push(rows);
            return Promise.resolve({ error: null });
          }
          return chain();
        },
        update: (payload: Record<string, unknown>) => {
          mutated = true;
          after = { ...BEFORE, ...payload };
          return chain();
        },
        // delete 有 returning —— 回被刪掉的那一列
        delete: () => chain(),
        single: () =>
          Promise.resolve({
            data: table === 'schools' ? (mutated ? after : BEFORE) : null,
            error: null,
          }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: [], count: 0, error: null }),
      });

      return builder;
    };

    return { auditRows, from: (table: string) => make(table) };
  }

  async function request(path: string, method: string, body?: unknown) {
    const db = fakeDb();
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db);
      set('orgId', ORG);
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', schoolsRoute.default as unknown as Hono);

    const res = await app.request(path, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    });
    await Promise.resolve();
    await Promise.resolve();

    return { status: res.status, auditRows: db.auditRows };
  }

  it('改名：details 從「只有新值」變成有 from 與 to', async () => {
    // ⚠️ schools 的更新是 **PATCH** 不是 PUT（campuses 是 PUT）——
    // 從 campuses 複製測試時沒查，於是拿到 Hono 的 404 而它看起來像「找不到學校」
    const { auditRows } = await request(`/${SCHOOL}`, 'PATCH', { name: '大安高中' });

    const row = auditRows.find((r) => r['action'] === 'update');
    expect(row?.['details']).toEqual({
      fields: ['name'],
      from: { name: '大安國中' },
      to: { name: '大安高中' },
    });
  });

  it('刪除：details 是刪前快照（走 delete 的 returning，不多查一次）', async () => {
    const { auditRows } = await request(`/${SCHOOL}`, 'DELETE');

    const row = auditRows.find((r) => r['action'] === 'delete');
    expect(row?.['details']).toEqual({
      name: '大安國中',
      short_name: '大安',
      is_active: true,
    });
    expect(row?.['details']).not.toHaveProperty('created_at');
  });
});
