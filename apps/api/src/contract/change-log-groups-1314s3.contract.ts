import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#1314 S3：課務異動列表以「一則」分頁＋分校範圍**（`GET /api/sessions/changes`，`lib/change-log-sql.ts`），
 * 對真的本機 Postgres 跑。也取代原本用 REST 替身的搜尋 spec（#1412，`sessions-changes-search.spec.ts`）。
 *
 * fixture（上課日都在 2026-10，查 10/1–10/31）：A 校班「英文 A1」、B 校班「數學 B1」；
 * 依 created_at 由新到舊（＝分組後的順序）：
 *   ① B1 單堂停課（T5）
 *   ② 舊批次（沒有 batch_id、operation_source=batch）停課 2 堂，同一秒（T4）
 *   ③ A1 單堂調課（T3）
 *   ④ A1 單堂代課（T2）：原老師「王老師」、代課「林老師」
 *   ⑤ 新批次（batch_id X）停課 3 堂（T1）
 * 另一個 org 有「英文 Z」班的一筆異動：搜「英文」不能出現。
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

const ctx: { orgId: string; userId: string; campusScope: string[] | null } = {
  orgId: '',
  userId: '',
  campusScope: null,
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
      const authPool = {
        query: pool!.query.bind(pool),
        connect: pool!.connect.bind(pool),
        end: async () => undefined,
      };
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('campusScope', ctx.campusScope);
      set('auth', { pool: authPool });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: ctx.campusScope ?? [] });
      await next();
    }),
  };
});

interface Entry {
  id: string;
  changeType: string;
  className: string | null;
  batchId: string | null;
  isBatch: boolean;
}

