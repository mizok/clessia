import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuth } from '../auth';
import { createChildDb } from '../lib/child-db';
import { loadStudentListViaBuilder } from '../lib/student-list-builder';
import { STUDENT_LIST_SQL, studentListParamsFromArgs } from '../lib/student-list-sql';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **`GET /api/students` 的兩條路對真 DB 逐欄相同**（#1595 P2 ② 刀 1a，計畫席 11-05 裁定）。
 *
 * SQL（`lib/student-list-sql.ts`）與 query builder（`lib/student-list-builder.ts`，同一份參數）各一份條件。同一組請求各打
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

/**
 * 家長電話每輪隨機（`ba_user.phone` 是 unique）：寫死的話，中斷過一次（afterAll 沒跑到）或兩輪並行，
 * 下一輪的 beforeAll 就撞 `ba_user_phone_key`，整支 describe 被略過 —— 突變看起來「紅了」，其實斷言一條都沒跑
 */
const PHONE = `09${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;

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
      // 兩側都給 pool（#2303 之後今日到班沒有 pool 就 500）。builder 側只把**列表那一句**換成 builder 版，
      // 其餘 SQL（今日到班）照常打真 DB —— 兩側唯一的差別就是 STUDENT_LIST_SQL 對 builder
      const real = (sql: string, v: unknown[]) => pool!.query(sql, v);
      set('auth', {
        pool: {
          query: ctx.usePool
            ? real
            : async (sql: string, v: unknown[]) =>
                sql === STUDENT_LIST_SQL
                  ? {
                      rows: [
                        {
                          result: await loadStudentListViaBuilder(
                            supabase as never,
                            studentListParamsFromArgs(v),
                          ),
                        },
                      ],
                    }
                  : real(sql, v),
          // authPoolCleanup 每個請求都會呼叫 end，而這裡所有請求共用同一個 pool
          end: async () => undefined,
        },
      });
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('GET /api/students：SQL 與 builder 對真 DB 逐欄相同（#1595 P2 ② 刀 1a／1b）', () => {
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
    // 簡稱也要比得到（只有簡稱命中：全名裡沒有「冊中」）
    await q("update schools set short_name = '冊中' where id = $1", [junior]);
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
      [s.a, '甲爸', true, `${PHONE}01`],
      [s.a, '甲媽', false, `${PHONE}02`],
      [s.b, '乙媽', false, `${PHONE}03`],
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

    // 今日到班（刀 1b）：日到班模式、一校那班今天 00:00 有課（時間已過，到／沒到都定了）、甲打了卡
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    await q("update organizations set attendance_mode = 'daily_checkin' where id = $1", [
      ctx.orgId,
    ]);
    await q(
      `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
       values ($1, $2, $3, '00:00', '00:30', 'scheduled', 'unassigned')`,
      [ctx.orgId, klass['c1'], today],
    );
    await q(
      'insert into daily_checkins (org_id, student_id, checkin_date, checked_in_at) values ($1, $2, $3, now())',
      [ctx.orgId, s.a, today],
    );

    // 授權面缺口（#1595 P2 ② 裁定 (c)）：別 org 的家長掛在本 org 的乙身上（FK 不擋）。
    // 用他的名字搜，本 org 不能因此命中乙
    const { user: userB } = (await auth.api.createUser({
      body: { email: `c1595-${crypto.randomUUID()}@phone.internal`, name: '跨org家長' } as never,
    })) as { user: { id: string } };
    parentUsers.push(userB.id);
    const parentB = await one(
      "insert into parents (org_id, name, user_id) values ($1, '跨org家長', $2)",
      [otherOrg, userB.id],
    );
    await q(
      "insert into parent_student_relations (parent_id, student_id, relation, is_primary) values ($1, $2, '其他', false)",
      [parentB, s.b],
    );

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
        'delete from daily_checkins where org_id = $1',
        'delete from sessions where org_id = $1',
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

  /**
   * **範圍的絕對斷言**（#1928 那套：跨校、跨老師不可見）。兩側吃同一份參數，所以 route 把範圍參數算錯
   * （例：老師的任課班沒傳）時兩側一起錯、逐欄比對抓不到 —— 這條直接對名單
   */
  it('範圍：受限一校看得到一校退班的、看不到只在二校的；老師只看得到任課班 active／pending 的', async () => {
    const names = async () =>
      (
        (await hit('/api/students?withToday=false&pageSize=100', true)).body['data'] as Array<{
          name: string;
        }>
      )
        .map((r) => r.name)
        .sort();
    try {
      ctx.campusScope = [campus.c1];
      const c1 = await names();
      expect(c1).toContain('一校退班');
      expect(c1).not.toContain('只在二校');
      ctx.campusScope = [];
      expect(await names()).toEqual([]);
      ctx.campusScope = null;
      ctx.teacher = true;
      expect(await names()).toEqual(
        ['甲', '甲', '乙', '學制不合', '別 org 學校', '未分類學校', '停用', '待繳費'].sort(),
      );
    } finally {
      ctx.teacher = false;
      ctx.campusScope = null;
    }
  });

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
      `search=${encodeURIComponent('甲')}`,
      `search=${encodeURIComponent('媽')}`,
      `search=${encodeURIComponent('國中')}`,
      `search=${encodeURIComponent('名*小')}`,
      `search=${PHONE}03`,
      `search=${encodeURIComponent('冊中')}`,
      // 別 org 的學校（misB 掛著）：學校名搜尋要限本 org，同 builder
      `search=${encodeURIComponent('別 org 國小')}`,
      `search=${PHONE}`, // 三位家長都中（前綴）
      `search=${encodeURIComponent('媽')}&searchScope=student_name`,
      // 別 org 家長的名字（#1595 P2 ② 裁定 (c)）：兩條路都要是空 —— builder 少了 parents.org_id 會命中乙
      `search=${encodeURIComponent('跨org家長')}`,
      'today=any',
      'today=arrived',
      'today=missing',
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
    expect(compared).toBe(345);
    expect(diffs).toEqual([]);
    expect(nonEmpty).toBeGreaterThan(50); // 不是兩邊都空
    // 近 700 支請求：負載高時會撞預設 30 秒，逾時後 ctx 停在迴圈中途、後面幾條連鎖紅
  }, 120_000);

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
    expect(byName('甲').map((r) => r['primaryParentPhone'])).toContain(`${PHONE}01`);
    expect(byName('乙')[0]!['primaryParentPhone']).toBe(`${PHONE}03`);
    expect(byName('甲').some((r) => r['hasActiveCard'])).toBe(true);
    const mis = (await hit('/api/students?withToday=false&schoolMismatch=true', true)).body;
    expect((mis['data'] as Array<{ name: string }>).map((r) => r.name)).toEqual(['學制不合']);

    // 刀 1b 的篩選真的有命中（不是兩邊都空）
    const names = async (qs: string) =>
      (
        (await hit(`/api/students?withToday=false&${qs}`, true)).body['data'] as Array<{
          name: string;
        }>
      )
        .map((r) => r.name)
        .sort();
    expect(await names('today=arrived')).toEqual(['甲']);
    expect((await names('today=missing')).length).toBeGreaterThan(3);
    expect(await names(`search=${PHONE}03`)).toEqual(['乙']);
    expect(await names(`search=${encodeURIComponent('甲媽')}`)).toEqual(['甲']);
    expect(await names(`search=${encodeURIComponent('名冊國中')}`)).toEqual(['甲', '甲']);
    // `*` 是萬用字元；別 org 的國小（misB 的學校）不算
    expect(await names(`search=${encodeURIComponent('名*小')}`)).toEqual(['乙', '學制不合'].sort());

    ctx.teacher = true;
    const t = (await hit('/api/students?withToday=false', true)).body;
    ctx.teacher = false;
    const tRows = t['data'] as Array<Record<string, unknown>>;
    expect(tRows.length).toBeGreaterThan(0);
    expect(tRows.every((r) => r['primaryParentPhone'] === null)).toBe(true);
  });

  it('家長姓名搜尋只比本 org 的家長：別 org 家長的名字搜不到本 org 的學生（舊碼命中）', async () => {
    const body = (
      await hit(`/api/students?withToday=false&search=${encodeURIComponent('跨org家長')}`, true)
    ).body;
    expect(body['data']).toEqual([]);
    expect((body['summary'] as { total: number }).total).toBe(0);
    // builder（契約的對照組、無 pool 的單元測試）也要守同一條：直接打，不經 route
    const supabase = createServiceClientFromEnv({
      SUPABASE_URL: URL!,
      SUPABASE_SECRET_KEY: KEY!,
    } as never);
    const viaBuilder = await loadStudentListViaBuilder(supabase as never, {
      orgId: ctx.orgId,
      campusIds: null,
      classIds: null,
      grade: null,
      isActive: null,
      schoolMismatch: false,
      withoutCard: false,
      cardIssuedToday: false,
      cardDayStart: '2026-01-01T00:00:00+08:00',
      cardDayEnd: '2026-01-02T00:00:00+08:00',
      limit: 20,
      offset: 0,
      withPhone: false,
      search: '跨org家長',
      searchRelated: true,
      searchPhone: false,
      todayIds: null,
    });
    expect([viaBuilder.rows, viaBuilder.total]).toEqual([[], 0]);
  });

  it('受限管理員帶搜尋也不碰 REST（舊碼：家長、學校前置查詢＋列表＋計數）', async () => {
    const realFetch = globalThis.fetch;
    let rest = 0;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input instanceof Request ? input.url : input).includes('/rest/v1/')) rest += 1;
      return realFetch(input, init);
    });
    try {
      ctx.campusScope = [campus.c1];
      const res = await hit(
        `/api/students?withToday=false&search=${encodeURIComponent('媽')}`,
        true,
      );
      expect(res.status).toBe(200);
      expect((res.body['data'] as unknown[]).length).toBeGreaterThan(0);
      expect(rest).toBe(0);
    } finally {
      spy.mockRestore();
      ctx.campusScope = null;
    }
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
