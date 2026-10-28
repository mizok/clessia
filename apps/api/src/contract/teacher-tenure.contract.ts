import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { createServiceClientFromEnv } from '../lib/supabase';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * **任課判定看日期**（#2049，計畫席 10-28 裁定 R2），對真的本機 PostgREST 跑 ——
 * 列表的條件是 `.or(and(class_id.eq.X,log_date.gte.F,...))`，替身不解析它。
 *
 * 一個班 K、一位學生 S。老師 A 教到 X−1（前任，像 split 從 X 起換老師），老師 B 從 X 起（現任）。
 * 每種資料各一筆在 X 之前（BEFORE）、一筆在 X 之後（AFTER）。守三件事：
 * 1. **現任 B 什麼都不少**：每支都看得到 BEFORE 與 AFTER（接手的人要看得到前任的歷史）
 * 2. **前任 A 只限任期**：有日期的只看得到 BEFORE；沒有日期的（名冊、學生詳情、以學生為單位的成績）看不到
 * 3. **前任唯讀**：A 寫任期內的日期也是 403
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
      set('roles', ['teacher']);
      set('permissions', []);
      set('activeRole', 'teacher');
      set('studentScope', null);
      set('childDb', createChildDb(supabase as never, null, ctx.orgId));
      set('campusScope', null);
      set('selfRows', { staff: null, parent: null, assignedCampusIds: [] });
      await next();
    }),
  };
});

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

