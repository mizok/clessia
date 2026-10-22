import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1845：`POST /api/students` 帶 `parentId`（家長頁「新增孩子」）原本直接插關聯 ——
 * 沒驗家長屬於本 org、沒驗受限管理員的範圍，插入失敗還被吞掉照回 201。
 * 現在：別 org／不存在 404、範圍外 403，都在寫入之前；學生＋關聯一個交易。
 */
const pg = { sent: [] as string[], throwOn: null as RegExp | null };
const answer = (sql: string) => {
  pg.sent.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
  if (pg.throwOn?.test(sql)) throw new Error('pg boom');
  return /^\s*INSERT INTO students/.test(sql) ? [{ id: 'new-student' }] : [];
};
vi.mock('../lib/get-auth', () => ({
  getAuth: () => ({
    pool: {
      connect: async () => ({
        query: async (sql: string) => ({ rows: answer(sql) }),
        release: () => undefined,
      }),
    },
  }),
}));

import studentsRoute from './students';

const PARENT = '11111111-1111-4111-8111-111111111111';
const ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  org_id: '33333333-3333-4333-8333-333333333333',
  name: '林小華',
  grade: 'J1',
  schools: null,
  is_active: true,
  created_at: '2026-10-22T00:00:00Z',
  updated_at: '2026-10-22T00:00:00Z',
};

function setup(opts: { parentInOrg?: boolean; scopedParents?: string[] } = {}) {
  const writes: string[] = [];
  const supabase = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder as never;
      Object.assign(builder, {
        select: () => chain(),
        eq: () => chain(),
        in: () => chain(),
        order: () => chain(),
        range: () => chain(),
        insert: () => (writes.push(`insert ${table}`), chain()),
        maybeSingle: () =>
          Promise.resolve({
            data: table === 'parents' && opts.parentInOrg !== false ? { id: PARENT } : null,
            error: null,
          }),
        single: () => Promise.resolve({ data: table === 'students' ? ROW : null, error: null }),
        // resolveScopedParentIds 讀關聯表
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({
            data: (opts.scopedParents ?? []).map((parent_id) => ({ id: parent_id, parent_id })),
            error: null,
          }),
      });
      return builder;
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', supabase);
    set('orgId', 'org-1');
    set('userId', 'user-1');
    set('roles', ['admin']);
    set('campusScope', opts.scopedParents ? ['campus-1'] : null);
    await next();
  });
  app.route('/', studentsRoute as unknown as Hono);
  const create = (parentId?: string) =>
    app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '林小華', grade: 'J1', ...(parentId ? { parentId } : {}) }),
    });
  return { create, writes };
}

describe('POST /api/students 帶 parentId —— 驗家長、一個交易（#1845）', () => {
  beforeEach(() => Object.assign(pg, { sent: [], throwOn: null }));

  it('別 org／不存在的家長 → 404，什麼都沒寫', async () => {
    const { create, writes } = setup({ parentInOrg: false });
    const res = await create(PARENT);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('PARENT_NOT_FOUND');
    expect(writes).toEqual([]);
    expect(pg.sent).toEqual([]);
  });

  it('受限管理員：家長在範圍外 → 403，什麼都沒寫', async () => {
    const { create, writes } = setup({ scopedParents: ['someone-else'] });
    const res = await create(PARENT);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('PARENT_OUT_OF_SCOPE');
    expect(writes).toEqual([]);
    expect(pg.sent).toEqual([]);
  });

  it('受限管理員：家長在範圍內 → 201，學生與關聯在同一個交易', async () => {
    const { create, writes } = setup({ scopedParents: [PARENT] });
    const res = await create(PARENT);
    expect(res.status).toBe(201);
    expect(pg.sent).toEqual([
      'BEGIN',
      'INSERT INTO students',
      'INSERT INTO parent_student_relations',
      'COMMIT',
    ]);
    expect(writes).toEqual([]);
  });

  it('關聯插入失敗 → 500 並回滾（原本吞掉錯誤照回 201）', async () => {
    pg.throwOn = /INSERT INTO parent_student_relations/;
    const { create } = setup();
    const res = await create(PARENT);
    expect(res.status).toBe(500);
    expect(pg.sent).toContain('ROLLBACK');
    expect(pg.sent).not.toContain('COMMIT');
  });

  it('沒帶 parentId → 照舊走 PostgREST 建學生，不碰交易', async () => {
    const { create, writes } = setup();
    const res = await create();
    expect(res.status).toBe(201);
    expect(writes).toEqual(['insert students']);
    expect(pg.sent).toEqual([]);
  });
});
