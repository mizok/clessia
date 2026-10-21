import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { notifyEnrollmentApproved } from '../lib/notify-events';

/**
 * #1726 拆單 6：核准後通知家長，對**真的** PostgREST 跑 —— 收件人範圍（本 org、啟用、有帳號；
 * 關聯表沒有 org 欄，別 org 的家長關聯到同一個學生也不能收到）、寫入的欄位、去重。
 * 自己建 org、測完刪掉；家長的帳號借 seed 既有的 ba_user（c2：不寫 ba_*）。
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

run('核准後通知家長對真 DB（#1726 拆單 6）', () => {
  const pool = new Pool({ connectionString: DB });
  const supabase = createClient(URL!, KEY!, { auth: { persistSession: false } });
  const orgs: string[] = [];
  let users: string[] = [];

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;

  async function newOrg() {
    const orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [
      `c1726n-${randomUUID()}`,
    ]);
    orgs.push(orgId);
    return orgId;
  }
  const parent = (orgId: string, userId: string, status = 'active') =>
    one(`INSERT INTO parents (org_id, name, user_id, status) VALUES ($1, 'p', $2, $3)`, [
      orgId,
      userId,
      status,
    ]);
  const link = (parentId: string, studentId: string) =>
    q(`INSERT INTO parent_student_relations (parent_id, student_id) VALUES ($1, $2)`, [
      parentId,
      studentId,
    ]);

  beforeAll(async () => {
    users = (await q<{ id: string }>('SELECT id FROM ba_user ORDER BY id LIMIT 4')).map(
      (r) => r.id,
    );
  });
  afterAll(async () => {
    if (orgs.length) {
      await pool.query('DELETE FROM notifications WHERE org_id = ANY($1)', [orgs]);
      await pool.query(
        'DELETE FROM parent_student_relations WHERE parent_id IN (SELECT id FROM parents WHERE org_id = ANY($1))',
        [orgs],
      );
      for (const t of ['parents', 'students']) {
        await pool.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [orgs]);
      }
      await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgs]);
    }
    await pool.end();
  });

  it('只發給本 org、啟用中、關聯到這個學生的家長；欄位與去重', async () => {
    expect(users.length).toBeGreaterThanOrEqual(4);
    const orgA = await newOrg();
    const orgB = await newOrg();
    const student = await one(`INSERT INTO students (org_id, name, grade) VALUES ($1, 'x', 'J1')`, [
      orgA,
    ]);
    const otherStudent = await one(
      `INSERT INTO students (org_id, name, grade) VALUES ($1, 'y', 'J1')`,
      [orgA],
    );

    const mom = await parent(orgA, users[0]!);
    const dad = await parent(orgA, users[1]!);
    const inactive = await parent(orgA, users[2]!, 'inactive');
    const otherOrg = await parent(orgB, users[3]!); // 關聯表沒有 org 欄：別 org 的家長指到同一個學生
    const otherKid = await parent(orgA, users[3]!);
    for (const p of [mom, dad, inactive, otherOrg]) await link(p, student);
    await link(otherKid, otherStudent);

    const input = {
      orgId: orgA,
      requestId: randomUUID(),
      studentId: student,
      studentName: '林小華',
      className: '國二數學 A',
      amount: 3100,
      dueDate: '2026-11-04',
    };
    await notifyEnrollmentApproved(supabase, input);
    await notifyEnrollmentApproved(supabase, input); // 重送不重複

    const rows = await q<{
      user_id: string;
      role: string;
      kind: string;
      push_status: string;
      dedupe_key: string;
      payload: { title: string; body: string; url: string };
    }>(
      `SELECT user_id, role::text, kind::text, push_status::text, dedupe_key, payload
         FROM notifications WHERE org_id = ANY($1) ORDER BY user_id`,
      [[orgA, orgB]],
    );
    expect(rows.map((r) => r.user_id)).toEqual([users[0], users[1]].sort());
    for (const r of rows) {
      expect(r).toMatchObject({
        role: 'parent',
        kind: 'enrollment_approved',
        push_status: 'pending',
        dedupe_key: `enrollment_approved:${input.requestId}`,
        payload: {
          title: '報名已核准',
          body: '林小華 報名 國二數學 A 已核准，請在 11/4 前繳 3,100 元',
          url: '/parent/enrollment#records',
        },
      });
    }
  });

  it('學生沒有任何家長：什麼都不寫、不丟例外', async () => {
    const orgId = await newOrg();
    const student = await one(`INSERT INTO students (org_id, name, grade) VALUES ($1, 'x', 'J1')`, [
      orgId,
    ]);
    await expect(
      notifyEnrollmentApproved(supabase, {
        orgId,
        requestId: randomUUID(),
        studentId: student,
        studentName: 'x',
        className: 'x',
        amount: 1,
        dueDate: '2026-11-04',
      }),
    ).resolves.toBeUndefined();
    expect((await q(`SELECT 1 FROM notifications WHERE org_id = $1`, [orgId])).length).toBe(0);
  });
});
