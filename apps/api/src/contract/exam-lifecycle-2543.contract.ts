// scope-contract: PATCH /api/academy-exams/:id/close
// scope-contract: PATCH /api/academy-exams/:id/reopen
// scope-contract: PATCH /api/school-exams/:id/close
// scope-contract: PATCH /api/school-exams/:id/reopen
// scope-contract: GET /api/school-exams/:id/students
// scope-contract: GET /api/school-exams/:id/recent-students
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2543 成績／考試生命週期**：close／reopen 的狀態機與誰能動、候選學生名單（`/:id/students`）、
 * 最近登錄名單（`/:id/recent-students`）。對真的本機 PostgREST＋Postgres 跑。
 *
 * 分校範圍另由 #2493 的兩支契約守，這裡不重複；這裡守的是：狀態只能 active↔closed 單向往返、
 * 老師只能動自己建的院內考、段考目錄只有管理員能動、別的機構的考試一律 404，以及名單的組成
 *（同校、在學、依狀態／搜尋／年級／分頁過濾；別場考試的成績不混進來）。
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

const ctx = { orgId: '', userId: '', roles: ['admin'] as string[] };

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
      set('roles', ctx.roles);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', ctx.roles[0]);
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

run('#2543 考試 close／reopen 與學生名單', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const one = async (sql: string, values: unknown[]) =>
    (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
  const orgs: string[] = [];
  const fx = {
    otherOrg: '',
    adminId: '',
    subject: '',
    sch: '',
    s1: '',
    s2: '',
    s3: '',
    s4: '',
    s5: '',
    s6: '',
    se: '',
    seClosed: '',
    seOther: '',
    aeMine: '',
    aeOthers: '',
    aeClosed: '',
    aeForeign: '',
  };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select user_id from user_roles where role = 'admin' order by user_id limit 1",
    );
    fx.adminId = admin!.user_id;
    ctx.userId = fx.adminId;
    ctx.orgId = await one(
      "insert into organizations (name) values ('#2543 契約：考試生命週期')",
      [],
    );
    fx.otherOrg = await one("insert into organizations (name) values ('#2543 契約：別的機構')", []);
    orgs.push(ctx.orgId, fx.otherOrg);
    fx.subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '國文',
    ]);
    const subject2 = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '數學',
    ]);
    fx.sch = await one("insert into schools (org_id, name) values ($1, 'S 國中')", [ctx.orgId]);
    const sch2 = await one("insert into schools (org_id, name) values ($1, 'T 國中')", [ctx.orgId]);
    const student = (name: string, grade: string, school: string, active = true) =>
      one(
        'insert into students (org_id, name, grade, school_id, is_active) values ($1, $2, $3, $4, $5)',
        [ctx.orgId, name, grade, school, active],
      );
    fx.s1 = await student('甲生', 'J2', fx.sch);
    fx.s2 = await student('乙生', 'J2', fx.sch);
    fx.s3 = await student('丙生', 'J3', fx.sch);
    fx.s4 = await student('丁生（已停用）', 'J2', fx.sch, false);
    fx.s5 = await student('戊生（別校）', 'J2', sch2);
    fx.s6 = await student('己生', 'J2', fx.sch);

    const schoolExam = (school: string, label: string, status: string, org = ctx.orgId) =>
      one(
        `insert into school_exams (org_id, academic_year, semester, exam_type, label, exam_date, school_id, status)
         values ($1, 115, 1, 'term_exam', $2, '2026-10-01', $3, $4)`,
        [org, label, school, status],
      );
    fx.se = await schoolExam(fx.sch, '期中', 'active');
    fx.seClosed = await schoolExam(fx.sch, '期末', 'closed');
    fx.seOther = await schoolExam(fx.sch, '第二次期中', 'active');
    const score = (
      exam: string,
      student: string,
      subject: string,
      status: string,
      updatedAt: string,
    ) =>
      q(
        `insert into school_scores (school_exam_id, student_id, subject_id, score, status, updated_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [exam, student, subject, status === 'absent' ? null : 70, status, updatedAt],
      );
    await score(fx.se, fx.s1, fx.subject, 'scored', '2026-10-02T10:00:00Z');
    await score(fx.se, fx.s1, subject2, 'scored', '2026-10-02T10:05:00Z');
    await score(fx.se, fx.s2, fx.subject, 'absent', '2026-10-02T11:00:00Z');
    await score(fx.se, fx.s6, fx.subject, 'makeup', '2026-10-02T09:00:00Z');
    // 別場考試的成績不能混進這場的名單
    await score(fx.seOther, fx.s3, fx.subject, 'scored', '2026-10-03T08:00:00Z');

    const academy = (createdBy: string | null, status: string, org = ctx.orgId) =>
      one(
        `insert into academy_exams (org_id, name, exam_date, status, created_by)
         values ($1, '小考', '2026-10-01', $2, $3)`,
        [org, status, createdBy],
      );
    fx.aeMine = await academy(fx.adminId, 'active');
    fx.aeOthers = await academy(fx.adminId, 'active');
    fx.aeClosed = await academy(fx.adminId, 'closed');
    fx.aeForeign = await academy(null, 'active', fx.otherOrg);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    for (const orgId of orgs) {
      for (const sql of [
        'delete from school_scores where school_exam_id in (select id from school_exams where org_id = $1)',
        'delete from school_exams where org_id = $1',
        'delete from academy_exams where org_id = $1',
        'delete from students where org_id = $1',
        'delete from schools where org_id = $1',
        'delete from subjects where org_id = $1',
        'delete from audit_logs where org_id = $1',
        'delete from organizations where id = $1',
      ]) {
        await q(sql, [orgId]);
      }
    }
  }, 120_000);

  const call = async (
    roles: string[],
    userId: string,
    method: string,
    path: string,
  ): Promise<Response> => {
    ctx.roles = roles;
    ctx.userId = userId;
    try {
      return await app.request(path, { method }, env);
    } finally {
      ctx.roles = ['admin'];
      ctx.userId = fx.adminId;
    }
  };
  const admin = (method: string, path: string) => call(['admin'], fx.adminId, method, path);
  const statusOf = async (table: 'academy_exams' | 'school_exams', id: string) =>
    (await q<{ status: string }>(`select status from ${table} where id = $1`, [id]))[0]!.status;
  const code = async (res: Response) => ((await res.json()) as { code?: string }).code;

  describe('院內考 close／reopen', () => {
    it('active → close → closed → reopen → active；重複 close／reopen 回 400 INVALID_STATUS 且狀態不動', async () => {
      const base = `/api/academy-exams/${fx.aeOthers}`;
      expect((await admin('PATCH', `${base}/reopen`)).status).toBe(400);
      expect((await admin('PATCH', `${base}/close`)).status).toBe(200);
      expect(await statusOf('academy_exams', fx.aeOthers)).toBe('closed');
      const again = await admin('PATCH', `${base}/close`);
      expect(again.status).toBe(400);
      expect(await code(again)).toBe('INVALID_STATUS');
      expect(await statusOf('academy_exams', fx.aeOthers)).toBe('closed');
      expect((await admin('PATCH', `${base}/reopen`)).status).toBe(200);
      expect(await statusOf('academy_exams', fx.aeOthers)).toBe('active');
    });

    it('老師只能動自己建的：別人建的 → 403 NOT_EXAM_OWNER、狀態不動；自己建的 → 200', async () => {
      const stranger = '00000000-0000-0000-0000-00000000dead';
      const denied = await call(
        ['teacher'],
        stranger,
        'PATCH',
        `/api/academy-exams/${fx.aeMine}/close`,
      );
      expect(denied.status).toBe(403);
      expect(await code(denied)).toBe('NOT_EXAM_OWNER');
      expect(await statusOf('academy_exams', fx.aeMine)).toBe('active');

      const own = await call(
        ['teacher'],
        fx.adminId,
        'PATCH',
        `/api/academy-exams/${fx.aeMine}/close`,
      );
      expect(own.status).toBe(200);
      expect(await statusOf('academy_exams', fx.aeMine)).toBe('closed');
      const reopen = await call(
        ['teacher'],
        fx.adminId,
        'PATCH',
        `/api/academy-exams/${fx.aeMine}/reopen`,
      );
      expect(reopen.status).toBe(200);
      expect(await statusOf('academy_exams', fx.aeMine)).toBe('active');
    });

    it('別的機構的考試 → 404、狀態不動', async () => {
      for (const action of ['close', 'reopen']) {
        const res = await admin('PATCH', `/api/academy-exams/${fx.aeForeign}/${action}`);
        expect(res.status).toBe(404);
      }
      expect(await statusOf('academy_exams', fx.aeForeign)).toBe('active');
    });

    it('已結束的考試不收 close', async () => {
      const res = await admin('PATCH', `/api/academy-exams/${fx.aeClosed}/close`);
      expect(res.status).toBe(400);
      expect(await statusOf('academy_exams', fx.aeClosed)).toBe('closed');
    });
  });

  describe('段考 close／reopen', () => {
    it('管理員 close → reopen 往返；重複與反向都是 400 INVALID_STATUS', async () => {
      const base = `/api/school-exams/${fx.seOther}`;
      expect((await admin('PATCH', `${base}/reopen`)).status).toBe(400);
      expect((await admin('PATCH', `${base}/close`)).status).toBe(200);
      expect(await statusOf('school_exams', fx.seOther)).toBe('closed');
      const again = await admin('PATCH', `${base}/close`);
      expect(again.status).toBe(400);
      expect(await code(again)).toBe('INVALID_STATUS');
      expect((await admin('PATCH', `${base}/reopen`)).status).toBe(200);
      expect(await statusOf('school_exams', fx.seOther)).toBe('active');
    });

    it('老師 close／reopen → 403 ORG_EXAM_ADMIN_ONLY，狀態不動', async () => {
      for (const [id, action, expected] of [
        [fx.se, 'close', 'active'],
        [fx.seClosed, 'reopen', 'closed'],
      ] as const) {
        const res = await call(
          ['teacher'],
          fx.adminId,
          'PATCH',
          `/api/school-exams/${id}/${action}`,
        );
        expect(res.status).toBe(403);
        expect(await code(res)).toBe('ORG_EXAM_ADMIN_ONLY');
        expect(await statusOf('school_exams', id)).toBe(expected);
      }
    });

    it('別的機構的 org 看不到這場：對方 ctx 去 close → 404', async () => {
      ctx.orgId = fx.otherOrg;
      try {
        const res = await admin('PATCH', `/api/school-exams/${fx.se}/close`);
        expect(res.status).toBe(404);
      } finally {
        ctx.orgId = orgs[0]!;
      }
      expect(await statusOf('school_exams', fx.se)).toBe('active');
    });
  });

  describe('GET /school-exams/:id/students（候選學生名單）', () => {
    type Row = { studentId: string; scoreCount: number };
    const list = async (query = '') => {
      const res = await admin('GET', `/api/school-exams/${fx.se}/students${query}`);
      expect(res.status).toBe(200);
      return (await res.json()) as {
        data: Row[];
        meta: { total: number; page: number; pageSize: number };
      };
    };
    const idsOf = (rows: Row[]) => rows.map((r) => r.studentId).sort();

    it('只有該校、在學的學生；別校與已停用的不在名單', async () => {
      const { data, meta } = await list();
      expect(idsOf(data)).toEqual([fx.s1, fx.s2, fx.s3, fx.s6].sort());
      expect(meta.total).toBe(4);
    });

    it('scoreCount 只算這一場；別場的成績不混進來', async () => {
      const { data } = await list();
      const count = (id: string) => data.find((r) => r.studentId === id)!.scoreCount;
      expect(count(fx.s1)).toBe(2);
      expect(count(fx.s2)).toBe(1);
      expect(count(fx.s3)).toBe(0);
    });

    it('status 篩選：pending／scored／absent／makeup', async () => {
      expect(idsOf((await list('?status=pending')).data)).toEqual([fx.s3]);
      expect(idsOf((await list('?status=scored')).data)).toEqual([fx.s1]);
      expect(idsOf((await list('?status=absent')).data)).toEqual([fx.s2]);
      expect(idsOf((await list('?status=makeup')).data)).toEqual([fx.s6]);
    });

    it('search 比對姓名、grade 比對年級', async () => {
      expect(idsOf((await list(`?search=${encodeURIComponent('乙')}`)).data)).toEqual([fx.s2]);
      expect(idsOf((await list('?grade=J3')).data)).toEqual([fx.s3]);
    });

    it('分頁：total 是篩選後總數、data 只有一頁', async () => {
      const first = await list('?pageSize=3&page=1');
      const second = await list('?pageSize=3&page=2');
      expect(first.meta.total).toBe(4);
      expect(first.data).toHaveLength(3);
      expect(second.data).toHaveLength(1);
      expect(idsOf([...first.data, ...second.data])).toEqual([fx.s1, fx.s2, fx.s3, fx.s6].sort());
    });

    it('別的機構的考試 → 404', async () => {
      ctx.orgId = fx.otherOrg;
      try {
        expect((await admin('GET', `/api/school-exams/${fx.se}/students`)).status).toBe(404);
      } finally {
        ctx.orgId = orgs[0]!;
      }
    });
  });

  describe('GET /school-exams/:id/recent-students', () => {
    it('每位學生一列、scoreCount 是他在這場的筆數、最近登錄的排前面；別場的成績不算', async () => {
      const res = await admin('GET', `/api/school-exams/${fx.se}/recent-students`);
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as {
        data: Array<{ studentId: string; scoreCount: number }>;
      };
      expect(data.map((r) => [r.studentId, r.scoreCount])).toEqual([
        [fx.s2, 1],
        [fx.s1, 2],
        [fx.s6, 1],
      ]);
    });

    it('別的機構的考試 → 404', async () => {
      ctx.orgId = fx.otherOrg;
      try {
        expect((await admin('GET', `/api/school-exams/${fx.se}/recent-students`)).status).toBe(404);
      } finally {
        ctx.orgId = orgs[0]!;
      }
    });
  });
});
