import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 老師的任課學生：只給 S1（taughtStudentIds 本身由 teacher-scope 的 spec 守）
vi.mock('../lib/teacher-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/teacher-scope')>()),
  taughtStudentIds: vi.fn(async () => [S1]),
}));

/**
 * 成績走 pg pool 的 SQL。替身照 `$2`（學生 id 清單，NULL＝不限）過濾、照 `$3` 截 —— 真的 SQL 語意
 * （欄位、班級、org 條件、3000 個 id）由 `list-endpoints.contract` 對真 DB 驗
 */
const pg = {
  rows: [] as Array<Record<string, unknown> & { student_id: string }>,
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  throws: false,
  noPool: false,
};
vi.mock('../lib/get-auth', () => ({
  getAuth: () => ({
    pool: pg.noPool
      ? undefined
      : {
          query: async (sql: string, params: unknown[]) => {
            pg.calls.push({ sql, params });
            if (pg.throws) throw new Error('pg boom');
            const ids = params[1] as string[] | null;
            const rows = pg.rows.filter((r) => ids === null || ids.includes(r.student_id));
            return { rows: rows.slice(0, params[2] as number) };
          },
        },
  }),
}));

import scoresApp from './scores';

/**
 * #1100 #40：成績匯出 CSV（保留類 —— 匯出是把資料帶出系統，範圍錯了就是外洩）。
 * 範圍：resolveScoreScope（老師 ∩ 分校）∩ 頂欄分校 ∩ studentIds。
 */
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const CAMPUS_A = '33333333-3333-4333-8333-333333333333';
const CAMPUS_B = '44444444-4444-4444-8444-444444444444';
const HEADER = '學生姓名,開課班,考試名稱,課程,日期,分數,狀態';

const row = (studentId: string, name: string, over: Record<string, unknown> = {}) => ({
  student_id: studentId,
  student_name: name,
  class_name: '數學 A 班',
  exam_name: '第一次段考',
  course_name: '國三數學',
  exam_date: '2026-10-01',
  score: 88,
  status: 'scored',
  ...over,
});

beforeEach(() => {
  pg.rows = [
    row(S1, '=HYPERLINK("evil")'),
    // 缺考那筆就算存了分數也不寫；段考沒有班
    row(S2, '王小明', { class_name: null, course_name: null, score: 5, status: 'absent' }),
  ];
  pg.calls = [];
  pg.throws = false;
  pg.noPool = false;
});

function setup(opts: { roles?: string[]; campusScope?: string[] | null; staffRow?: boolean }) {
  const inArg = (ops: Array<{ name: string; args: unknown[] }>, col: string) =>
    ops.find((o) => o.name === 'in' && o.args[0] === col)?.args[1] as string[] | undefined;
  const supabase = {
    from(table: string) {
      const ops: Array<{ name: string; args: unknown[] }> = [];
      const resolve = () => {
        if (table === 'staff') return opts.staffRow === false ? null : { id: 'staff-1' };
        // 分校 A 只有 S1
        if (table === 'enrollments' && inArg(ops, 'classes.campus_id'))
          return inArg(ops, 'classes.campus_id')!.includes(CAMPUS_A) ? [{ student_id: S1 }] : [];
        return [];
      };
      const proxy: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then')
              return (ok?: (v: unknown) => unknown) =>
                Promise.resolve({ data: resolve(), error: null }).then(ok);
            return (...args: unknown[]) => (ops.push({ name: prop, args }), proxy);
          },
        },
      );
      return proxy;
    },
  };
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const ctx = c as unknown as { set: (k: string, v: unknown) => void };
    ctx.set('supabase', supabase);
    ctx.set('orgId', 'org-1');
    ctx.set('userId', 'user-1');
    ctx.set('roles', opts.roles ?? ['admin']);
    ctx.set('campusScope', opts.campusScope ?? null);
    await next();
  });
  app.route('/api/scores', scoresApp);
  return (body: unknown) =>
    app.request('/api/scores/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
}

const lines = async (res: Response) => (await res.text()).replace(/^﻿/, '').split('\r\n');
const sentIds = () => pg.calls.at(-1)?.params[1];