run('任課判定看日期：現任不少、前任只限任期且唯讀（#2049）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const TODAY = getCurrentTaipeiDateString();
  const X = shift(TODAY, -15);
  const BEFORE = shift(TODAY, -20);
  const AFTER = shift(TODAY, -5);
  const fx = {
    userA: '',
    userB: '',
    klass: '',
    student: '',
    examBefore: '',
    examAfter: '',
  };

  beforeAll(async () => {
    const users = await q<{ user_id: string }>(
      "select distinct user_id from user_roles where role = 'teacher' order by user_id limit 2",
    );
    [fx.userA, fx.userB] = users.map((u) => u.user_id) as [string, string];
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2049 契約：任課看日期') returning id",
      )
    )[0]!.id;
    const one = async (sql: string, values: unknown[]) =>
      (await q<{ id: string }>(`${sql} returning id`, values))[0]!.id;
    const campus = await one('insert into campuses (org_id, name) values ($1, $2)', [
      ctx.orgId,
      'c',
    ]);
    const subject = await one('insert into subjects (org_id, name) values ($1, $2)', [
      ctx.orgId,
      '國語',
    ]);
    const course = await one(
      'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4)',
      [ctx.orgId, campus, '國語', subject],
    );
    fx.klass = await one(
      `insert into classes (org_id, campus_id, course_id, name, uses_contact_book)
       values ($1, $2, $3, '換老師的班', true)`,
      [ctx.orgId, campus, course],
    );
    const staffA = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '前任 A')",
      [ctx.orgId, fx.userA],
    );
    const staffB = await one(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '現任 B')",
      [ctx.orgId, fx.userB],
    );
    // split 的形狀：同一個時段，A 到 X−1、B 從 X 起
    await q(
      `insert into schedules (class_id, weekday, start_time, end_time, teacher_id, effective_from, effective_to)
       values ($1, 1, '18:00', '19:00', $2, $3, $4), ($1, 1, '18:00', '19:00', $5, $6, null)`,
      [fx.klass, staffA, shift(TODAY, -100), shift(X, -1), staffB, X],
    );
    fx.student = await one(
      "insert into students (org_id, name, grade) values ($1, '換班學生', 'P5')",
      [ctx.orgId],
    );
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'monthly', 1000, $4)`,
      [ctx.orgId, fx.klass, fx.student, shift(TODAY, -100)],
    );
    for (const [date, label] of [
      [BEFORE, 'before'],
      [AFTER, 'after'],
    ] as const) {
      await q(
        `insert into class_logs (org_id, class_id, log_date, teaching_record) values ($1, $2, $3, $4)`,
        [ctx.orgId, fx.klass, date, label],
      );
      await q(
        `insert into contact_book_entries (org_id, student_id, entry_date, content) values ($1, $2, $3, $4)`,
        [ctx.orgId, fx.student, date, label],
      );
      const exam = await one(
        'insert into academy_exams (org_id, name, exam_date) values ($1, $2, $3)',
        [ctx.orgId, label, date],
      );
      await q('insert into academy_exam_classes (exam_id, class_id) values ($1, $2)', [
        exam,
        fx.klass,
      ]);
      await q('insert into academy_scores (exam_id, student_id, score) values ($1, $2, 80)', [
        exam,
        fx.student,
      ]);
      if (label === 'before') fx.examBefore = exam;
      else fx.examAfter = exam;
      const session = await one(
        `insert into sessions (org_id, class_id, session_date, start_time, end_time, status, assignment_status)
         values ($1, $2, $3, '18:00', '19:00', 'scheduled', 'unassigned')`,
        [ctx.orgId, fx.klass, date],
      );
      await q(
        `insert into schedule_changes (org_id, session_id, change_type, reason) values ($1, $2, 'time_change', $3)`,
        [ctx.orgId, session, label],
      );
    }
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from schedule_changes where org_id = $1',
      'delete from sessions where org_id = $1',
      'delete from academy_scores where exam_id in (select id from academy_exams where org_id = $1)',
      'delete from academy_exam_classes where exam_id in (select id from academy_exams where org_id = $1)',
      'delete from academy_exams where org_id = $1',
      'delete from contact_book_entries where org_id = $1',
      'delete from class_logs where org_id = $1',
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

  const as = async (who: 'A' | 'B', path: string, init?: RequestInit) => {
    ctx.userId = who === 'A' ? fx.userA : fx.userB;
    const res = await app.request(path, init, env);
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  const labels = (rows: Array<Record<string, unknown>>, key: string) =>
    rows.map((r) => r[key]).sort();
  // 課務異動一次最多 31 天；BEFORE、AFTER 都在這段裡
  const range = `from=${shift(TODAY, -25)}&to=${TODAY}`;

  it('教務日誌列表：B 兩篇都在；A 只有任期內那篇', async () => {
    const b = await as('B', `/api/class-logs?${range}`);
    expect(labels(b.body.data, 'teachingRecord')).toEqual(['after', 'before']);
    const a = await as('A', `/api/class-logs?${range}`);
    expect(labels(a.body.data, 'teachingRecord')).toEqual(['before']);
    expect(a.body.meta.total).toBe(1);
  });

  it('聯絡簿列表：B 兩天都在；A 只有任期內那天', async () => {
    const b = await as('B', `/api/contact-book?${range}`);
    expect(labels(b.body.data, 'content')).toEqual(['after', 'before']);
    const a = await as('A', `/api/contact-book?${range}`);
    expect(labels(a.body.data, 'content')).toEqual(['before']);
  });

  it('課務異動：B 兩筆都在；A 只有任期內那堂', async () => {
    const b = await as('B', `/api/teacher/session-changes?${range}`);
    expect(b.status).toBe(200);
    expect(labels(b.body.data, 'reason')).toEqual(['after', 'before']);
    const a = await as('A', `/api/teacher/session-changes?${range}`);
    expect(labels(a.body.data, 'reason')).toEqual(['before']);
  });

  it('校內考：列表、單場、班級成績 —— B 兩場都看得到；A 只看得到任期內考的那場', async () => {
    const b = await as('B', '/api/academy-exams?pageSize=50');
    expect(labels(b.body.data, 'name')).toEqual(['after', 'before']);
    const a = await as('A', '/api/academy-exams?pageSize=50');
    expect(labels(a.body.data, 'name')).toEqual(['before']);

    for (const exam of [fx.examBefore, fx.examAfter]) {
      expect((await as('B', `/api/academy-exams/${exam}`)).status).toBe(200);
      expect((await as('B', `/api/scores/class/${fx.klass}/exam/${exam}`)).status).toBe(200);
    }
    expect((await as('A', `/api/academy-exams/${fx.examBefore}`)).status).toBe(200);
    expect((await as('A', `/api/academy-exams/${fx.examAfter}`)).status).toBe(403);
    expect((await as('A', `/api/scores/class/${fx.klass}/exam/${fx.examBefore}`)).status).toBe(200);
    expect((await as('A', `/api/scores/class/${fx.klass}/exam/${fx.examAfter}`)).status).toBe(403);
  });

  it('沒有日期脈絡的：B 看得到學生；A 名冊沒有、學生詳情 403、以學生為單位的成績空', async () => {
    const b = await as('B', '/api/students?pageSize=50');
    expect(b.body.data.map((s: { id: string }) => s.id)).toContain(fx.student);
    expect((await as('B', `/api/students/${fx.student}`)).status).toBe(200);

    const a = await as('A', '/api/students?pageSize=50');
    expect(a.body.data.map((s: { id: string }) => s.id)).not.toContain(fx.student);
    expect((await as('A', `/api/students/${fx.student}`)).status).toBe(403);
    // 以學生為單位的成績（裁定 c）：前任一律看不到；B 對照組看得到
    const scores = (who: 'A' | 'B') => as(who, `/api/scores/students?classId=${fx.klass}`);
    expect(JSON.stringify((await scores('B')).body)).toContain(fx.student);
    const a2 = await scores('A');
    expect(a2.status).toBe(200);
    expect(JSON.stringify(a2.body)).not.toContain(fx.student);
  });

  it('前任唯讀：A 寫任期內的日期也是 403；B 寫 X 以前的日期可以（補前任漏寫的）', async () => {
    const put = (who: 'A' | 'B') =>
      as(who, '/api/contact-book', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: fx.student, entryDate: BEFORE, content: `${who} 補寫` }),
      });
    expect((await put('A')).status).toBe(403);
    expect((await put('B')).status).toBe(200);

    const log = (who: 'A' | 'B') =>
      as(who, '/api/class-logs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classId: fx.klass, logDate: shift(BEFORE, 1), teachingRecord: who }),
      });
    expect((await log('A')).status).toBe(403);
    expect([200, 201]).toContain((await log('B')).status);

    // 發布任期內的草稿也算寫
    const [draft] = await q<{ id: string }>(
      'select id from class_logs where org_id = $1 and log_date = $2',
      [ctx.orgId, BEFORE],
    );
    expect((await as('A', `/api/class-logs/${draft!.id}/publish`, { method: 'POST' })).status).toBe(
      403,
    );

    const score = await as('A', `/api/academy-exams/${fx.examBefore}/scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scores: [{ studentId: fx.student, score: 90, status: 'scored' }] }),
    });
    expect(score.status).toBe(403);
  });

  it('待辦（還沒寫的聯絡簿）是寫入的提示：A 沒有、B 有', async () => {
    const day = AFTER;
    const a = await as('A', `/api/contact-book/missing?date=${day}`);
    expect(a.body.data).toEqual([]);
    const b = await as('B', `/api/contact-book/missing/summary?dateFrom=${day}&dateTo=${day}`);
    expect(b.status).toBe(200);
  });
});
