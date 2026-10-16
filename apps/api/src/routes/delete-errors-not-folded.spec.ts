import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import studentsRoute from './students';

/**
 * #1651：刪除失敗不能折成「看起來正常」的回應。
 * - 學生被帳單／成績的 FK RESTRICT 擋下 → 409，不是 404「學生不存在」（學生明明在畫面上）
 * - 學生刪除的其他 DB 錯誤 → 500；真的查無（PGRST116）才 404
 * - 班級批次刪除 DB 錯誤 → 500：#1652 起走 pg 交易，守在 `classes.spec.ts` 的「交易結果 → HTTP」
 */

const ID = '00000000-0000-0000-0000-000000000001';

type Result = { data?: unknown; error: { code?: string; message: string } | null; count?: number };

/** 每張表、每種操作（select / delete）一個固定結果；鏈上任何方法都回自己 */
function fakeDb(results: Record<string, Result>) {
  const from = (table: string) => {
    let op = 'select';
    const done = () => Promise.resolve(results[`${op} ${table}`] ?? { data: [], error: null });
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'or', 'order']) builder[m] = () => builder;
    builder['delete'] = () => ((op = 'delete'), builder);
    builder['insert'] = () => Promise.resolve({ error: null }); // logAudit
    builder['single'] = done;
    builder['maybeSingle'] = done;
    builder['then'] = (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) =>
      done().then(ok, ng);
    return builder;
  };
  return { from };
}

async function call(route: unknown, path: string, db: unknown, body?: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db);
    set('orgId', 'org-1');
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', []);
    set('campusScope', null);
    await next();
  });
  app.route('/', route as Hono);
  const res = await app.request(path, {
    method: 'DELETE',
    ...(body
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('DELETE /api/students/:id —— 刪除失敗不折成 404（#1651）', () => {
  const studentDelete = (r: Result) =>
    call(
      studentsRoute,
      `/${ID}`,
      fakeDb({ 'select enrollments': { count: 0, error: null }, 'delete students': r }),
    );

  it('FK 違反（有帳單或成績）→ 409 IN_USE', async () => {
    const res = await studentDelete({
      data: null,
      error: { code: '23503', message: 'violates foreign key constraint' },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'IN_USE' });
  });

  it('其他 DB 錯誤 → 500', async () => {
    const res = await studentDelete({ data: null, error: { code: '08006', message: 'boom' } });
    expect(res.status).toBe(500);
  });

  it('真的查無 → 404', async () => {
    const res = await studentDelete({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });
    expect(res.status).toBe(404);
  });

  it('成功 → 200', async () => {
    const res = await studentDelete({ data: { id: ID }, error: null });
    expect(res.status).toBe(200);
  });
});
