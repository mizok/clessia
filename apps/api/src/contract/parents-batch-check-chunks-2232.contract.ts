import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * #2232 ②：家長 Excel 匯入的預檢（`POST /parents/batch-check`）一次幾百列就 414，對真的本機 PostgREST 跑。
 *
 * 原本把全部姓名組成一串 `.or(name.ilike."…")` 放 URL，中文名 URL 編碼後一字 9 bytes，一百多列就 414 → 500；
 * 前端又把失敗吞成「沒有衝突」，重複檢查無聲消失（前端那半另由 parent-import-dialog spec 守）。
 * fixture：DB 裡兩位既有家長，名字跟匯入檔第 5、第 250 列相同；匯入檔 300 列、每個名字 30 字。
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

const N = 300;
const longName = (n: number) => `匯入測試家長${'很長的名字'.repeat(4)}第${n}號`;

run('家長匯入預檢 300 列（#2232 ②）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2232 契約：家長匯入 300 列') returning id",
      )
    )[0]!.id;
    // 既有家長借一個現成的帳號（c2：不寫 ba_*）
    const users = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'parent' order by user_id limit 2",
    );
    for (const [i, n] of [5, 250].entries()) {
      await q("insert into parents (org_id, name, user_id, status) values ($1, $2, $3, 'active')", [
        ctx.orgId,
        longName(n),
        users[i]!.user_id,
      ]);
    }
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from parents where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  it('300 列、每個名字 30 字：回 200，第 5、250 列（index 4、249）有同名警告', async () => {
    const rows = Array.from({ length: N }, (_, i) => ({ parentName: longName(i + 1) }));
    const res = await app.request(
      '/api/parents/batch-check',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows }),
      },
      env,
    );
    if (res.status !== 200) throw new Error(`${res.status} ${await res.text()}`);
    const body = (await res.json()) as { warnings: Array<{ rowIndex: number }> };
    expect([...new Set(body.warnings.map((w) => w.rowIndex))].sort((a, b) => a - b)).toEqual([
      4, 249,
    ]);
  });
});
