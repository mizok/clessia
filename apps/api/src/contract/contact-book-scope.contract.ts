import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **聯絡簿三支 GET 套分校範圍**（#1994），對真的本機 PostgREST 跑 —— 範圍條件在 join 裡
 * （`scope_student:students!inner(enrollments!inner(classes!inner(campus_id)))`），替身不解析 embed 的過濾，量不到。
 *
 * 自建一個 org：兩個分校各一個開聯絡簿的班；a 只在 C1、b 只在 C2、ab 兩邊都有。
 * 受限 C1 的管理員：列表只看得到 a 與 ab 的聯絡簿；缺漏名單與統計裡沒有 b；
 * 空範圍什麼都看不到。測完整個 org 刪掉。
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
      set('supabase', supabase);
      set('orgId', ctx.orgId);
      set('userId', ctx.userId);
      set('roles', ['admin']);
      set('permissions', [...PERMISSIONS]);
      set('activeRole', 'admin');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', ctx.campusScope);
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

run('聯絡簿三支 GET 的分校範圍（#1994）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const WRITTEN = '2026-09-01';
  const MISSING = '2026-09-02';
  const fx = { c1: '', c2: '', a: '', b: '', ab: '', q: '', c1Class: '', c2Class: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#1994 契約：聯絡簿分校範圍') returning id",
      )
    )[0]!.id;
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '國語') returning id",
      [ctx.orgId],
    );
    const klass: Record<string, string> = {};
    for (const key of ['c1', 'c2'] as const) {
      const [campus] = await q<{ id: string }>(
        'insert into campuses (org_id, name) values ($1, $2) returning id',
        [ctx.orgId, key],
      );
      fx[key] = campus!.id;
      const [course] = await q<{ id: string }>(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4) returning id',
        [ctx.orgId, campus!.id, `國語 ${key}`, subject!.id],
      );
      const [k] = await q<{ id: string }>(
        `insert into classes (org_id, campus_id, course_id, name, uses_contact_book)
         values ($1, $2, $3, $4, true) returning id`,
        [ctx.orgId, campus!.id, course!.id, `班 ${key}`],
      );
      klass[key] = k!.id;
      // 兩天都有課：缺漏名單只算「那天有課」的班
      for (const date of [WRITTEN, MISSING]) {
        await q(
          `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
           values ($1, $2, $3, '18:00', '19:00', 'scheduled', 'unassigned')`,
          [ctx.orgId, k!.id, date],
        );
      }
    }
    const student = async (name: string, classes: string[]) => {
      const [s] = await q<{ id: string }>(
        "insert into students (org_id, name, grade) values ($1, $2, 'P5') returning id",
        [ctx.orgId, name],
      );
      for (const k of classes) {
        await q(
          `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
           values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
          [ctx.orgId, k, s!.id],
        );
      }
      // WRITTEN 那天每個人都寫了；MISSING 那天都沒寫
      await q(
        `insert into contact_book_entries (org_id, student_id, entry_date, content)
         values ($1, $2, $3, $4)`,
        [ctx.orgId, s!.id, WRITTEN, `${name} 的聯絡簿`],
      );
      return s!.id;
    };
    fx.c1Class = klass['c1']!;
    fx.c2Class = klass['c2']!;
    fx.a = await student('只在一校', [klass['c1']!]);
    fx.b = await student('只在二校', [klass['c2']!]);
    fx.ab = await student('兩校都有', [klass['c1']!, klass['c2']!]);
    // #2080-2：c1 那天的課排給一位上課老師（c2 那堂沒排）
    const [teacher] = await q<{ id: string }>(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '游佩珊') returning id",
      [ctx.orgId, ctx.userId],
    );
    await q(
      `update sessions set teacher_id = $1, assignment_status = 'assigned'
       where org_id = $2 and class_id = $3 and session_date = $4`,
      [teacher!.id, ctx.orgId, klass['c1'], MISSING],
    );
    // 二讀（#2180）：c2 那堂也排一位老師 —— 受限 C1 不能看到這個名字
    const [other] = await q<{ user_id: string }>(
      'select user_id from user_roles where user_id <> $1 order by user_id limit 1',
      [ctx.userId],
    );
    const [teacher2] = await q<{ id: string }>(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '二校老師') returning id",
      [ctx.orgId, other!.user_id],
    );
    await q(
      `update sessions set teacher_id = $1, assignment_status = 'assigned'
       where org_id = $2 and class_id = $3 and session_date = $4`,
      [teacher2!.id, ctx.orgId, klass['c2'], MISSING],
    );
    // 「C1 有報名、但那班當天沒課；當天有課的只有 C2 那班」的學生（不寫聯絡簿，不影響列表那幾條）
    const [campus1Quiet] = await q<{ id: string }>(
      `insert into classes (org_id, campus_id, course_id, name, uses_contact_book)
       select org_id, campus_id, course_id, '班 c1 今天沒課', true from classes where id = $1 returning id`,
      [klass['c1']],
    );
    const [qs] = await q<{ id: string }>(
      "insert into students (org_id, name, grade) values ($1, '一校沒課二校有課', 'P5') returning id",
      [ctx.orgId],
    );
    fx.q = qs!.id;
    for (const k of [campus1Quiet!.id, klass['c2']!]) {
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, k, fx.q],
      );
    }
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from contact_book_entries where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from staff where org_id = $1',
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

  const get = async <T>(path: string, scope: 'all' | 'c1' | 'none') => {
    ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
    try {
      const res = await app.request(path, {}, env);
      expect(res.status).toBe(200);
      return (await res.json()) as T;
    } finally {
      ctx.campusScope = null;
    }
  };
  type List = { data: Array<{ studentId: string; content: string }>; meta: { total: number } };
  type Missing = {
    data: Array<{
      studentId: string;
      classes: Array<{ classId: string; teacherNames: string[]; studentCount: number }>;
    }>;
    meta: { total: number };
  };
  type Summary = { data: Array<{ date: string; missingCount: number }> };

  it('列表：受限 C1 只看得到 C1 學生（含跨校的）的聯絡簿，別校的內容不出現', async () => {
    const path = `/api/contact-book?from=${WRITTEN}&to=${WRITTEN}`;
    const all = await get<List>(path, 'all');
    expect(new Set(all.data.map((r) => r.studentId))).toEqual(new Set([fx.a, fx.b, fx.ab]));

    const c1 = await get<List>(path, 'c1');
    expect(new Set(c1.data.map((r) => r.studentId))).toEqual(new Set([fx.a, fx.ab]));
    expect(c1.meta.total).toBe(2);
    expect(JSON.stringify(c1)).not.toContain('只在二校');

    const none = await get<List>(path, 'none');
    expect(none).toEqual({ data: [], meta: { total: 0 } });
  });

  it('缺漏名單：受限 C1 的名單裡沒有只在 C2 的學生', async () => {
    const path = `/api/contact-book/missing?date=${MISSING}`;
    const all = await get<Missing>(path, 'all');
    expect(all.data.map((r) => r.studentId)).toContain(fx.b);

    const c1 = await get<Missing>(path, 'c1');
    const ids = new Set(c1.data.map((r) => r.studentId));
    expect(ids.has(fx.b)).toBe(false);
    expect(ids.has(fx.a)).toBe(true);
    expect(ids.has(fx.ab)).toBe(true);

    expect((await get<Missing>(path, 'none')).data).toEqual([]);
  });

  // #2080-2：每班的上課老師（sessions.teacher_id → 本 org 的 staff）與該寫人數（範圍內的候選）
  it('缺漏名單每班帶上課老師與人數：人數是範圍內在這班的人', async () => {
    const all = await get<Missing>(`/api/contact-book/missing?date=${MISSING}`, 'all');
    const byClass = new Map(all.data.flatMap((r) => r.classes).map((k) => [k.classId, k]));
    expect(byClass.get(fx.c1Class)).toMatchObject({ teacherNames: ['游佩珊'], studentCount: 2 });
    expect(byClass.get(fx.c2Class)).toMatchObject({ teacherNames: ['二校老師'], studentCount: 3 });

    const c1 = await get<Missing>(`/api/contact-book/missing?date=${MISSING}`, 'c1');
    const c1Classes = c1.data.flatMap((r) => r.classes);
    expect(c1Classes.find((k) => k.classId === fx.c1Class)).toMatchObject({ studentCount: 2 });
  });

  // 二讀（#2180）：範圍看的是「這筆報名的班」的分校，不是「學生任一報名在範圍內」——
  // 否則跨校學生在別校那班的班名、上課老師、人數都會跟著露出去（班名在 main 上原本就會漏）
  it('缺漏名單（受限 C1）：跨校學生只露出 C1 的班，別校的班名與上課老師都不出現', async () => {
    const c1 = await get<Missing>(`/api/contact-book/missing?date=${MISSING}`, 'c1');
    const ab = c1.data.find((r) => r.studentId === fx.ab)!;
    expect(ab.classes.map((k) => k.classId)).toEqual([fx.c1Class]);
    expect(c1.data.flatMap((r) => r.classes).some((k) => k.classId === fx.c2Class)).toBe(false);
    expect(JSON.stringify(c1)).not.toContain('班 c2');
    expect(JSON.stringify(c1)).not.toContain('二校老師');
  });

  it('缺漏名單（受限 C1）：C1 那班當天沒課、只有 C2 那班有課的學生，不算進 C1 的缺漏', async () => {
    const all = await get<Missing>(`/api/contact-book/missing?date=${MISSING}`, 'all');
    expect(all.data.map((r) => r.studentId)).toContain(fx.q);
    const c1 = await get<Missing>(`/api/contact-book/missing?date=${MISSING}`, 'c1');
    expect(c1.data.map((r) => r.studentId)).not.toContain(fx.q);
  });

  it('缺漏統計：受限 C1 的數字等於它自己的缺漏名單，不含只在 C2 的學生', async () => {
    const path = `/api/contact-book/missing/summary?dateFrom=${MISSING}&dateTo=${MISSING}`;
    const all = await get<Summary>(path, 'all');
    const c1 = await get<Summary>(path, 'c1');
    const c1List = await get<Missing>(`/api/contact-book/missing?date=${MISSING}`, 'c1');
    expect(c1.data).toEqual([{ date: MISSING, missingCount: c1List.meta.total }]);
    expect(c1.data[0]!.missingCount).toBeLessThan(all.data[0]!.missingCount);
    expect(await get<Summary>(path, 'none')).toMatchObject({
      data: [{ date: MISSING, missingCount: 0 }],
    });
  });

  // 一個分校都沒被指派（scope=[]）：三支都提前回空（不下 `.in(…, [])`），200 不是 400
  it('一個分校都沒被指派（scope=[]）：列表、缺漏名單、統計都是空的', async () => {
    expect(await get<List>(`/api/contact-book?from=${WRITTEN}&to=${WRITTEN}`, 'none')).toEqual({
      data: [],
      meta: { total: 0 },
    });
    const missing = await get<Missing>(`/api/contact-book/missing?date=${MISSING}`, 'none');
    expect(missing.data).toEqual([]);
    expect(missing.meta.total).toBe(0);
    const summary = await get<Summary>(
      `/api/contact-book/missing/summary?dateFrom=${MISSING}&dateTo=${MISSING}`,
      'none',
    );
    expect(summary.data.every((d) => d.missingCount === 0)).toBe(true);
  });

  // K4（#1314 盤點）：頂欄「切換分校」要的 `campusId`。指名只能縮小範圍，撐不大它
  describe('campusId（頂欄分校）', () => {
    const status = async (path: string, scope: 'all' | 'c1') => {
      ctx.campusScope = scope === 'all' ? null : [fx.c1];
      try {
        return (await app.request(path, {}, env)).status;
      } finally {
        ctx.campusScope = null;
      }
    };
    const paths = () => [
      `/api/contact-book?from=${WRITTEN}&to=${WRITTEN}`,
      `/api/contact-book/missing?date=${MISSING}`,
      `/api/contact-book/missing/summary?dateFrom=${MISSING}&dateTo=${MISSING}`,
    ];

    it('不受限的管理員指名 C2：列表與缺漏名單只剩 C2 的學生（含跨校的），統計跟著名單', async () => {
      const list = await get<List>(
        `/api/contact-book?from=${WRITTEN}&to=${WRITTEN}&campusId=${fx.c2}`,
        'all',
      );
      expect(new Set(list.data.map((r) => r.studentId))).toEqual(new Set([fx.b, fx.ab]));
      expect(list.meta.total).toBe(2);

      const missing = await get<Missing>(
        `/api/contact-book/missing?date=${MISSING}&campusId=${fx.c2}`,
        'all',
      );
      const ids = new Set(missing.data.map((r) => r.studentId));
      expect(ids.has(fx.a)).toBe(false);
      expect(ids.has(fx.b)).toBe(true);

      const summary = await get<Summary>(
        `/api/contact-book/missing/summary?dateFrom=${MISSING}&dateTo=${MISSING}&campusId=${fx.c2}`,
        'all',
      );
      expect(summary.data).toEqual([{ date: MISSING, missingCount: missing.meta.total }]);
    });

    it('受限 C1 指名自己的 C1：跟不帶一樣', async () => {
      const list = await get<List>(
        `/api/contact-book?from=${WRITTEN}&to=${WRITTEN}&campusId=${fx.c1}`,
        'c1',
      );
      expect(new Set(list.data.map((r) => r.studentId))).toEqual(new Set([fx.a, fx.ab]));
    });

    it('受限 C1 指名別校 C2：三支都 403，撐不大範圍', async () => {
      for (const path of paths()) {
        expect(await status(`${path}&campusId=${fx.c2}`, 'c1')).toBe(403);
      }
    });
  });
});
