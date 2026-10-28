import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * #2053「沒有有效到班卡」篩選，對真的本機 PostgREST 跑 —— 條件是 embed 的反連接
 * （`active_card.revoked_at=is.null` ＋ `active_card=is.null`），年級章節是 12 支帶同一個反連接的
 * HEAD count。替身不解析 embed 的過濾，量不到。
 *
 * 自建一個 org、三位國一學生：沒發過卡、有一張有效卡、只有作廢的卡。篩選要回第一和第三位。
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

const ctx = { orgId: '', userId: '' };

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
      set('campusScope', null);
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('學生列表「沒有有效到班卡」篩選（#2053）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { none: '', active: '', revoked: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2053 契約：沒有有效到班卡') returning id",
      )
    )[0]!.id;
    const student = async (name: string) =>
      (
        await q<{ id: string }>(
          "insert into students (org_id, name, grade) values ($1, $2, 'J1') returning id",
          [ctx.orgId, name],
        )
      )[0]!.id;
    fx.none = await student('沒發過卡');
    fx.active = await student('有效卡');
    fx.revoked = await student('只有作廢的卡');
    await q(
      `insert into checkin_cards (org_id, student_id, code) values ($1, $2, 'CK1-AAAAAAAAAAAAAAAA')`,
      [ctx.orgId, fx.active],
    );
    await q(
      `insert into checkin_cards (org_id, student_id, code, revoked_at, revoke_reason)
       values ($1, $2, 'CK1-BBBBBBBBBBBBBBBB', now(), '遺失')`,
      [ctx.orgId, fx.revoked],
    );
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from checkin_cards where org_id = $1',
      'delete from students where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  type List = {
    data: Array<{ id: string; hasActiveCard: boolean }>;
    summary: { total: number; byGrade: Array<{ grade: string; count: number }> };
    meta: { total: number };
  };
  const list = async (query: string) => {
    const res = await app.request(`/api/students?withToday=false&pageSize=100${query}`, {}, env);
    expect(res.status).toBe(200);
    return (await res.json()) as List;
  };
  const j1 = (body: List) => body.summary.byGrade.find((g) => g.grade === 'J1')?.count;

  it('每列帶 hasActiveCard：只有有效卡那位是 true（作廢的不算）', async () => {
    const all = await list('');
    const flag = new Map(all.data.map((s) => [s.id, s.hasActiveCard]));
    expect(flag.get(fx.none)).toBe(false);
    expect(flag.get(fx.active)).toBe(true);
    expect(flag.get(fx.revoked)).toBe(false);
    expect(j1(all)).toBe(3);
  });

  it('篩選：回沒發過卡與只有作廢卡的兩位；總數與年級章節（12 支 head count）都是 2', async () => {
    const without = await list('&withoutCard=true');
    expect(new Set(without.data.map((s) => s.id))).toEqual(new Set([fx.none, fx.revoked]));
    expect(without.meta.total).toBe(2);
    expect(j1(without)).toBe(2);
    expect(without.summary.byGrade.reduce((n, g) => n + g.count, 0)).toBe(2);
  });

  it('篩選跟其他條件是交集：再加年級 P1 → 0 位', async () => {
    const none = await list('&withoutCard=true&grade=P1');
    expect(none.data).toEqual([]);
  });
});
