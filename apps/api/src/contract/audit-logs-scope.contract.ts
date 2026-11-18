// scope-contract: GET /api/audit-logs
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { PERMISSIONS } from '../lib/permissions';
import { createServiceClientFromEnv } from '../lib/supabase';

/**
 * **稽核紀錄分分校**（#2496，保留類：授權面；#2493 R12），對真的本機 DB 跑 —— `campus_ids` 是
 * DB trigger（`audit_campus_ids()`）寫入時填的，替身量不到。
 *
 * 自建一個 org：C1、C2 各一個班，一位學生兩班都報，一位只在 C1 的職員。
 * - trigger：班 → 那個分校；跨校學生 → 兩個；職員 → staff_campuses；resource_id 放 classId 的 enrollment
 *   → 那班的分校；機構層級（科目）→ {}；非 uuid／對不到的 → NULL 而且**照樣寫得進去**
 *   （計畫席 11-13：稽核寫入永遠不能因為補分校失敗）；呼叫端明確帶了 → 不蓋
 * - GET：受限 C1 只看到 C1、跨校、機構層級的；看不到 C2 與 NULL；空範圍只剩機構層級；不受限全看；
 *   **`meta.total` 跟看得到的列數一致**（不洩漏看不到的列數，計畫席 11-13）
 * - 刪除：刪一個 C1 的班，稽核那筆帶 {C1}（刪完 trigger 反查不到，由 API 刪前讀的那一列帶上）
 * 測完整個 org 刪掉。
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
      // 刪班走交易（lib/class-delete.ts）要 pg pool —— 同 academy-exam-todo-2228 的寫法
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

run('稽核紀錄的分校範圍（#2496）', () => {
  let app: { request: (path: string, init?: RequestInit, env?: unknown) => Promise<Response> };
  const env = { ENVIRONMENT: 'contract', WEB_URL: 'http://localhost:4200', ALLOWED_ORIGINS: '' };
  const q = async <T>(text: string, values: unknown[] = []) =>
    (await pool!.query(text, values)).rows as T[];
  const fx = { c1: '', c2: '', k1: '', k2: '', k3: '', student: '', staff: '' };

  /** 直接 insert 一筆稽核（走 trigger），回它的 campus_ids；`campusIds` 有給就是呼叫端明確帶 */
  const insertLog = async (
    resourceType: string,
    resourceId: string | null,
    name: string,
    campusIds?: string[],
  ) => {
    const [row] = await q<{ campus_ids: string[] | null }>(
      `insert into audit_logs (org_id, user_id, resource_type, resource_id, resource_name, action, campus_ids)
       values ($1, $2, $3, $4, $5, 'contract', $6) returning campus_ids`,
      [ctx.orgId, ctx.userId, resourceType, resourceId, name, campusIds ?? null],
    );
    return row!.campus_ids === null ? null : [...row!.campus_ids].sort();
  };

  beforeAll(async () => {
    const [admin] = await q<{ user_id: string }>(
      "select r.user_id from user_roles r where r.role = 'admin' limit 1",
    );
    ctx.userId = admin!.user_id;
    ctx.orgId = (
      await q<{ id: string }>(
        "insert into organizations (name) values ('#2496 契約：稽核分校') returning id",
      )
    )[0]!.id;
    const [subject] = await q<{ id: string }>(
      "insert into subjects (org_id, name) values ($1, '數學') returning id",
      [ctx.orgId],
    );
    const [student] = await q<{ id: string }>(
      "insert into students (org_id, name, grade) values ($1, '兩校都有', 'P5') returning id",
      [ctx.orgId],
    );
    fx.student = student!.id;
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
      fx[`k${key}`] = klass!.id;
      await q(
        `insert into enrollments (org_id, class_id, student_id, status, billing_mode, agreed_amount, effective_from)
         values ($1, $2, $3, 'active', 'monthly', 1000, '2026-01-01')`,
        [ctx.orgId, klass!.id, student!.id],
      );
      if (key === '1') {
        // 刪除用：C1 裡一個什麼都沒有的班
        const [empty] = await q<{ id: string }>(
          'insert into classes (org_id, campus_id, course_id, name) values ($1, $2, $3, $4) returning id',
          [ctx.orgId, campus!.id, course!.id, '要刪的班'],
        );
        fx.k3 = empty!.id;
      }
    }
    const [staff] = await q<{ id: string }>(
      "insert into staff (org_id, user_id, display_name) values ($1, $2, '一校職員') returning id",
      [ctx.orgId, ctx.userId],
    );
    fx.staff = staff!.id;
    await q('insert into staff_campuses (staff_id, campus_id) values ($1, $2)', [fx.staff, fx.c1]);
    app = (await import('../index')).default as never;
  }, 120_000);

  afterAll(async () => {
    if (!ctx.orgId) return;
    for (const sql of [
      'delete from audit_logs where org_id = $1',
      'delete from staff_campuses where staff_id in (select id from staff where org_id = $1)',
      'delete from staff where org_id = $1',
      'delete from enrollments where org_id = $1',
      'delete from students where org_id = $1',
      'delete from classes where org_id = $1',
      'delete from courses where org_id = $1',
      'delete from subjects where org_id = $1',
      'delete from campuses where org_id = $1',
      'delete from organizations where id = $1',
    ]) {
      await q(sql, [ctx.orgId]);
    }
  }, 120_000);

  describe('trigger：寫入時依資源填 campus_ids', () => {
    it('班 → 那個分校；跨校學生 → 兩個；職員 → staff_campuses', async () => {
      expect(await insertLog('class', fx.k1, 'class-c1')).toEqual([fx.c1]);
      expect(await insertLog('student', fx.student, 'student-both')).toEqual([fx.c1, fx.c2].sort());
      expect(await insertLog('staff', fx.staff, 'staff-c1')).toEqual([fx.c1]);
    });

    it('enrollment 的 resource_id 放的是 classId（批次報名、複製名單）→ 那班的分校', async () => {
      expect(await insertLog('enrollment', fx.k2, 'enrollment-classid-c2')).toEqual([fx.c2]);
    });

    it('機構層級（科目）→ {}', async () => {
      expect(await insertLog('subject', null, 'subject-org')).toEqual([]);
    });

    it('非 uuid、對不到的 uuid、沒寫進函式的 type → 照樣寫得進去，campus_ids 是 NULL', async () => {
      expect(await insertLog('class', 'not-a-uuid', 'null-not-uuid')).toBeNull();
      expect(
        await insertLog('class', '00000000-0000-4000-8000-000000002496', 'null-missing'),
      ).toBeNull();
    });

    it('呼叫端明確帶了 → trigger 不蓋', async () => {
      expect(await insertLog('class', fx.k1, 'explicit-c2', [fx.c2])).toEqual([fx.c2]);
    });
  });

  describe('GET /api/audit-logs', () => {
    const list = async (scope: 'all' | 'c1' | 'none') => {
      ctx.campusScope = scope === 'all' ? null : scope === 'c1' ? [fx.c1] : [];
      try {
        const res = await app.request(
          '/api/audit-logs?pageSize=100&resourceTypes=class,student,staff,enrollment,subject',
          {},
          env,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          data: { resourceName: string | null; action: string }[];
          meta: { total: number };
        };
        const names = body.data
          .filter((r) => r.action === 'contract')
          .map((r) => r.resourceName!)
          .sort();
        return { names, total: body.meta.total, rows: body.data.length };
      } finally {
        ctx.campusScope = null;
      }
    };

    it('受限 C1：C1、跨校、機構層級；看不到 C2 與推不出分校的；total＝看得到的列數', async () => {
      const r = await list('c1');
      expect(r.names).toEqual(['class-c1', 'staff-c1', 'student-both', 'subject-org']);
      expect(r.total).toBe(r.rows);
    });

    it('空範圍：只剩機構層級', async () => {
      const r = await list('none');
      expect(r.names).toEqual(['subject-org']);
      expect(r.total).toBe(r.rows);
    });

    it('不受限：全部（含推不出分校的）', async () => {
      const r = await list('all');
      expect(r.names).toEqual(
        [
          'class-c1',
          'enrollment-classid-c2',
          'explicit-c2',
          'null-missing',
          'null-not-uuid',
          'staff-c1',
          'student-both',
          'subject-org',
        ].sort(),
      );
      expect(r.total).toBe(r.rows);
    });
  });

  it('刪除類：刪一個 C1 的班，稽核那筆帶 {C1}（刪完 trigger 反查不到，由 API 帶上）', async () => {
    const res = await app.request(`/api/classes/${fx.k3}`, { method: 'DELETE' }, env);
    expect(res.status).toBe(200);
    // logAudit 是 fire-and-forget：等它寫進去
    let rows: { campus_ids: string[] | null }[] = [];
    for (let i = 0; i < 40 && rows.length === 0; i++) {
      rows = await q(
        "select campus_ids from audit_logs where org_id = $1 and resource_id = $2 and action = 'delete'",
        [ctx.orgId, fx.k3],
      );
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    expect(rows.map((r) => r.campus_ids)).toEqual([[fx.c1]]);
  });
});
