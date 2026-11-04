import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2230 ②：三支名單改 embed、撈齊**，對真的本機 PostgREST 跑。
 *
 * 1. 家長搜尋：原本先撈命中的學生 id 再 `.in('student_id', …)`（幾百位就 414、錯誤被吞 → 結果變少），
 *    帳號 email／電話那支沒有 org 條件。fixture：MANY 位家長，各有一個名字含「搜尋王」的孩子。
 * 2. 升年級預覽：學生一次撈、沒分頁（max_rows 1000 截斷）。fixture：在學 HUGE 位國一＋高三幾位。
 * 3. 家長申請：done 分組不分頁（截斷）、聯絡資訊兩支 `.in` 吞錯。fixture：HUGE 筆已完成的試聽。
 *
 * `ba_user` 不寫（c2）：家長帳號借種子裡已有的家長使用者。
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

const MANY = 260;
const HUGE = 1100;
const SENIORS = 3;

run('#2230 ② 名單改 embed（家長搜尋、升年級預覽、家長申請）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = {
    account: { userId: '', email: '', phone: '' },
    accountParent: '',
    kidsParent: '',
    senior: '',
  };

  beforeAll(async () => {
    ctx.userId = (
      await q<{ user_id: string }>(
        "select user_id from user_roles where role = 'admin' order by user_id limit 1",
      )
    )[0]!.user_id;
    // 借種子裡一位有 email 的家長帳號（不寫 ba_*，c2）
    const [account] = await q<{ id: string; email: string; phone: string | null }>(
      `select u.id, u.email, u.phone from ba_user u
         join user_roles r on r.user_id = u.id and r.role = 'parent'
        where u.email is not null order by u.id limit 1`,
    );
    fx.account = { userId: account!.id, email: account!.email, phone: account!.phone ?? '' };
    ctx.orgId = await one("insert into organizations (name) values ('#2230 契約：名單 embed')", []);
    const campus = await one("insert into campuses (org_id, name) values ($1, 'c1')", [ctx.orgId]);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    const course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, campus, '高三數學', subject],
    );
    const klass = await one(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '高三數學班')",
      [ctx.orgId, campus, course],
    );

    // 1. 一位家長底下 MANY 個名字含「搜尋王」的孩子；家長名字不含。舊寫法把命中的學生 id 全塞進
    //    `.in('student_id', …)` → 414 → 被吞 → 這位家長搜不到。`parents.user_id` 必填、(user_id, org_id)
    //    唯一，又不能寫 ba_*，所以家長數量少、孩子數量多（414 看的是學生 id 數）
    const kids = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade)
         select $1, '搜尋王 ' || g, 'J1' from generate_series(1, ${MANY}) g returning id`,
        [ctx.orgId],
      )
    ).map((r) => r.id);
    fx.kidsParent = await one(
      "insert into parents (org_id, name, user_id) values ($1, '孩子很多的家長', $2)",
      [ctx.orgId, ctx.userId],
    );
    await q(
      `insert into parent_student_relations (parent_id, student_id)
       select $1, s from unnest($2::uuid[]) s`,
      [fx.kidsParent, kids],
    );
    // 有孩子、但孩子名字不命中的家長：孩子那層少了 `!inner` 的話，`rel` 不會被濾空，他會被誤搜出來
    const [otherUser] = await q<{ id: string }>(
      'select id from ba_user where id <> all($1::text[]) order by id limit 1',
      [[ctx.userId, fx.account.userId]],
    );
    const otherParent = await one(
      "insert into parents (org_id, name, user_id) values ($1, '孩子不命中的家長', $2)",
      [ctx.orgId, otherUser!.id],
    );
    const otherKid = await one(
      "insert into students (org_id, name, grade) values ($1, '別人', 'J1')",
      [ctx.orgId],
    );
    await q('insert into parent_student_relations (parent_id, student_id) values ($1, $2)', [
      otherParent,
      otherKid,
    ]);
    // 帳號那一支：本 org 一位家長綁到那個帳號（名字不含搜尋字）
    fx.accountParent = await one(
      "insert into parents (org_id, name, user_id) values ($1, '帳號命中的家長', $2)",
      [ctx.orgId, fx.account.userId],
    );

    // 2. 在學 HUGE 位國一（上面的 MANY 位也是國一）＋ SENIORS 位高三，其中一位有在讀與退班的報名
    await q(
      `insert into students (org_id, name, grade)
       select $1, '國一 ' || g, 'J1' from generate_series(1, ${HUGE}) g`,
      [ctx.orgId],
    );
    const seniors = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade)
         select $1, '高三 ' || g, 'S3' from generate_series(1, ${SENIORS}) g returning id`,
        [ctx.orgId],
      )
    ).map((r) => r.id);
    fx.senior = seniors[0]!;
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
      [ctx.orgId, klass, fx.senior],
    );
    const course2 = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, campus, '高三英文', subject],
    );
    const klass2 = await one(
      "insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, '退掉的班')",
      [ctx.orgId, campus, course2],
    );
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'withdrawal', 'monthly', 1000, '2026-01-01')`,
      [ctx.orgId, klass2, fx.senior],
    );

    // 3. HUGE 筆已完成的試聽，都是那個帳號送的
    await q(
      `insert into trial_requests (org_id, student_id, course_id, status, requested_by)
       select $1::uuid, s, $2::uuid, 'completed'::trial_request_status, $3::text
         from unnest($4::uuid[]) s
       union all
       select $1::uuid, $5::uuid, $2::uuid, 'completed'::trial_request_status, $3::text
         from generate_series(1, ${HUGE - MANY})`,
      [ctx.orgId, course, fx.account.userId, kids, kids[0]],
    );
    app = (await import('../index')).default as never;
  }, 240_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from trial_requests where org_id = $1',
      'delete from parent_student_relations where parent_id in (select id from parents where org_id = $1)',
      'delete from parents where org_id = $1',
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

  const get = async <T>(path: string) => {
    const res = await app.request(path, {}, env);
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };
  type ParentList = { data: Array<{ id: string; name: string }>; meta: { total: number } };

  it(`家長搜尋孩子姓名：${MANY} 個孩子命中同一位家長（舊寫法 .in 學生 id 會 414、被吞成 0 筆）`, async () => {
    const body = await get<ParentList>(`/api/parents?search=${encodeURIComponent('搜尋王')}`);
    expect(body.meta.total).toBe(1);
    expect(body.data.map((p) => p.id)).toEqual([fx.kidsParent]);
  });

  it('家長搜尋帳號 email：只回本 org 綁那個帳號的家長', async () => {
    const needle = fx.account.email.split('@')[0]!;
    const body = await get<ParentList>(`/api/parents?search=${encodeURIComponent(needle)}`);
    expect(body.data.map((p) => p.id)).toEqual([fx.accountParent]);
  });

  it(`升年級預覽：在學 ${MANY + HUGE + 1 + SENIORS} 位全算（舊寫法被 max_rows 1000 截斷）；高三只列在讀的班`, async () => {
    const body = await get<{
      promotedCount: number;
      graduatedCount: number;
      graduatesWithEnrollments: Array<{ studentId: string; classNames: string[] }>;
    }>('/api/grade-promotions/preview');
    expect(body.promotedCount).toBe(MANY + HUGE + 1); // ＋孩子不命中的家長的那個孩子
    expect(body.graduatedCount).toBe(SENIORS);
    expect(body.graduatesWithEnrollments).toEqual([
      expect.objectContaining({ studentId: fx.senior, classNames: ['高三數學班'] }),
    ]);
  });

  it(`家長申請 done：${HUGE} 筆全回（舊寫法截斷在 1000），聯絡人是本 org 的家長`, async () => {
    const body = await get<{
      data: Array<{ parent: { name: string | null; phone: string | null } }>;
    }>('/api/parent-requests?group=done');
    expect(body.data).toHaveLength(HUGE);
    expect(body.data[0]!.parent).toEqual({
      name: '帳號命中的家長',
      phone: fx.account.phone || null,
    });
  });
});
