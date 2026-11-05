import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuth } from '../auth';
import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **`GET /api/students` 的兩條路對真 DB 逐欄相同**（#1595 P2 ② 刀 1a，計畫席 11-05 裁定）。
 *
 * SQL（`lib/student-list-sql.ts`，有 pool 時）與 query builder（沒有 pool 時）各一份條件。同一組請求各打
 * 一次，回應要**完全相同**：身分（不受限／受限一間／多間／沒指派／老師）× 指定分校（無／一校／二校）×
 * 篩選（年級、在籍、學制不合、卡片兩種、分頁）。fixture 每一筆都是為了讓某個條件寫錯時兩邊分岔：
 * - `onlyC2`：只在二校報名 —— 分校範圍少了就會出現在受限一校的名單
 * - `w`：一校**退班**、二校在籍 —— 受限一校看得到（分校不分狀態）、老師看不到（任課＝同一筆報名＋在籍）
 * - `p2`：老師的班 pending_payment —— 老師看得到（狀態清單少了它就分岔）
 * - `mis`／`misB`：學制不合（國中生讀小學）；`misB` 的學校是**別 org** 的 —— 學校少了 org 條件就會混進來
 * - 卡片：作廢的、今天發的、以前發的、沒卡的
 * - 家長：主要＋次要，電話經 better-auth 建（不直寫 ba_*，c2）；老師看不到電話
 * - 別 org：同名同年級的學生 —— 根表少了 org 條件就會混進來
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

