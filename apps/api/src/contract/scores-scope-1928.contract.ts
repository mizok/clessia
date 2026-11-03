import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **#1928：成績讀取的範圍在 DB 端篩，不把範圍內學生 id 塞進 URL**（保留類：授權範圍），對真的本機 PostgREST 跑。
 *
 * 原本 `resolveScoreScope` 先撈「分校範圍內所有報名過的學生」（老師：任課班的學生）再 `.in('student_id', …)`：
 * 一個分校兩三百位學生就 414，而 GET /scores 只 `console.error`、那一半整個消失照回 200。
 * fixture：C1 那班 260 位＋一位跨校（C1、C2 都有）、C2 一位只在二校；兩場校內考各掛一班，一場段考全員都有。
 * 三種身分（不受限管理員、受限 C1 管理員、只教 C1 那班的老師）各斷言一次範圍與筆數，跨校不可見。
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

type Who = 'admin' | 'c1' | 'teacher';
const ctx = {
  orgId: '',
  adminUser: '',
  teacherUser: '',
  who: 'admin' as Who,
  campusScope: null as string[] | null,
  /** 把這張表換成不存在的名字 —— 範圍查詢真的從 PostgREST 拿到錯誤 */
  failTable: null as string | null,
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
      const teacher = ctx.who === 'teacher';
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set(
        'supabase',
        new Proxy(supabase, {
          get(target, prop) {
            if (prop === 'from') {
              return (table: string) =>
                target.from(table === ctx.failTable ? 'contract_no_such_table' : table);
            }
            const value = Reflect.get(target, prop) as unknown;
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }),
      );
      set('orgId', ctx.orgId);
      set('userId', teacher ? ctx.teacherUser : ctx.adminUser);
      set('roles', [teacher ? 'teacher' : 'admin']);
      set('permissions', teacher ? [] : [...PERMISSIONS]);
      set('activeRole', teacher ? 'teacher' : 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.who === 'c1' ? ctx.campusScope : null);
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const BIG = 260;

run('#1928 成績讀取的範圍在 DB 端篩（GET /scores、/scores/students）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const TODAY = getCurrentTaipeiDateString();
  const fx = { c1: '', c2: '', k1: '', k2: '', ab: '', b: '' };

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
    ctx.orgId = await one("insert into organizations (name) values ('#1928 契約：成績範圍')", []);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    const klass: Record<string, string> = {};
    for (const key of ['c1', 'c2'] as const) {
      fx[key] = await one('insert into campuses (org_id, name) values ($1, $2)', [ctx.orgId, key]);
      const course = await one(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
        [ctx.orgId, fx[key], `數學 ${key}`, subject],
      );
      klass[key] = await one(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4)',
        [ctx.orgId, fx[key], course, `班 ${key}`],
      );
    }
    fx.k1 = klass['c1']!;
    fx.k2 = klass['c2']!;
    const staff = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '一校老師')",
      [ctx.orgId, ctx.teacherUser],
    );
    await q(
      `insert into schedules (class_id, weekday, start_time, end_time, teacher_id, effective_from)
       values ($1, 1, '18:00', '19:00', $2, '2026-01-01')`,
      [fx.k1, staff],
    );
    const enroll = (studentIds: string[], classId: string) =>
      q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         select $1, $2, unnest($3::uuid[]), 'active', 'monthly', 1000, '2026-01-01'`,
        [ctx.orgId, classId, studentIds],
      );
    const big = (
      await q<{ id: string }>(
        `insert into students (org_id, name, grade)
         select $1, '大分校生 ' || n, 'J2' from generate_series(1, ${BIG}) n returning id`,
        [ctx.orgId],
      )
    ).map((r) => r.id);
    fx.ab = await one("insert into students (org_id, name, grade) values ($1, '兩校都有', 'J2')", [
      ctx.orgId,
    ]);
    fx.b = await one("insert into students (org_id, name, grade) values ($1, '只在二校', 'J2')", [
      ctx.orgId,
    ]);
    await enroll([...big, fx.ab], fx.k1);
    await enroll([fx.ab, fx.b], fx.k2);

    // 校內考：e1 掛 C1 那班（C1 的 261 位）、e2 掛 C2 那班（ab、b）
    for (const [cls, name, students] of [
      [fx.k1, '一校小考', [...big, fx.ab]],
      [fx.k2, '二校小考', [fx.ab, fx.b]],
    ] as const) {
      const exam = await one(
        'insert into academy_exams (org_id, campus_id, name, exam_date, subject_id) values ($1, $2, $3, $4, $5)',
        [ctx.orgId, cls === fx.k1 ? fx.c1 : fx.c2, name, TODAY, subject],
      );
      await q('insert into academy_exam_classes (exam_id, class_id) values ($1, $2)', [exam, cls]);
      await q(
        `insert into academy_scores (exam_id, student_id, score, status)
         select $1, unnest($2::uuid[]), 80, 'scored'`,
        [exam, students],
      );
    }
    // 段考：學生層級，全員都有
    const school = await one('insert into schools (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '#1928 國中',
    ]);
    const schoolExam = await one(
      `insert into school_exams (org_id, academic_year, semester, exam_type, label, exam_date, school_id)
       values ($1, 115, 1, 'term_exam', '#1928 段考', $2, $3)`,
      [ctx.orgId, TODAY, school],
    );
    await q(
      `insert into school_scores (school_exam_id, student_id, subject_id, score, status)
       select $1, unnest($2::uuid[]), $3, 70, 'scored'`,
      [schoolExam, [...big, fx.ab, fx.b], subject],
    );
    ctx.campusScope = [fx.c1];
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from school_scores where school_exam_id in (select id from school_exams where org_id = $1)',
      'delete from school_exams where org_id = $1',
      'delete from schools where org_id = $1',
      'delete from academy_scores where exam_id in (select id from academy_exams where org_id = $1)',
      'delete from academy_exam_classes where exam_id in (select id from academy_exams where org_id = $1)',
      'delete from academy_exams where org_id = $1',
      'delete from enrollments where org_id = $1',
      'delete from students where org_id = $1',
      'delete from schedules where class_id in (select id from classes where org_id = $1)',
      'delete from classes where org_id = $1',
      'delete from courses where org_id = $1',
      'delete from subjects where org_id = $1',
      'delete from staff where org_id = $1',
      'delete from campuses where org_id = $1',
      'delete from audit_logs where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  const as = async (who: Who, path: string) => {
    ctx.who = who;
    try {
      return await app.request(`/api${path}`, {}, env);
    } finally {
      ctx.who = 'admin';
    }
  };
  type List = {
    data: Array<{ studentId: string; studentName: string; type: string; examName?: string }>;
    meta: { total: number };
  };
  const list = async (who: Who, path: string) => {
    const res = await as(who, path);
    expect(res.status).toBe(200);
    return (await res.json()) as List;
  };
  const total = async (who: Who, type: 'academy' | 'school') =>
    (await list(who, `/scores?type=${type}&pageSize=1`)).meta.total;

  // C1 的 261 位（260＋跨校的 ab）、C2 只在二校的 b
  const IN_C1 = BIG + 1;

  it('不受限的管理員：校內考 263 筆（261＋ab 與 b 在二校那場）、段考 262 筆', async () => {
    expect(await total('admin', 'academy')).toBe(IN_C1 + 2);
    expect(await total('admin', 'school')).toBe(IN_C1 + 1);
  });

  it('受限 C1 的管理員：學生數破 250 也照樣 200、筆數齊（不再 414 後靜默少一半）', async () => {
    // 學生任一筆報名在範圍內就算（#1115）：ab 在二校那場的校內考也看得到；只在二校的 b 一筆都沒有
    expect(await total('c1', 'academy')).toBe(IN_C1 + 1);
    expect(await total('c1', 'school')).toBe(IN_C1);
    const both = await list('c1', '/scores?pageSize=1');
    expect(both.meta.total).toBe(IN_C1 + 1 + IN_C1);
  });

  it('受限 C1 的管理員：只在二校的學生（b）完全看不到，搜尋也搜不到', async () => {
    const all = await list('admin', `/scores?search=${encodeURIComponent('只在二校')}`);
    expect(all.meta.total).toBe(2); // b 的二校小考＋段考
    const c1 = await list('c1', `/scores?search=${encodeURIComponent('只在二校')}`);
    expect(c1.meta.total).toBe(0);
  });

  // 計畫席讀 diff 時要求：搜尋（embed 上的 ilike）跟範圍（另一條 !inner）一起生效，不是其中一個蓋掉另一個
  it('受限 C1 的管理員搜尋：C1 學生名、C1 考試名有結果；二校考試名只剩範圍內的跨校學生', async () => {
    // 學生名：只有那一位（校內考＋段考各一筆）
    const name = await list('c1', `/scores?search=${encodeURIComponent(`大分校生 ${BIG}`)}`);
    expect(name.meta.total).toBe(2);
    expect(new Set(name.data.map((r) => r.studentName))).toEqual(new Set([`大分校生 ${BIG}`]));
    // 考試名：一校小考是 C1 那 261 位
    const exam = await list('c1', `/scores?search=${encodeURIComponent('一校小考')}`);
    expect(exam.meta.total).toBe(IN_C1);
    // 二校小考：不受限有 ab、b 兩筆；受限 C1 只剩 ab（b 不在範圍）
    expect(
      (await list('admin', `/scores?search=${encodeURIComponent('二校小考')}`)).meta.total,
    ).toBe(2);
    const other = await list('c1', `/scores?search=${encodeURIComponent('二校小考')}`);
    expect(other.meta.total).toBe(1);
    expect(other.data.map((r) => r.studentId)).toEqual([fx.ab]);
  });

  it('老師（只教 C1 那班）：學生數破 250 也照樣 200；校內考只有任課班那場、段考是任課班的學生', async () => {
    expect(await total('teacher', 'academy')).toBe(IN_C1);
    expect(await total('teacher', 'school')).toBe(IN_C1);
    const exams = await list(
      'teacher',
      `/scores?type=academy&search=${encodeURIComponent('二校小考')}`,
    );
    expect(exams.meta.total).toBe(0);
  });

  it('/scores/students?scope=all：受限 C1 與老師都是 200、學生數是範圍內那 261 位', async () => {
    for (const who of ['c1', 'teacher'] as const) {
      const res = await as(who, '/scores/students?scope=all&pageSize=1');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { meta: { total: number } };
      expect(body.meta.total).toBe(IN_C1);
    }
    const res = await as('admin', '/scores/students?scope=all&pageSize=1');
    expect(((await res.json()) as { meta: { total: number } }).meta.total).toBe(IN_C1 + 1);
  });

  // 裁定：範圍查詢不准吞錯 —— 校內考或段考那一半讀失敗要 500，不能少一半照回 200
  it('GET /scores 讀其中一半失敗：回 500，不是少一半的 200', async () => {
    for (const table of ['academy_scores', 'school_scores']) {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      ctx.failTable = table;
      try {
        expect((await as('c1', '/scores?pageSize=1')).status).toBe(500);
      } finally {
        ctx.failTable = null;
        log.mockRestore();
      }
    }
  });
});
