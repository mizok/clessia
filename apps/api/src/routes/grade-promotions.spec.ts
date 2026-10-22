import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1820 學年升級的路由層：權限（要 all_campuses）、池不在、交易結果對成 HTTP、預覽組裝、稽核。
 * 交易本身（lib/grade-promotion）在這裡換成替身 —— 它的形狀在 lib spec、SQL 語意在契約測試。
 */

const pool = { value: {} as unknown };
vi.mock('../lib/get-auth', () => ({ getAuth: () => ({ pool: pool.value }) }));

const promoteGrades = vi.fn();
const revertPromotion = vi.fn();
vi.mock('../lib/grade-promotion', async (orig) => ({
  ...(await orig<typeof import('../lib/grade-promotion')>()),
  promoteGrades: (...a: unknown[]) => promoteGrades(...a),
  revertPromotion: (...a: unknown[]) => revertPromotion(...a),
}));

const { default: route } = await import('./grade-promotions');

const ORG = '00000000-0000-0000-0000-0000000000aa';
const PROMO = '00000000-0000-0000-0000-0000000000p1'.replace('p1', 'b1');

type Rows = Record<string, Array<Record<string, unknown>>>;

/** 固定回列的 supabase 替身（每張表一份資料），insert 記下來（稽核） */
function fakeDb(rows: Rows) {
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const make = (table: string) => {
    const data = rows[table] ?? [];
    const terminal: Record<string, unknown> = {
      insert: (payload: unknown) => {
        inserts.push({ table, payload });
        return Promise.resolve({ error: null });
      },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok),
    };
    const builder: Record<string, unknown> = new Proxy(terminal, {
      get(t, prop: string) {
        if (prop in t) return t[prop];
        return () => builder;
      },
    });
    return builder;
  };
  return { from: (t: string) => make(t), inserts };
}

async function call(
  method: string,
  path: string,
  opts: { scope?: string[] | null; rows?: Rows } = {},
) {
  const db = fakeDb(opts.rows ?? {});
  const background: Promise<unknown>[] = [];
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db);
    set('orgId', ORG);
    set('userId', 'admin-1');
    set('roles', ['admin']);
    set('permissions', ['manage_students', 'all_campuses']);
    set('campusScope', opts.scope === undefined ? null : opts.scope);
    await next();
  });
  app.route('/', route as unknown as Hono);
  const res = await app.request(path, { method }, undefined, {
    waitUntil: (p: Promise<unknown>) => background.push(p),
    passThroughOnException: () => undefined,
  } as never);
  await Promise.all(background);
  return { status: res.status, body: (await res.json()) as any, inserts: db.inserts };
}

beforeEach(() => {
  pool.value = {};
  promoteGrades.mockReset();
  revertPromotion.mockReset();
});

describe('權限：全機構一次，受分校範圍限制的管理員一律 403（計畫席裁 E）', () => {
  it.each([
    ['GET', '/preview'],
    ['GET', '/'],
    ['POST', '/'],
    ['POST', `/${PROMO}/revert`],
  ])('%s %s', async (method, path) => {
    const r = await call(method, path, { scope: ['campus-a'] });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('REQUIRES_ALL_CAMPUSES');
    expect(promoteGrades).not.toHaveBeenCalled();
    expect(revertPromotion).not.toHaveBeenCalled();
  });
});

describe('POST / —— 執行', () => {
  it('成功 → 201＋稽核一筆（resource_type grade_promotion，帶人數）', async () => {
    promoteGrades.mockResolvedValue({
      status: 'done',
      promotionId: PROMO,
      promotedCount: 10,
      graduatedCount: 2,
    });
    const r = await call('POST', '/');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ promotionId: PROMO, promotedCount: 10, graduatedCount: 2 });
    expect(promoteGrades.mock.calls[0]![1]).toMatchObject({ orgId: ORG, userId: 'admin-1' });
    const audit = r.inserts.find((i) => i.table === 'audit_logs')?.payload as Record<string, any>;
    expect(audit).toMatchObject({
      resource_type: 'grade_promotion',
      resource_id: PROMO,
      action: 'create',
      details: { promotedCount: 10, graduatedCount: 2 },
    });
  });

  it('同學年已升過 → 409 ALREADY_PROMOTED，不寫稽核', async () => {
    promoteGrades.mockResolvedValue({ status: 'already-promoted' });
    const r = await call('POST', '/');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ALREADY_PROMOTED');
    expect(r.inserts).toHaveLength(0);
  });

  it('交易丟例外 → 500，不折成別的狀態', async () => {
    promoteGrades.mockRejectedValue(new Error('boom'));
    expect((await call('POST', '/')).status).toBe(500);
  });

  it('池不在 → 500 DB_POOL_UNAVAILABLE，不退回沒有交易的寫法', async () => {
    pool.value = undefined;
    const r = await call('POST', '/');
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('DB_POOL_UNAVAILABLE');
    expect(promoteGrades).not.toHaveBeenCalled();
  });
});

describe('POST /{id}/revert —— 復原', () => {
  it.each([
    ['not-found', 404, 'NOT_FOUND'],
    ['already-reverted', 409, 'ALREADY_REVERTED'],
    ['expired', 409, 'REVERT_EXPIRED'],
  ])('%s → %i %s', async (status, http, code) => {
    revertPromotion.mockResolvedValue({ status });
    const r = await call('POST', `/${PROMO}/revert`);
    expect(r.status).toBe(http);
    expect(r.body.code).toBe(code);
  });

  it('成功 → 200，回還原數與跳過名單，稽核 revert', async () => {
    revertPromotion.mockResolvedValue({
      status: 'done',
      revertedCount: 3,
      skipped: [{ studentId: 's9', name: '丙' }],
    });
    const r = await call('POST', `/${PROMO}/revert`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ revertedCount: 3, skipped: [{ studentId: 's9', name: '丙' }] });
    expect(revertPromotion.mock.calls[0]![1]).toMatchObject({ orgId: ORG, promotionId: PROMO });
    const audit = r.inserts.find((i) => i.table === 'audit_logs')?.payload as Record<string, any>;
    expect(audit).toMatchObject({
      action: 'revert',
      details: { revertedCount: 3, skippedCount: 1 },
    });
  });
});

describe('GET /preview', () => {
  it('組出各變動人數、學校要更新、高三還有在籍報名；已升過時 alreadyPromoted', async () => {
    const r = await call('GET', '/preview', {
      rows: {
        students: [
          { id: 's1', name: '甲', grade: 'J3', schools: { name: '明湖國中', level: 'junior' } },
          { id: 's2', name: '乙', grade: 'S3', schools: null },
        ],
        enrollments: [{ student_id: 's2', classes: { name: '高三數學' } }],
        grade_promotions: [{ id: 'old' }],
      },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      alreadyPromoted: true,
      promotedCount: 1,
      graduatedCount: 1,
      schoolMismatch: [{ studentId: 's1', name: '甲', schoolName: '明湖國中', newGrade: 'S1' }],
      graduatesWithEnrollments: [{ studentId: 's2', name: '乙', classNames: ['高三數學'] }],
    });
  });
});
