// scope-contract: GET /api/checkin-cards/students/:studentId
// scope-contract: POST /api/checkin-cards/:studentId/reissue
// scope-contract: POST /api/checkin-cards/:studentId/revoke
// scope-contract: POST /api/checkin-cards/print
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493：到班卡的讀、印、補發、作廢看分校範圍**（保留類：授權範圍；發放或收回身分憑證），
 * 對真的本機 PostgREST＋Postgres 跑。lib 層的範圍在 checkin-cards.contract.ts，這裡驗**路由**真的把範圍傳進去。
 *
 * 判準（studentWriteScope）：GET 範圍外 403、不在 org 404；print／reissue／revoke 範圍外跟不存在一樣 404、整批不動。
 * fixture：C1、C2；學生 sA（C1）、sX（C2）；sX 已有一張有效卡（作廢用）。管理員只被指派 C1。
 */

const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const DB = process.env['DATABASE_URL'];
if ((!URL || !KEY || !DB) && process.env['CONTRACT_REQUIRED']) {
  throw new Error(
    '[contract] CONTRACT_REQUIRED 但沒有 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY／DATABASE_URL',
  );
}
const run = URL && KEY && DB ? describe : describe.skip;

const pool = DB ? new Pool({ connectionString: DB }) : null;
afterAll(() => pool?.end());

const ctx = { orgId: '', userId: '', c1: '', campusScope: null as string[] | null };

vi.mock('../middleware/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../middleware/auth')>();
  const { createMiddleware } = await import('hono/factory');
  return {
    ...original,
    authMiddleware: createMiddleware(async (c, next) => {
      const supabase = createServiceClientFromEnv({
        SUPABASE_URL: URL!,
        SUPABASE_SECRET_KEY: KEY!,
      } as never);
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.campusScope);
      set('auth', {
        pool: {
          query: pool!.query.bind(pool),
          connect: pool!.connect.bind(pool),
          end: async () => {},
        },
      });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('#2493 到班卡看分校範圍', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { sA: '', sX: '' };
  const CODE = 'CK1-0123456789ABCDEF';

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#2493 契約：到班卡範圍')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '英文',
    ]);
    const klass: Record<string, string> = {};
    for (const key of ['c1', 'c2']) {
      const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
        ctx.orgId,
        key,
      ]);
      if (key === 'c1') ctx.c1 = campus;
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, `英文 ${key}`, subject],
      );
      klass[key] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus, course, `班 ${key}`],
      );
    }
    for (const [key, name] of [
      ['sA', '甲生'],
      ['sX', '乙生'],
    ] as const) {
      fx[key] = await one("insert into students (org_id, name, grade) values ($1, $2, 'J2')", [
        ctx.orgId,
        name,
      ]);
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, klass[key === 'sA' ? 'c1' : 'c2'], fx[key]],
      );
    }
    await q('insert into checkin_cards (org_id, student_id, code) values ($1, $2, $3)', [
      ctx.orgId,
      fx.sX,
      CODE,
    ]);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from checkin_cards where org_id = $1',
      'delete from enrollments where org_id = $1',
      'delete from students where org_id = $1',
      'delete from classes where org_id = $1',
      'delete from courses where org_id = $1',
      'delete from subjects where org_id = $1',
      'delete from campuses where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  type Scope = 'all' | 'c1' | 'none';
  const call = async (scope: Scope, method: string, path: string, body?: unknown) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [ctx.c1] : [];
    try {
      return await app.request(
        `/api/checkin-cards${path}`,
        {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env,
      );
    } finally {
      ctx.campusScope = null;
    }
  };
  const cards = async (studentId: string) =>
    q<{ revoked_at: string | null }>('select revoked_at from checkin_cards where student_id = $1', [
      studentId,
    ]);

  it('GET /students/:id：受限 C1 讀 C2 學生 403 且不洩漏；空範圍 403；C1 學生 200；不受限看得到 C2 的卡', async () => {
    const out = await call('c1', 'GET', `/students/${fx.sX}`);
    expect(out.status).toBe(403);
    expect(JSON.stringify(await out.json())).not.toContain('0123');
    expect((await call('none', 'GET', `/students/${fx.sA}`)).status).toBe(403);
    expect((await call('c1', 'GET', `/students/${fx.sA}`)).status).toBe(200);
    const all = await call('all', 'GET', `/students/${fx.sX}`);
    expect(all.status).toBe(200);
    expect(((await all.json()) as { hasAnyCard: boolean }).hasAnyCard).toBe(true);
  });

  it('POST /print：受限 C1 印 C2 學生 → 404、不開卡；整批含 C2 的也不動 C1 的；空範圍 404；C1 學生 200；不受限印得出 C2 的卡', async () => {
    const print = (scope: Scope, ids: string[]) =>
      call(scope, 'POST', '/print', { studentIds: ids });
    expect((await print('c1', [fx.sX])).status).toBe(404);
    expect((await print('c1', [fx.sA, fx.sX])).status).toBe(404);
    expect(await cards(fx.sA)).toHaveLength(0);
    expect((await print('none', [fx.sA])).status).toBe(404);
    expect(await cards(fx.sA)).toHaveLength(0);
    expect((await print('c1', [fx.sA])).status).toBe(200);
    expect(await cards(fx.sA)).toHaveLength(1);
    expect((await print('all', [fx.sX])).status).toBe(200);
  });

  it('POST /:id/reissue：受限 C1 補發 C2 學生 404、舊卡還有效；空範圍 404；C1 學生 200；不受限補發 C2', async () => {
    const reissue = (scope: Scope, id: string) =>
      call(scope, 'POST', `/${id}/reissue`, { reason: '契約' });
    expect((await reissue('c1', fx.sX)).status).toBe(404);
    expect(await cards(fx.sX)).toHaveLength(1);
    expect((await reissue('none', fx.sA)).status).toBe(404);
    expect((await reissue('c1', fx.sA)).status).toBe(200);
    expect(await cards(fx.sA)).toHaveLength(2);
    expect((await reissue('all', fx.sX)).status).toBe(200);
    expect(await cards(fx.sX)).toHaveLength(2);
  });

  it('POST /:id/revoke：受限 C1 作廢 C2 學生的卡 404、仍有效；空範圍 404；C1 學生 200；不受限作廢 C2', async () => {
    const revoke = (scope: Scope, id: string) =>
      call(scope, 'POST', `/${id}/revoke`, { reason: '契約' });
    const active = async (id: string) => (await cards(id)).filter((c) => !c.revoked_at).length;
    expect(await active(fx.sX)).toBe(1);
    expect((await revoke('c1', fx.sX)).status).toBe(404);
    expect(await active(fx.sX)).toBe(1);
    expect((await revoke('none', fx.sA)).status).toBe(404);
    expect(await active(fx.sA)).toBe(1);
    expect((await revoke('c1', fx.sA)).status).toBe(204);
    expect(await active(fx.sA)).toBe(0);
    expect((await revoke('all', fx.sX)).status).toBe(204);
    expect(await active(fx.sX)).toBe(0);
  });
});
