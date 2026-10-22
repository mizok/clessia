import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { replaceParentChildren } from '../lib/parent-children';

/**
 * #1843：家長改孩子的交易對**真的** Postgres 跑 —— 回滾、org 條件、分校範圍都是 SQL 語意。
 * 自己建兩個 org 的資料、測完刪掉；家長的帳號借 seed 既有的 ba_user（ba_* 只讀，c2）。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

run('家長改孩子的交易對真 Postgres（#1843）', () => {
  const pool = new Pool({ connectionString: DB });
  const orgs: string[] = [];
  let userId = '';

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;
  const children = async (parentId: string) =>
    (
      await q<{ student_id: string }>(
        'SELECT student_id FROM parent_student_relations WHERE parent_id = $1 ORDER BY student_id',
        [parentId],
      )
    ).map((r) => r.student_id);

  /** 一個 org：兩個分校，各一個班；`student(campus)` 建一個學生並報名那個分校的班 */
  async function org() {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c1843-${randomUUID()}`,
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
    const parent = async (kids: string[]) => {
      const parentId = await one(
        `INSERT INTO parents (org_id, name, user_id, status) VALUES ($1, 'x', $2, 'active')`,
        [orgId, userId],
      );
      for (const k of kids) {
        await q(
          `INSERT INTO parent_student_relations (parent_id, student_id, is_primary, relation)
           VALUES ($1, $2, true, '媽媽')`,
          [parentId, k],
        );
      }
      return parentId;
    };
    return { orgId, c1, c2, student, parent };
  }

  /** 讓第一句 `INSERT INTO parent_student_relations` 丟例外，其餘照真的跑 */
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
    const users = await q<{ id: string }>('SELECT id FROM ba_user ORDER BY id LIMIT 1');
    expect(users).toHaveLength(1);
    userId = users[0]!.id;
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
    await pool.end();
  });

  it('只動差集：留著的關聯不重建（is_primary／relation 還在），拿掉的刪、新的加', async () => {
    const a = await org();
    const [keep, drop, add] = [await a.student(a.c1), await a.student(a.c1), await a.student(a.c1)];
    const parentId = await a.parent([keep, drop]);

    const out = await replaceParentChildren(pool, {
      orgId: a.orgId,
      parentId,
      studentIds: [keep, add],
      scope: null,
    });
    expect(out).toEqual({ status: 'done', added: [add], removed: [drop] });
    expect(await children(parentId)).toEqual([keep, add].sort());
    const [kept] = await q<{ is_primary: boolean; relation: string }>(
      'SELECT is_primary, relation FROM parent_student_relations WHERE parent_id = $1 AND student_id = $2',
      [parentId, keep],
    );
    expect(kept).toEqual({ is_primary: true, relation: '媽媽' });
  });

  it('插入失敗：整批回滾，原本的關聯還在（刪掉的那筆也回來）', async () => {
    const a = await org();
    const [k1, k2, add] = [await a.student(a.c1), await a.student(a.c1), await a.student(a.c1)];
    const parentId = await a.parent([k1, k2]);

    await expect(
      replaceParentChildren(failingInsertPool(), {
        orgId: a.orgId,
        parentId,
        studentIds: [add],
        scope: null,
      }),
    ).rejects.toThrow('insert boom');
    expect(await children(parentId)).toEqual([k1, k2].sort());
  });

  it('別 org 的學生：student-not-found，什麼都沒動', async () => {
    const [a, b] = [await org(), await org()];
    const mine = await a.student(a.c1);
    const theirs = await b.student(b.c1);
    const parentId = await a.parent([mine]);

    const out = await replaceParentChildren(pool, {
      orgId: a.orgId,
      parentId,
      studentIds: [theirs],
      scope: null,
    });
    expect(out).toEqual({ status: 'student-not-found' });
    expect(await children(parentId)).toEqual([mine]);
  });

  it('別 org 的家長：not-found，那位家長的孩子沒被動到', async () => {
    const [a, b] = [await org(), await org()];
    const theirKid = await b.student(b.c1);
    const theirParent = await b.parent([theirKid]);

    const out = await replaceParentChildren(pool, {
      orgId: a.orgId,
      parentId: theirParent,
      studentIds: [],
      scope: null,
    });
    expect(out).toEqual({ status: 'not-found' });
    expect(await children(theirParent)).toEqual([theirKid]);
  });

  it('受限管理員：新加範圍外的學生 out-of-scope；已經掛著的範圍外孩子可以留著存檔', async () => {
    const a = await org();
    const inside = await a.student(a.c1);
    const outside = await a.student(a.c2);
    const outside2 = await a.student(a.c2);
    const parentId = await a.parent([inside, outside]);
    const scope = [a.c1.campusId];

    expect(
      await replaceParentChildren(pool, {
        orgId: a.orgId,
        parentId,
        studentIds: [inside, outside, outside2],
        scope,
      }),
    ).toEqual({ status: 'out-of-scope' });
    expect(await children(parentId)).toEqual([inside, outside].sort());

    // 原樣存回（含範圍外但本來就掛著的孩子）→ 沒有差集，done
    expect(
      await replaceParentChildren(pool, {
        orgId: a.orgId,
        parentId,
        studentIds: [inside, outside],
        scope,
      }),
    ).toEqual({ status: 'done', added: [], removed: [] });
  });
});