describe('POST /api/scores/export（#1100 #40）', () => {
  it('欄位照規格；公式注入被跳脫；缺考不寫分數；SQL 帶 org、上限＋1', async () => {
    const res = await setup({})({});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(await lines(res)).toEqual([
      HEADER,
      `"'=HYPERLINK(""evil"")",數學 A 班,第一次段考,國三數學,2026-10-01,88,正常`,
      '王小明,,第一次段考,,2026-10-01,,缺考',
    ]);
    // 不受限的管理員按「全部學生」→ $2 是 NULL（不限），不是把全 org 的 id 塞進來
    expect(pg.calls[0]!.params).toEqual(['org-1', null, 20001]);
  });

  // 替身不跑 SQL：這條只是便宜的第一道（regex 帶左邊界 —— 'se.org_id' 不能冒充 'e.org_id'，#1922 二讀）。
  // 真的語意（兩個 org、跨 org 髒資料）由 contract/scores-export.contract.ts 對真 DB 驗
  it('SQL 每一段都帶 org 條件與學生篩選（別名分得開）', async () => {
    await setup({})({});
    const sql = pg.calls[0]!.sql.replace(/\s+/g, ' ');
    for (const cond of [
      /(?<![\w.])e\.org_id = \$1/,
      /(?<![\w.])se\.org_id = \$1/,
      /(?<![\w.])c\.org_id = \$1/,
      /(?<![\w.])en\.org_id = \$1/,
      /(?<![\w.])s\.student_id = ANY\(\$2::uuid\[\]\)/,
      /(?<![\w.])ss\.student_id = ANY\(\$2::uuid\[\]\)/,
    ])
      expect(sql).toMatch(cond);
  });

  it('「照目前的篩選」：只送帶來的學生', async () => {
    await setup({})({ studentIds: [S2] });
    expect(sentIds()).toEqual([S2]);
  });

  it('老師：只匯出自己的學生 —— 帶了別人的學生 id 也撈不到', async () => {
    const out = await lines(await setup({ roles: ['teacher'] })({ studentIds: [S1, S2] }));
    expect(sentIds()).toEqual([S1]);
    expect(out.join()).not.toContain('王小明');
  });

  it('老師按「全部學生」：也只有自己的學生，不是 NULL（不限）', async () => {
    await setup({ roles: ['teacher'] })({});
    expect(sentIds()).toEqual([S1]);
  });

  it('不是老師也不是管理員（查不到教職員列）→ 403，不查成績', async () => {
    expect((await setup({ roles: ['teacher'], staffRow: false })({})).status).toBe(403);
    expect(pg.calls).toEqual([]);
  });

  it('受限管理員：分校範圍套上 —— 只送範圍內的學生', async () => {
    await setup({ campusScope: [CAMPUS_A] })({});
    expect(sentIds()).toEqual([S1]);
  });

  it('受限管理員帶別分校的 campusId → 只有標頭，連成績都不查', async () => {
    const out = await lines(await setup({ campusScope: [CAMPUS_A] })({ campusId: CAMPUS_B }));
    expect(out).toEqual([HEADER]);
    expect(pg.calls).toEqual([]);
  });

  it('受限管理員＋照目前的篩選：帶範圍外的學生 → 只有標頭（取交集，不是用帶來的名單）', async () => {
    const out = await lines(await setup({ campusScope: [CAMPUS_A] })({ studentIds: [S2] }));
    expect(out).toEqual([HEADER]);
    expect(pg.calls).toEqual([]);
  });

  it('超過 20000 列 → 413，不截斷', async () => {
    pg.rows = Array.from({ length: 20001 }, () => row(S1, '王'));
    const res = await setup({})({});
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe('TOO_MANY_ROWS');
  });

  it('連線池不在 → 500 DB_POOL_UNAVAILABLE（不退回 REST）', async () => {
    pg.noPool = true;
    const res = await setup({})({});
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('DB_POOL_UNAVAILABLE');
  });

  it('SQL 失敗 → 500，不回 CSV', async () => {
    pg.throws = true;
    const res = await setup({})({});
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).not.toContain('text/csv');
  });

  it('studentIds 超過 3000 → 400', async () => {
    const ids = Array.from(
      { length: 3001 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect((await setup({})({ studentIds: ids })).status).toBe(400);
  });
});
