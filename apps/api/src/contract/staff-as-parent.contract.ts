import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findExistingAccounts, linkStaffAsParent } from '../lib/staff-as-parent';

/**
 * #1844：把教職員設為家長的交易對**真的** Postgres 跑 —— 回滾、唯一鍵衝突、孩子的 org／分校都是 SQL 語意。
 * 自己建 org 的資料、測完刪掉。帳號借 seed 裡**還沒有 parent 角色**的 ba_user（ba_* 只讀，c2），
 * 測試加上的 parent 角色在 afterAll 拿掉 —— 不碰 seed 原本就有的角色。
 */

const DB = process.env['DATABASE_URL'];
const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if ((!DB || !URL || !KEY) && process.env['CONTRACT_REQUIRED']) {
  throw new Error(
    '[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL／SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY',
  );
}
const run = DB && URL && KEY ? describe : describe.skip;

run('教職員設為家長的交易對真 Postgres（#1844）', () => {
  const pool = new Pool({ connectionString: DB });
  const orgs: string[] = [];
  let users: string[] = [];

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;

  async function org() {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c1844-${randomUUID()}`,
    ]);
    orgs.push(orgId);
    const subjectId = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const campus = async () => {
      const campusId = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, $2)`, [
        orgId,
        randomUUID(),
      ]);
      const courseId = await one(
        `INSERT INTO courses (org_id, campus_id, subject_id, name) VALUES ($1, $2, $3, 'x')`,
        [orgId, campusId, subjectId],
      );
      const classId = await one(
        `INSERT INTO classes (org_id, campus_id, course_id, name) VALUES ($1, $2, $3, $4)`,
        [orgId, campusId, courseId, randomUUID()],
      );
      return { campusId, classId };
    };
    const [c1, c2] = [await campus(), await campus()];
    const student = async (at: { classId: string }) => {
      const studentId = await one(
        `INSERT INTO students (org_id, name, grade) VALUES ($1, 'x', 'J1')`,
        [orgId],
      );
      await q(`INSERT INTO enrollments (org_id, class_id, student_id) VALUES ($1, $2, $3)`, [
        orgId,
        at.classId,
        studentId,
      ]);
      return studentId;
    };
    return { orgId, c1, c2, student };
  }

  const stateOf = async (orgId: string, userId: string) => ({
    parents: await q<{ name: string; status: string }>(
      'SELECT name, status FROM parents WHERE org_id = $1 AND user_id = $2',
      [orgId, userId],
    ),
    hasRole:
      (await q(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'parent'`, [userId]))
        .length === 1,
    kids: (
      await q<{ student_id: string }>(
        `SELECT r.student_id FROM parent_student_relations r JOIN parents p ON p.id = r.parent_id
          WHERE p.org_id = $1 AND p.user_id = $2 ORDER BY r.student_id`,
        [orgId, userId],
      )
    ).map((r) => r.student_id),
  });

  /** 讓 `INSERT INTO parent_student_relations` 丟例外，其餘照真的跑 */
  const failingInsertPool = () =>
    ({
      connect: async () => {
        const db = await pool.connect();
        return {
          query: (sql: string, params?: unknown[]) =>
            /^\s*INSERT INTO parent_student_relations/.test(sql)
              ? Promise.reject(new Error('insert boom'))
              : db.query(sql, params),
          release: (err?: Error) => db.release(err),
        } as unknown as PoolClient;
      },
    }) as unknown as Pool;

  beforeAll(async () => {
    const rows = await q<{ id: string }>(
      `SELECT u.id FROM ba_user u
        WHERE NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'parent')
        ORDER BY u.id LIMIT 3`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    users = rows.map((r) => r.id);
  });
  afterAll(async () => {
    if (orgs.length) {
      await q(
        'DELETE FROM parent_student_relations WHERE parent_id IN (SELECT id FROM parents WHERE org_id = ANY($1))',
        [orgs],
      );
      for (const t of [
        'parents',
        'enrollments',
        'classes',
        'courses',
        'students',
        'subjects',
        'campuses',
      ]) {
        await q(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [orgs]);
      }
      await q('DELETE FROM organizations WHERE id = ANY($1)', [orgs]);
    }
    // 只拿掉這支測試加的 parent 角色（beforeAll 挑的都是原本沒有 parent 的帳號）
    if (users.length) {
      await q(`DELETE FROM user_roles WHERE role = 'parent' AND user_id = ANY($1)`, [users]);
    }
    await pool.end();
  });

  /**
   * 查詢條件只能對真 DB 驗（替身不解析 select／filter）：staff 與 parents 都要只取**這個 org** 的列 ——
   * 少了 `.eq('org_id', orgId)`，別機構的教職員身分會被當成本機構的，直接被設成家長。
   */
  it('findExistingAccounts：用 Email 對到人；staff／parents 只看這個 org 的列', async () => {
    const supabase = createClient(URL!, KEY!, { auth: { persistSession: false } });
    const [mine, other] = [await org(), await org()];
    const [u] = await q<{ id: string; email: string }>(
      'SELECT id, email FROM ba_user WHERE id = $1',
      [users[0]],
    );
    await q(
      `INSERT INTO staff (user_id, org_id, display_name, status) VALUES ($1, $2, '別校的老師', 'active')`,
      [u!.id, other.orgId],
    );
    await q(
      `INSERT INTO parents (user_id, org_id, name, status) VALUES ($1, $2, '別校的家長', 'active')`,
      [u!.id, other.orgId],
    );
    try {
      const found = await findExistingAccounts(supabase, mine.orgId, {
        email: u!.email.toUpperCase(),
      });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        userId: u!.id,
        matchedBy: 'email',
        staff: null,
        parent: null,
      });

      const there = await findExistingAccounts(supabase, other.orgId, { email: u!.email });
      expect(there[0]).toMatchObject({
        staff: { display_name: '別校的老師', status: 'active' },
        parent: { name: '別校的家長', status: 'active' },
      });
    } finally {
      await q('DELETE FROM staff WHERE org_id = $1', [other.orgId]);
    }
  });

  it('一次完成：家長列（教職員姓名、active）、parent 角色、孩子', async () => {
    const o = await org();
    const kid = await o.student(o.c1);
    const out = await linkStaffAsParent(pool, {
      orgId: o.orgId,
      userId: users[0]!,
      name: '王老師',
      notes: null,
      studentIds: [kid, kid],
      scope: null,
    });
    expect(out.status).toBe('done');
    expect(await stateOf(o.orgId, users[0]!)).toEqual({
      parents: [{ name: '王老師', status: 'active' }],
      hasRole: true,
      kids: [kid],
    });
  });

  it('同一個帳號再設一次 → already-parent（唯一鍵），什麼都沒多', async () => {
    const o = await org();
    const input = {
      orgId: o.orgId,
      userId: users[1]!,
      name: 'x',
      notes: null,
      studentIds: [],
      scope: null,
    };
    expect((await linkStaffAsParent(pool, input)).status).toBe('done');
    expect((await linkStaffAsParent(pool, input)).status).toBe('already-parent');
    expect((await stateOf(o.orgId, users[1]!)).parents).toHaveLength(1);
  });

  it('孩子不屬於本機構 → student-not-found，整筆沒寫（沒有家長列、沒有角色）', async () => {
    const o = await org();
    const other = await org();
    const foreignKid = await other.student(other.c1);
    const out = await linkStaffAsParent(pool, {
      orgId: o.orgId,
      userId: users[2]!,
      name: 'x',
      notes: null,
      studentIds: [foreignKid],
      scope: null,
    });
    expect(out.status).toBe('student-not-found');
    expect(await stateOf(o.orgId, users[2]!)).toEqual({ parents: [], hasRole: false, kids: [] });
  });

  it('受限管理員勾了範圍外的孩子 → out-of-scope，整筆沒寫', async () => {
    const o = await org();
    const kidInC2 = await o.student(o.c2);
    const out = await linkStaffAsParent(pool, {
      orgId: o.orgId,
      userId: users[2]!,
      name: 'x',
      notes: null,
      studentIds: [kidInC2],
      scope: [o.c1.campusId],
    });
    expect(out.status).toBe('out-of-scope');
    expect(await stateOf(o.orgId, users[2]!)).toEqual({ parents: [], hasRole: false, kids: [] });
  });

  it('建關聯那一步失敗 → 整筆回滾：沒有家長列、沒有角色（不會留下「有角色沒資料」）', async () => {
    const o = await org();
    const kid = await o.student(o.c1);
    await expect(
      linkStaffAsParent(failingInsertPool(), {
        orgId: o.orgId,
        userId: users[2]!,
        name: 'x',
        notes: null,
        studentIds: [kid],
        scope: null,
      }),
    ).rejects.toThrow('insert boom');
    expect(await stateOf(o.orgId, users[2]!)).toEqual({ parents: [], hasRole: false, kids: [] });
  });
});