const ctx = {
  orgId: '',
  adminUser: '',
  teacherUser: '',
  teacher: false,
  campusScope: null as string[] | null,
  usePool: true,
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
      set('userId', ctx.teacher ? ctx.teacherUser : ctx.adminUser);
      set('roles', [ctx.teacher ? 'teacher' : 'admin']);
      set('permissions', ctx.teacher ? [] : [...PERMISSIONS]);
      set('activeRole', ctx.teacher ? 'teacher' : 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.teacher ? null : ctx.campusScope);
      // builder 模式不設 auth（不能設 `{ pool: undefined }`：authPoolCleanup 會呼叫 `.end()`）
      if (ctx.usePool) {
        set('auth', { pool: { query: pool!.query.bind(pool), end: async () => undefined } });
      }
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('GET /api/students：SQL 與 builder 對真 DB 逐欄相同（#1595 P2 ② 刀 1a）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const auth = createAuth(
    {
      DATABASE_URL: DB ?? '',
      BETTER_AUTH_SECRET: 'contract-secret-at-least-32-characters-long',
      BETTER_AUTH_URL: 'http://localhost:8787',
      WEB_URL: 'http://localhost:4200',
      ALLOWED_ORIGINS: '',
      LINE_CLIENT_ID: '',
      LINE_CLIENT_SECRET: '',
    } as never,
    () => undefined,
  );
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const campus: Record<'c1' | 'c2', string> = { c1: '', c2: '' };
  let otherOrg = '';
  const otherIds: string[] = [];
  const parentUsers: string[] = [];

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    const [teacher] = await q<{ user_id: string }>(
      `select r.user_id from user_roles r where r.role = 'teacher'
         and not exists (select 1 from user_roles a where a.user_id = r.user_id and a.role = 'admin')
       order by r.user_id limit 1`,
    );
    ctx.adminUser = admin!.user_id;
    ctx.teacherUser = teacher!.user_id;
    ctx.orgId = await one("insert into organizations (name) values ('#1595 P2② 契約：名冊')", []);
    otherOrg = await one("insert into organizations (name) values ('#1595 P2② 契約：別 org')", []);
    const subject = await one("insert into subjects (org_id, name) values ($1, '數學')", [
      ctx.orgId,
    ]);
    const klass: Record<string, string> = {};
    for (const key of ['c1', 'c2'] as const) {
      campus[key] = await one('insert into campuses (org_id, name) values ($1, $2)', [
        ctx.orgId,
        `分校 ${key}`,
      ]);
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, campus[key], `數學 ${key}`, subject],
      );
      klass[key] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, campus[key], course, `班 ${key}`],
      );
    }
    const staff = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '一校老師')",
      [ctx.orgId, ctx.teacherUser],
    );
    await q(
      `insert into schedules (class_id, weekday, start_time, end_time, teacher_id, effective_from)
       values ($1, 1, '18:00', '19:00', $2, '2026-01-01')`,
      [klass['c1'], staff],
    );
    const school = async (org: string, name: string, level: string | null) =>
      one('insert into schools (org_id, name, level) values ($1, $2, $3::school_level)', [
        org,
        name,
        level,
      ]);
    const elementary = await school(ctx.orgId, '名冊國小', 'elementary');
    const junior = await school(ctx.orgId, '名冊國中', 'junior');
    const unknown = await school(ctx.orgId, '名冊未分類', null);
    const elementaryB = await school(otherOrg, '別 org 國小', 'elementary');
    // 別 org 的學校**會**出現在 misB 那列的 `schools`（學生自己的 FK，兩條路都一樣），所以不列進 otherIds

    const student = (name: string, grade: string, schoolId: string | null, active = true) =>
      one(
        'insert into students (org_id, name, grade, school_id, is_active) values ($1, $2, $3, $4, $5)',
        [ctx.orgId, name, grade, schoolId, active],
      );
    const s = {
      a: await student('甲', 'J2', junior),
      a2: await student('甲', 'J2', junior), // 同名：末鍵 id 定序
      b: await student('乙', 'P3', elementary),
      mis: await student('學制不合', 'J1', elementary),
      misB: await student('別 org 學校', 'J1', elementaryB),
      unk: await student('未分類學校', 'S2', unknown),
      off: await student('停用', 'S3', null, false),
      onlyC2: await student('只在二校', 'P6', null),
      w: await student('一校退班', 'S1', null),
      p2: await student('待繳費', 'J3', null),
      none: await student('沒報名', 'P1', null),
    };
    const enroll = async (studentId: string, classId: string, status = 'active') =>
      q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, $4::enrollment_status, 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, classId, studentId, status],
      );
    for (const id of [s.a, s.a2, s.b, s.mis, s.misB, s.unk, s.off]) await enroll(id, klass['c1']!);
    await enroll(s.a, klass['c2']!, 'withdrawal');
    await enroll(s.onlyC2, klass['c2']!);
    await enroll(s.w, klass['c1']!, 'withdrawal');
    await enroll(s.w, klass['c2']!);
    await enroll(s.p2, klass['c1']!, 'pending_payment');

    const card = (studentId: string, issuedAt: string, revoked = false) =>
      q(
        `insert into checkin_cards (org_id, student_id, code, issued_at, revoked_at)
         values ($1, $2, 'CK1-' || upper(substr(md5(random()::text), 1, 16)) -- hex 全在合法字元集內
        , $3::timestamptz, $4)`,
        [ctx.orgId, studentId, issuedAt, revoked ? new Date().toISOString() : null],
      );
    await card(s.a, new Date().toISOString()); // 今天發的
    await card(s.b, '2026-01-02T10:00:00+08:00'); // 以前發的
    await card(s.mis, new Date().toISOString(), true); // 今天發、作廢
    await card(s.unk, '2026-01-02T10:00:00+08:00', true); // 以前發、作廢

    // 家長：甲有主要＋次要，乙只有一位非主要；電話經 better-auth 建（c2）
    for (const [studentId, name, isPrimary, phone] of [
      [s.a, '甲爸', true, '0912000001'],
      [s.a, '甲媽', false, '0912000002'],
      [s.b, '乙媽', false, '0912000003'],
    ] as const) {
      const { user } = (await auth.api.createUser({
        body: {
          email: `c1595-${crypto.randomUUID()}@phone.internal`,
          name,
          data: { phone },
        } as never,
      })) as { user: { id: string } };
      parentUsers.push(user.id);
      const parent = await one('insert into parents (org_id, name, user_id) values ($1, $2, $3)', [
        ctx.orgId,
        name,
        user.id,
      ]);
      await q(
        'insert into parent_student_relations (parent_id, student_id, relation, is_primary) values ($1, $2, $3, $4)',
        [parent, studentId, isPrimary ? '父' : '母', isPrimary],
      );
    }

    // 別 org：同名同年級
    otherIds.push(
      await one("insert into students (org_id, name, grade) values ($1, '甲', 'J2')", [otherOrg]),
    );
    app = (await import('../index')).default as never;
  }, 60_000);

  afterAll(async () => {
    const authCtx = await auth.$context;
    for (const org of [ctx.orgId, otherOrg].filter(Boolean)) {
      for (const sql of [
        'delete from parent_student_relations where student_id in (select id from students where org_id = $1)',
        'delete from parents where org_id = $1',
        'delete from checkin_cards where org_id = $1',
        'delete from enrollments where org_id = $1',
        'delete from students where org_id = $1',
        'delete from schools where org_id = $1',
        'delete from schedules where class_id in (select id from classes where org_id = $1)',
        'delete from classes where org_id = $1',
        'delete from courses where org_id = $1',
        'delete from subjects where org_id = $1',
        'delete from staff where org_id = $1',
        'delete from campuses where org_id = $1',
        'delete from audit_logs where org_id = $1',
        'delete from organizations where id = $1',
      ])
        await q(sql, [org]);
    }
    for (const id of parentUsers) await authCtx.internalAdapter.deleteUser(id);
  }, 60_000);

  const sqlFailures = (log: { mock: { calls: unknown[][] } }) =>
    log.mock.calls.filter((c) => String(c[0]).includes('[students-sql]')).length;

  const hit = async (url: string, usePool: boolean) => {
    ctx.usePool = usePool;
    const res = await app.request(url, {}, env);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  const WHO: Record<string, { teacher: boolean; scope: () => string[] | null }> = {
    all: { teacher: false, scope: () => null },
    one: { teacher: false, scope: () => [campus.c1] },
    many: { teacher: false, scope: () => [campus.c1, campus.c2] },
    none: { teacher: false, scope: () => [] },
    teacher: { teacher: true, scope: () => null },
  };

  it('每種身分 × 指定分校 × 篩選：兩條路回應完全相同，SQL 沒有失敗，別 org 不混入', async () => {
    const log = vi.spyOn(console, 'error');
    const requested = { none: () => null, c1: () => campus.c1, c2: () => campus.c2 };
    const filters = [
      '',
      'grade=J2',
      'isActive=true',
      'isActive=false',
      'schoolMismatch=true',
      'withoutCard=true',
      'cardIssuedToday=true',
      'withoutCard=true&cardIssuedToday=true',
      'pageSize=2&page=2',
      'page=99',
    ];
    const diffs: string[] = [];
    let compared = 0;
    let nonEmpty = 0;
    for (const [wk, who] of Object.entries(WHO))
      for (const [rk, req] of Object.entries(requested))
        for (const f of filters) {
          ctx.teacher = who.teacher;
          ctx.campusScope = who.scope();
          const c = req();
          const qs = ['withToday=false', c ? `campusId=${c}` : '', f].filter(Boolean).join('&');
          const url = `/api/students?${qs}`;
          const before = sqlFailures(log);
          const viaSql = await hit(url, true);
          if (sqlFailures(log) !== before) diffs.push(`${wk}|${rk}|${f}：SQL 失敗`);
          const viaBuilder = await hit(url, false);
          compared += 1;
          if (JSON.stringify(viaSql) !== JSON.stringify(viaBuilder)) diffs.push(`${wk}|${rk}|${f}`);
          const text = JSON.stringify(viaSql);
          if (otherIds.some((id) => text.includes(id))) diffs.push(`${wk}|${rk}|${f}：混進別 org`);
          if (((viaSql.body['data'] as unknown[]) ?? []).length > 0) nonEmpty += 1;
        }
    ctx.teacher = false;
    ctx.campusScope = null;
    expect(compared).toBe(150);
    expect(diffs).toEqual([]);
    expect(nonEmpty).toBeGreaterThan(50); // 不是兩邊都空
  });

  it('第一頁（含今日到班）也逐欄相同', async () => {
    for (const who of Object.values(WHO)) {
      ctx.teacher = who.teacher;
      ctx.campusScope = who.scope();
      expect(await hit('/api/students', true)).toEqual(await hit('/api/students', false));
    }
    ctx.teacher = false;
    ctx.campusScope = null;
  });

  it('有資料可比：管理員看得到主要家長電話、有效卡、學制不合；老師看不到電話', async () => {
    ctx.campusScope = null;
    const { body } = await hit('/api/students?withToday=false', true);
    const rows = body['data'] as Array<Record<string, unknown>>;
    const byName = (n: string) => rows.filter((r) => r['name'] === n);
    expect(byName('甲').map((r) => r['primaryParentPhone'])).toContain('0912000001');
    expect(byName('乙')[0]!['primaryParentPhone']).toBe('0912000003');
    expect(byName('甲').some((r) => r['hasActiveCard'])).toBe(true);
    const mis = (await hit('/api/students?withToday=false&schoolMismatch=true', true)).body;
    expect((mis['data'] as Array<{ name: string }>).map((r) => r.name)).toEqual(['學制不合']);

    ctx.teacher = true;
    const t = (await hit('/api/students?withToday=false', true)).body;
    ctx.teacher = false;
    const tRows = t['data'] as Array<Record<string, unknown>>;
    expect(tRows.length).toBeGreaterThan(0);
    expect(tRows.every((r) => r['primaryParentPhone'] === null)).toBe(true);
  });

  it('受限管理員的列表不碰 REST（舊碼：列表＋在籍數＋12 支章節）', async () => {
    const realFetch = globalThis.fetch;
    let rest = 0;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input instanceof Request ? input.url : input).includes('/rest/v1/')) rest += 1;
      return realFetch(input, init);
    });
    try {
      ctx.campusScope = [campus.c1];
      const res = await hit('/api/students?withToday=false', true);
      expect(res.status).toBe(200);
      expect(rest).toBe(0);
    } finally {
      spy.mockRestore();
      ctx.campusScope = null;
    }
  });
});
