// scope-contract: POST /api/parents/batch-check
// scope-contract: POST /api/parents/batch-import
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createAuth } from '../auth';
import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **#2493 R10：家長匯入的電話／Email 反查不能帶出範圍外家長的姓名**（保留類：授權範圍），
 * 對真的本機 PostgREST＋Postgres 跑。
 *
 * 原本受限管理員在預檢（batch-check）填一支別校家長的電話，錯誤訊息就寫出那位家長是誰；匯入
 * （batch-import）的「名字不符」檢查排在範圍檢查前面，訊息同樣帶出姓名，範圍外那則也帶。等於用
 * 電話反查別校家長。裁定（11-13）：反查照樣擋（帳號就是那一位，建不出第二個），**範圍外的訊息不帶姓名**；
 * 範圍內照舊帶（受限者本來就看得到那位家長）。
 *
 * fixture：C1、C2 各一班；「別校家長甲」（有電話）的孩子只報在 C2。管理員只被指派 C1。
 * 帳號經 better-auth 的 API 建、刪，不直寫 ba_*（c2）。測完整個 org 刪掉。
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

const OTHER = '別校家長甲';

run('家長匯入的反查不帶出範圍外家長姓名（#2493 R10）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
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
  // 每次跑換一支電話：ba_user 的電話全域唯一，上一次沒收乾淨也不會撞
  const PHONE = `09${String(Date.now()).slice(-8)}`;
  const fx = { c1: '', c2: '', parent: '', parentUser: '' };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2493 R10 契約：家長反查') returning id",
      )
    )[0]!.id;
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [ctx.orgId],
    );
    const classIn: Record<'1' | '2', string> = { '1': '', '2': '' };
    for (const key of ['1', '2'] as const) {
      const [campus] = await q<{ id: string }>(
        'insert into campuses (org_id, name) values ($1, $2) returning id',
        [ctx.orgId, `c${key}`],
      );
      fx[`c${key}`] = campus!.id;
      const [course] = await q<{ id: string }>(
        'insert into courses (org_id, campus_id, name, subject_id) values ($1, $2, $3, $4) returning id',
        [ctx.orgId, campus!.id, `數學 c${key}`, subject!.id],
      );
      const [klass] = await q<{ id: string }>(
        'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4) returning id',
        [ctx.orgId, campus!.id, course!.id, `班 c${key}`],
      );
      classIn[key] = klass!.id;
    }
    const [student] = await q<{ id: string }>(
      "insert into students (org_id, name, grade) values ($1, '只在二校的孩子', 'P5') returning id",
      [ctx.orgId],
    );
    await q(
      `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
       values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
      [ctx.orgId, classIn['2'], student!.id],
    );
    const { user } = (await auth.api.createUser({
      body: {
        email: `c2493-r10-${crypto.randomUUID()}@example.com`,
        name: OTHER,
        data: { phone: PHONE },
      },
    })) as { user: { id: string } };
    fx.parentUser = user.id;
    const [parent] = await q<{ id: string }>(
      'insert into parents (org_id, user_id, name) values ($1, $2, $3) returning id',
      [ctx.orgId, user.id, OTHER],
    );
    fx.parent = parent!.id;
    await q('insert into parent_student_relations (parent_id, student_id) values ($1, $2)', [
      fx.parent,
      student!.id,
    ]);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
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
    if (fx.parentUser) {
      const authCtx = await auth.$context;
      await q('delete from user_roles where user_id = $1', [fx.parentUser]);
      await authCtx.internalAdapter.deleteUser(fx.parentUser);
    }
  }, 120_000);

  const post = async (scope: 'all' | 'c1', path: string, rows: unknown[]) => {
    ctx.campusScope = scope === 'all' ? null : [fx.c1];
    try {
      const res = await app.request(
        path,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows }),
        },
        env,
      );
      expect(res.status).toBe(200);
      return (await res.json()) as Record<string, unknown>;
    } finally {
      ctx.campusScope = null;
    }
  };

  describe('POST /api/parents/batch-check', () => {
    const contactErrors = async (scope: 'all' | 'c1') => {
      // 第二列跟既有家長同名：batch-check 的 Step 2 查不到任何同名家長時會提早回空結果，
      // 電話／Email 反查（Step 5）根本不跑 —— 那是另一個既有問題（另報），這裡先讓 Step 5 跑得到
      const body = (await post(scope, '/api/parents/batch-check', [
        { parentName: '另一個名字', parentPhone: PHONE },
        { parentName: OTHER },
      ])) as { errors: { rowIndex: number; type: string; message: string }[] };
      return body.errors.filter(
        (e) => e.rowIndex === 0 && e.type === 'contact_belongs_to_another_parent',
      );
    };

    it('受限 C1、電話是別校家長的：照樣擋，但訊息不帶那位家長的姓名', async () => {
      const errors = await contactErrors('c1');
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).not.toContain(OTHER);
      expect(errors[0]!.message).toContain('不在你分校範圍內');
    });

    it('不受限：照舊寫出是哪一位家長（防過度擋）', async () => {
      const errors = await contactErrors('all');
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain(OTHER);
    });
  });

  describe('POST /api/parents/batch-import', () => {
    const importRow = async (parentName: string) => {
      const body = (await post('c1', '/api/parents/batch-import', [
        {
          parentName,
          parentPhone: PHONE,
          studentName: '新的孩子',
          studentGrade: 'P5',
          studentSchool: '某國小',
        },
      ])) as { results: { status: string; error?: string }[] };
      return body.results[0]!;
    };

    it('受限 C1、電話是別校家長的、名字不同：這一筆失敗，訊息不帶姓名（原本名字不符先擋、帶出姓名）', async () => {
      const r = await importRow('另一個名字');
      expect(r.status).toBe('failed');
      expect(r.error).not.toContain(OTHER);
      expect(r.error).toContain('不在你分校範圍內');
    });

    it('受限 C1、同名同電話（要合併到別校家長）：這一筆失敗，訊息不帶姓名', async () => {
      const r = await importRow(OTHER);
      expect(r.status).toBe('failed');
      expect(r.error).not.toContain(OTHER);
    });

    it('兩次都沒有把孩子掛到別校家長底下', async () => {
      const [n] = await q<{ n: number }>(
        'select count(*)::int n from parent_student_relations where parent_id = $1',
        [fx.parent],
      );
      expect(n!.n).toBe(1);
    });
  });
});
