import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2230 ③：課堂列表的日到班人數、工作台該到沒到的家長與聯絡，改走 pg**，對真的本機 DB 跑。
 *
 * 1. 到班數（`annotateArrivals`）：原本報名 `.in(class_id)`、打卡 `.in(student_id)`，都沒分頁 →
 *    max_rows 1000 截斷，學生多時 414。fixture：DAY 那天 CLASSES 班 × SEATS 人全到。
 * 2. 工作台（`primaryParentByStudent`、`lastContactByStudent`）：原本 `.in(student_id)`，**錯誤不看** →
 *    人一多就 414、列上沒有家長電話與今日聯絡。fixture：DAY2 那天 MISSING 人該到沒到。
 *
 * 分校設成日到班模式；家長帳號借種子已有的使用者（不寫 ba_*，c2；`parents.user_id` 必填）。
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

const CLASSES = 60;
const SEATS = 20;
const MISSING = 300;
const DAY = '2031-03-03';
const DAY2 = '2031-03-04';

run('#2230 ③ 到班數與工作台家長走 pg', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const fx = { campus: '', parentPhone: null as string | null, contacted: '' };

  beforeAll(async () => {
    ctx.userId = (
      await q<{ user_id: string }>(
        "select user_id from user_roles where role = 'admin' order by user_id limit 1",
      )
    )[0]!.user_id;
    // 家長帳號用 seed 的管理員：**不能挑「全庫任一個 ba_user」**—— 平行跑時會挑到別的契約檔剛建、
    // 等一下要刪的暫時帳號（auth-google 因此撞 parents_user_id_fkey）。`parents.user_id` 必填、不寫 ba_*（c2）
    const [account] = await q<{ id: string; phone: string | null }>(
      'select id, phone from ba_user where id = $1',
      [ctx.userId],
    );
    fx.parentPhone = account!.phone;
    ctx.orgId = await one("insert into organizations (name) values ('#2230 契約：pg 讀取')", []);
    fx.campus = await one(
      "insert into campuses (org_id, name, attendance_mode) values ($1, 'c1', 'daily_checkin')",
      [ctx.orgId],
    );
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);

    // 班、課堂、報名一次建：第 n 班在 DAY（到班數）或 DAY2（工作台）有一堂
    const makeClasses = async (prefix: string, n: number, seats: number, date: string) => {
      const classIds: string[] = [];
      const studentIds: string[] = [];
      for (let i = 1; i <= n; i++) {
        const course = await one(
          'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
          [ctx.orgId, fx.campus, `${prefix} 課 ${i}`, subject],
        );
        const klass = await one(
          'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
          [ctx.orgId, fx.campus, course, `${prefix} 班 ${i}`],
        );
        classIds.push(klass);
        await q(
          `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
           values ($1, $2, $3, '18:00', '19:00', 'scheduled', 'unassigned')`,
          [ctx.orgId, klass, date],
        );
        const kids = (
          await q<{ id: string }>(
            `insert into students (org_id, name, grade)
             select $1, $2 || ' 生 ' || g, 'J1' from generate_series(1, ${seats}) g returning id`,
            [ctx.orgId, `${prefix}${i}`],
          )
        ).map((r) => r.id);
        await q(
          `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
           select $1, $2, s, 'active', 'monthly', 1000, '2030-01-01' from unnest($3::uuid[]) s`,
          [ctx.orgId, klass, kids],
        );
        studentIds.push(...kids);
      }
      return { classIds, studentIds };
    };

    // 1. DAY：全員到班
    const arrivals = await makeClasses('到', CLASSES, SEATS, DAY);
    await q(
      `insert into daily_checkins (org_id, student_id, checkin_date, campus_id)
       select $1, s, $2, $3 from unnest($4::uuid[]) s`,
      [ctx.orgId, DAY, fx.campus, arrivals.studentIds],
    );
    // 干擾：第 1 班一位退班的、當天也打了卡（不算）；第 2 班一位在籍、只在前一天打卡（不算）。
    // 退班一定寫 effective_to（#953：在籍只看生效區間，退班不再靠 status 排除）—— 退在 DAY 之前
    const extra = async (
      classId: string,
      status: string,
      checkinDate: string,
      effectiveTo: string | null = null,
    ) => {
      const sid = await one(
        "insert into students (org_id, name, grade) values ($1, '干擾', 'J1')",
        [ctx.orgId],
      );
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from, effective_to)
         values ($1, $2, $3, $4::enrollment_status, 'monthly', 1000, '2030-01-01', $5::date)`,
        [ctx.orgId, classId, sid, status, effectiveTo],
      );
      await q(
        'insert into daily_checkins (org_id, student_id, checkin_date, campus_id) values ($1, $2, $3, $4)',
        [ctx.orgId, sid, checkinDate, fx.campus],
      );
    };
    await extra(arrivals.classIds[0]!, 'withdrawal', DAY, '2031-03-02');
    await extra(arrivals.classIds[1]!, 'active', '2031-03-02');

    // 2. DAY2：MISSING 人該到沒到，全掛同一位主要家長；其中一位當天有一筆聯絡
    const missing = await makeClasses('缺', 3, MISSING / 3, DAY2);
    const parent = await one(
      "insert into parents (org_id, name, user_id) values ($1, '同一位家長', $2)",
      [ctx.orgId, account!.id],
    );
    await q(
      `insert into parent_student_relations (parent_id, student_id, relation, is_primary)
       select $1, s, '母親', true from unnest($2::uuid[]) s`,
      [parent, missing.studentIds],
    );
    fx.contacted = missing.studentIds[0]!;
    await q(
      `insert into contact_logs (org_id, student_id, channel, created_at)
       values ($1, $2, 'phone', $3::timestamptz)`,
      [ctx.orgId, fx.contacted, `${DAY2}T10:00:00+08:00`],
    );
    // 另一位只在前一天（台北時間）有聯絡：不算今天的
    await q(
      `insert into contact_logs (org_id, student_id, channel, created_at)
       values ($1, $2, 'line', $3::timestamptz)`,
      [ctx.orgId, missing.studentIds[1], `${DAY2}T07:59:00+08:00`.replace(DAY2, '2031-03-03')],
    );
    app = (await import('../index')).default as never;
  }, 240_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from contact_logs where org_id = $1',
      'delete from daily_checkins where org_id = $1',
      'delete from attendance_records where org_id = $1',
      'delete from events where org_id = $1',
      'delete from parent_student_relations where parent_id in (select id from parents where org_id = $1)',
      'delete from parents where org_id = $1',
      'delete from enrollments where org_id = $1',
      'delete from sessions where org_id = $1',
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

  it(`課堂列表：${CLASSES} 班 × ${SEATS} 人（報名 ${CLASSES * SEATS} 筆 > 1000）每堂到班數都是 ${SEATS}`, async () => {
    const body = await get<{
      data: Array<{ attendanceMode: string; checkedInCount: number | null }>;
    }>(`/api/attendance/sessions?date=${DAY}&pageSize=100`);
    expect(body.data).toHaveLength(CLASSES);
    expect(body.data.every((s) => s.attendanceMode === 'daily_checkin')).toBe(true);
    expect([...new Set(body.data.map((s) => s.checkedInCount))]).toEqual([SEATS]);
  });

  it(`工作台：${MISSING} 人該到沒到，每列都有主要家長與電話，今天聯絡過的那位有紀錄`, async () => {
    const body = await get<{
      expected: Array<{
        studentId: string;
        primaryParent: { name: string; relation: string | null; phone: string | null } | null;
        lastContact: { at: string; channel: string } | null;
      }>;
    }>(`/api/workbench/today?date=${DAY2}&campusId=${fx.campus}`);
    expect(body.expected).toHaveLength(MISSING);
    expect(
      body.expected.every(
        (s) =>
          s.primaryParent?.name === '同一位家長' &&
          s.primaryParent.relation === '母親' &&
          s.primaryParent.phone === fx.parentPhone,
      ),
    ).toBe(true);
    const contacted = body.expected.find((s) => s.studentId === fx.contacted);
    expect(contacted?.lastContact?.channel).toBe('phone');
    expect(new Date(contacted!.lastContact!.at).toISOString()).toBe('2031-03-04T02:00:00.000Z');
    expect(body.expected.filter((s) => s.lastContact !== null)).toHaveLength(1);
  });
});
