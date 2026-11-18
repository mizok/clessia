// scope-contract: POST /api/announcements
// scope-contract: GET /api/announcements
// scope-contract: GET /api/announcements/inbox
// scope-contract: POST /api/announcements/read-all
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 ?1：全部分校的公告只有不受限的管理員發得出去**（保留類：授權範圍），對真的本機 PostgREST 跑。
 *
 * `POST /api/announcements` 省略 `campusId`＝發給全部分校的老師或家長。原本只用 `isCampusAllowed` 驗，
 * 它對「沒帶」回 true（讀取端「不篩」的語意），所以只管一個分校的管理員發得出全機構公告。
 * 裁定（11-13）：受限者必須指名分校，省略回 403 `REQUIRES_ALL_CAMPUSES`（同 grade-promotions），什麼都不寫。
 *
 * fixture：C1、C2。管理員只被指派 C1。測完整個 org 刪掉。
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

const ctx: {
  orgId: string;
  userId: string;
  campusScope: string[] | null;
  activeRole: string;
} = {
  orgId: '',
  userId: '',
  campusScope: null,
  activeRole: 'admin',
};

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
      set('roles', [ctx.activeRole]);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', ctx.activeRole);
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.campusScope);
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('全部分校的公告只有不受限者發得出去（#2493 ?1）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { c1: '', c2: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2493 ?1 契約：公告分校') returning id",
      )
    )[0]!.id;
    for (const key of ['1', '2'] as const) {
      const [campus] = await q<{ id: string }>(
        'insert into campuses (org_id, name) values ($1, $2) returning id',
        [ctx.orgId, `c${key}`],
      );
      fx[`c${key}`] = campus!.id;
    }
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from announcement_reads where announcement_id in (select id from announcements where org_id = $1)',
      'delete from announcements where org_id = $1',
      'delete from notifications where org_id = $1',
      'delete from campuses where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  const post = async (scope: 'all' | 'c1' | 'none', title: string, campusId?: string) => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      const res = await app.request(
        '/api/announcements',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title,
            body: '契約測試',
            audience: 'all_teachers',
            ...(campusId ? { campusId } : {}),
          }),
        },
        env,
      );
      return { status: res.status, body: (await res.json()) as { code?: string } };
    } finally {
      ctx.campusScope = null;
    }
  };
  const stored = async (title: string) =>
    (
      await q<{ n: number }>(
        'select count(*)::int n from announcements where org_id = $1 and title = $2',
        [ctx.orgId, title],
      )
    )[0]!.n;

  it('受限 C1、沒指定分校（＝全部分校）：403 REQUIRES_ALL_CAMPUSES，沒有寫入', async () => {
    const r = await post('c1', '受限全部');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('REQUIRES_ALL_CAMPUSES');
    expect(await stored('受限全部')).toBe(0);
  });

  it('空範圍、沒指定分校：同上 403', async () => {
    const r = await post('none', '空範圍全部');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('REQUIRES_ALL_CAMPUSES');
    expect(await stored('空範圍全部')).toBe(0);
  });

  it('受限 C1、指定 C1：發得出去（防過度擋）', async () => {
    const r = await post('c1', '受限指定一校', fx.c1);
    expect(r.status).toBe(201);
    expect(await stored('受限指定一校')).toBe(1);
  });

  it('受限 C1、指定 C2：403（範圍外，原本就擋）', async () => {
    const r = await post('c1', '受限指定別校', fx.c2);
    expect(r.status).toBe(403);
    expect(await stored('受限指定別校')).toBe(0);
  });

  it('不受限、沒指定分校：照舊發給全部分校', async () => {
    const r = await post('all', '不受限全部');
    expect(r.status).toBe(201);
    expect(await stored('不受限全部')).toBe(1);
  });
  // ── 讀取端：管理端列表（campusScope）與收件匣／全部已讀（本人的 staff_campuses）──────────
  describe('讀取端與已讀', () => {
    const ids: Record<string, string> = {};
    const call = async (
      path: string,
      init: RequestInit,
      who: { role: string; scope: 'all' | 'c1' | 'none' },
    ) => {
      ctx.activeRole = who.role;
      ctx.campusScope = who.scope === 'all' ? null : who.scope === 'c1' ? [fx.c1] : [];
      try {
        const res = await app.request(path, init, env);
        return { status: res.status, body: (await res.json()) as Record<string, any> };
      } finally {
        ctx.activeRole = 'admin';
        ctx.campusScope = null;
      }
    };
    const titles = (r: { body: Record<string, any> }) =>
      (r.body['data'] as Array<{ title: string }>).map((a) => a.title).sort();
    const readTitles = async () =>
      (
        await q<{ title: string }>(
          `select a.title from announcement_reads r join announcements a on a.id = r.announcement_id
            where a.org_id = $1 and r.user_id = $2 order by a.title`,
          [ctx.orgId, ctx.userId],
        )
      ).map((r) => r.title);

    beforeAll(async () => {
      // 前面發布案例留下的公告清掉，這一組只看自己種的四則
      await q('delete from announcements where org_id = $1', [ctx.orgId]);
      const [staff] = await q<{ id: string }>(
        "insert into staff (org_id, user_id, display_name) values ($1, $2, '契約老師') returning id",
        [ctx.orgId, ctx.userId],
      );
      await q('insert into staff_campuses (staff_id, campus_id) values ($1, $2)', [
        staff!.id,
        fx.c1,
      ]);
      const seed: Array<[string, string, string | null]> = [
        ['T-C1', 'all_teachers', fx.c1],
        ['T-C2', 'all_teachers', fx.c2],
        ['T-ALL', 'all_teachers', null],
        ['P-C1', 'all_parents', fx.c1],
      ];
      for (const [title, audience, campus] of seed) {
        const [row] = await q<{ id: string }>(
          `insert into announcements (org_id, title, body, audience, campus_id, created_by)
           values ($1, $2, 'x', $3, $4, $5) returning id`,
          [ctx.orgId, title, audience, campus, ctx.userId],
        );
        ids[title] = row!.id;
      }
    }, 120_000);

    afterAll(async () => {
      await q(
        'delete from announcement_reads where announcement_id in (select id from announcements where org_id = $1)',
        [ctx.orgId],
      );
      await q(
        'delete from staff_campuses where staff_id in (select id from staff where org_id = $1)',
        [ctx.orgId],
      );
      await q('delete from staff where org_id = $1', [ctx.orgId]);
    });

    it('GET 列表：受限 C1 看到 C1＋全分校，看不到 C2', async () => {
      const r = await call('/api/announcements', { method: 'GET' }, { role: 'admin', scope: 'c1' });
      expect(r.status).toBe(200);
      const t = titles(r).filter((x) => /^[TP]-/.test(x));
      expect(t).toEqual(['P-C1', 'T-ALL', 'T-C1']);
    });

    it('GET 列表：受限 C1 指名 C2（範圍外）→ 403', async () => {
      const r = await call(
        `/api/announcements?campusId=${fx.c2}`,
        { method: 'GET' },
        { role: 'admin', scope: 'c1' },
      );
      expect(r.status).toBe(403);
    });

    it('GET 列表：空範圍只看得到全分校公告', async () => {
      const r = await call(
        '/api/announcements',
        { method: 'GET' },
        { role: 'admin', scope: 'none' },
      );
      expect(titles(r)).toEqual(['T-ALL']);
    });

    it('GET 列表：不受限看到全部（防過度擋）', async () => {
      const r = await call(
        '/api/announcements',
        { method: 'GET' },
        { role: 'admin', scope: 'all' },
      );
      expect(titles(r)).toEqual(['P-C1', 'T-ALL', 'T-C1', 'T-C2']);
    });

    it('GET inbox：老師（隸屬 C1）只看到老師的 C1＋全分校，看不到 C2 與家長公告', async () => {
      const r = await call(
        '/api/announcements/inbox',
        { method: 'GET' },
        { role: 'teacher', scope: 'all' },
      );
      expect(r.status).toBe(200);
      expect(titles(r)).toEqual(['T-ALL', 'T-C1']);
      expect(r.body['meta']['unread']).toBe(2);
    });

    it('GET inbox：管理員身分沒有收件匣 → 403', async () => {
      const r = await call(
        '/api/announcements/inbox',
        { method: 'GET' },
        { role: 'admin', scope: 'all' },
      );
      expect(r.status).toBe(403);
    });

    it('POST read-all：管理員身分 403，什麼都沒標', async () => {
      const r = await call(
        '/api/announcements/read-all',
        { method: 'POST' },
        { role: 'admin', scope: 'all' },
      );
      expect(r.status).toBe(403);
      expect(await readTitles()).toEqual([]);
    });

    it('POST read-all：老師只標到看得見的（T-C1、T-ALL），C2 與家長公告沒被標', async () => {
      const r = await call(
        '/api/announcements/read-all',
        { method: 'POST' },
        { role: 'teacher', scope: 'all' },
      );
      expect(r.status).toBe(200);
      expect(r.body['marked']).toBe(2);
      expect(await readTitles()).toEqual(['T-ALL', 'T-C1']);
    });

    it('POST read-all：標完之後 inbox 未讀 0（正控）', async () => {
      const r = await call(
        '/api/announcements/inbox',
        { method: 'GET' },
        { role: 'teacher', scope: 'all' },
      );
      expect(r.body['meta']['unread']).toBe(0);
    });
  });
});