run('#1314 S3 課務異動：以「一則」分頁、分校範圍、搜尋', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { campusA: '', campusB: '', otherOrg: '', batchX: '' };

  /** 建一間 org 的班與課堂，回 { classId → [sessionId…] } */
  const makeClass = async (
    orgId: string,
    campusId: string,
    courseId: string,
    name: string,
    n: number,
  ) => {
    const [cls] = await q<{ id: string }>(
      'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4) returning id',
      [orgId, campusId, courseId, name],
    );
    return (
      await q<{ id: string }>(
        `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
         select $1, $2, ('2026-10-01'::date + k), '18:00', '19:00', 'scheduled', 'unassigned'
           from generate_series(1, $3::int) k returning id`,
        [orgId, cls!.id, n],
      )
    ).map((r) => r.id);
  };

  const makeOrg = async (name: string) => {
    const [org] = await q<{ id: string }>(
      "insert into organizations (name, attendance_mode) values ($1, 'per_session') returning id",
      [name],
    );
    const campuses = (
      await q<{ id: string }>(
        "insert into campuses (org_id, name) values ($1, 'A 校'), ($1, 'B 校') returning id",
        [org!.id],
      )
    ).map((r) => r.id) as [string, string];
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '科目') returning id",
      [org!.id],
    );
    const [course] = await q<{ id: string }>(
      "insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, '課程', $3) returning id",
      [org!.id, campuses[0], subject!.id],
    );
    return { orgId: org!.id, campuses, courseId: course!.id };
  };

  const change = (
    orgId: string,
    sessionId: string,
    type: string,
    at: string,
    extra: Record<string, unknown> = {},
  ) =>
    q(
      `insert into schedule_changes (org_id, session_id, change_type, created_at, created_by_name, reason,
         operation_source, batch_id, original_teacher_name, substitute_teacher_id)
       values ($1, $2, $3::schedule_change_type, $4::timestamptz, '行政 A', $5, $6, $7::uuid, $8, $9::uuid)`,
      [
        orgId,
        sessionId,
        type,
        at,
        extra['reason'] ?? null,
        extra['source'] ?? 'single',
        extra['batchId'] ?? null,
        extra['originalTeacher'] ?? null,
        extra['substitute'] ?? null,
      ],
    );

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    ctx.userId = admin!.user_id;
    const mine = await makeOrg('#1314 S3 契約：異動分組');
    ctx.orgId = mine.orgId;
    [fx.campusA, fx.campusB] = mine.campuses;
    const a1 = await makeClass(ctx.orgId, fx.campusA, mine.courseId, '英文 A1', 7);
    const [b1] = await makeClass(ctx.orgId, fx.campusB, mine.courseId, '數學 B1', 1);
    const [sub] = await q<{ id: string }>(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '林老師') returning id",
      [ctx.orgId, ctx.userId],
    );
    fx.batchX = (await q<{ id: string }>('select gen_random_uuid() as id'))[0]!.id;

    await change(ctx.orgId, b1!, 'cancellation', '2026-10-20T05:00:00Z'); // ①
    for (const [i, s] of [a1[0], a1[1]].entries()) {
      // ② 舊批次：同一秒、毫秒不同
      await change(ctx.orgId, s!, 'cancellation', `2026-10-19T05:00:00.${100 + i}Z`, {
        source: 'batch',
        reason: '颱風',
      });
    }
    await change(ctx.orgId, a1[2]!, 'reschedule', '2026-10-18T05:00:00Z'); // ③
    await change(ctx.orgId, a1[3]!, 'substitute', '2026-10-17T05:00:00Z', {
      originalTeacher: '王老師',
      substitute: sub!.id,
    }); // ④
    // 同一批的三列建立時間差幾秒（大批寫入不保證同一秒）：只有 batch_id 收得起來，合成鍵收不起來
    for (const [i, s] of [a1[4], a1[5], a1[6]].entries()) {
      await change(ctx.orgId, s!, 'cancellation', `2026-10-16T05:00:0${i * 3}Z`, {
        source: 'batch',
        batchId: fx.batchX,
        reason: '停電',
      }); // ⑤
    }

    const other = await makeOrg('#1314 S3 契約：別的機構');
    fx.otherOrg = other.orgId;
    const [z] = await makeClass(other.orgId, other.campuses[0], other.courseId, '英文 Z', 1);
    await change(other.orgId, z!, 'cancellation', '2026-10-21T05:00:00Z');

    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    for (const orgId of [ctx.orgId, fx.otherOrg].filter(Boolean)) {
      for (const sql of [
        'delete from schedule_changes where org_id = $1',
        'delete from sessions where org_id = $1',
        'delete from classes where org_id = $1',
        'delete from staff where org_id = $1',
        'delete from courses where org_id = $1',
        'delete from subjects where org_id = $1',
        'delete from campuses where org_id = $1',
        'delete from audit_logs where org_id = $1',
        'delete from organizations where id = $1',
      ]) {
        await q(sql, [orgId]);
      }
    }
  }, 120_000);

  const list = async (params: string, campusScope: string[] | null = null) => {
    ctx.campusScope = campusScope;
    const res = await app.request(
      `/api/sessions/changes?from=2026-10-01&to=2026-10-31&${params}`,
      {},
      env,
    );
    const body = (await res.json()) as {
      data?: Entry[];
      meta?: { total: number; rowTotal: number };
    };
    return {
      status: res.status,
      data: body.data ?? [],
      total: body.meta?.total,
      rowTotal: body.meta?.rowTotal,
    };
  };

  it('分頁單位是「一則」：一批不會被切到兩頁；total 數的是則', async () => {
    const p1 = await list('pageSize=2&page=1');
    const p2 = await list('pageSize=2&page=2');
    const p3 = await list('pageSize=2&page=3');
    expect([p1.total, p2.total, p3.total]).toEqual([5, 5, 5]);
    // ① B1 單堂＋② 舊批次 2 列
    expect(p1.data.map((e) => e.className)).toEqual(['數學 B1', '英文 A1', '英文 A1']);
    // ③ 調課＋④ 代課
    expect(p2.data.map((e) => e.changeType)).toEqual(['reschedule', 'substitute']);
    // ⑤ 新批次 3 列全部在同一頁
    expect(p3.data).toHaveLength(3);
    expect(new Set(p3.data.map((e) => e.batchId))).toEqual(new Set([fx.batchX]));
  });

  it('rowTotal 數列（堂次）：停課 3 則＝6 堂（B1 1＋舊批次 2＋新批次 3）', async () => {
    const { total, rowTotal } = await list('pageSize=1&changeType=cancellation');
    expect({ total, rowTotal }).toEqual({ total: 3, rowTotal: 6 });
  });

  it('舊批次（沒有 batch_id）：同類型、原因、操作者、同一秒的算一則', async () => {
    const p1 = await list('pageSize=2&page=1');
    const old = p1.data.filter((e) => e.isBatch && e.batchId === null);
    expect(old).toHaveLength(2);
  });

  it('受限管理員只看範圍內分校：A 校範圍看不到 B 校那筆', async () => {
    const { status, data, total } = await list('pageSize=100', [fx.campusA]);
    expect(status).toBe(200);
    expect(total).toBe(4);
    expect(data.map((e) => e.className)).not.toContain('數學 B1');
  });

  // 範圍外的 campusId 由全域 campusRequestGuard 擋（middleware/auth.ts）；這條守的是這支路由也在它後面
  it('指名範圍外的分校 → 403，不默默回空；範圍內、或不受限時照常', async () => {
    expect((await list(`campusId=${fx.campusB}`, [fx.campusA])).status).toBe(403);
    const inScope = await list(`campusId=${fx.campusA}`, [fx.campusA]);
    expect({ status: inScope.status, total: inScope.total }).toEqual({ status: 200, total: 4 });
    const unrestricted = await list(`campusId=${fx.campusB}`);
    expect({ status: unrestricted.status, total: unrestricted.total }).toEqual({
      status: 200,
      total: 1,
    });
  });

  // 以下是 #1412 搜尋（原 sessions-changes-search.spec.ts 的情境，改對真 DB）
  it.each([
    ['英文', 4], // 班名：A1 全部；別的 org 的「英文 Z」不算
    ['林', 1], // 代課老師名
    ['王老', 1], // 原老師名
    ['不存在的字', 0],
    ['()', 0], // 只有保留字元：剝光後回空，不能變成「不篩」
  ])('q=%s → %i 則', async (term, expected) => {
    const { status, total } = await list(`pageSize=100&q=${encodeURIComponent(term)}`);
    expect({ status, total }).toEqual({ status: 200, total: expected });
  });

  it('q 與 changeType 並用是 AND', async () => {
    const { data, total } = await list(
      `pageSize=100&q=${encodeURIComponent('英文')}&changeType=substitute`,
    );
    expect(total).toBe(1);
    expect(data.map((e) => e.changeType)).toEqual(['substitute']);
  });

  it('q 裡的保留字元被剝掉，不會拆壞條件', async () => {
    const { status, total } = await list(`pageSize=100&q=${encodeURIComponent('英(文')}`);
    expect({ status, total }).toEqual({ status: 200, total: 4 });
  });

  it('q 超過 50 字回 400', async () => {
    expect((await list(`q=${'字'.repeat(51)}`)).status).toBe(400);
  });
});
