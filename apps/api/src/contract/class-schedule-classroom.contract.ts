import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import classesRoute from '../routes/classes';

/**
 * #1796：時段指定教室，路由對**真的** PostgREST 跑 —— select 字串少了 `campus_id`／`classroom_id`、
 * 少了 `classrooms(name)` 嵌入，替身（`createMultiOrgDb` 不解析 select）驗不出來（審核席 A12–A15）。
 * 自己建資料、測完刪掉，不碰 seed（只借一個既有 ba_user 當操作人：c2 不寫 ba_*）。
 */

const URL = process.env['SUPABASE_URL'];
const KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const DB = process.env['DATABASE_URL'];
if (!(URL && KEY && DB) && process.env['CONTRACT_REQUIRED']) {
  throw new Error(
    '[contract] CONTRACT_REQUIRED 但沒有 SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY／DATABASE_URL',
  );
}
const run = URL && KEY && DB ? describe : describe.skip;

run('時段指定教室對真 PostgREST（#1796）', () => {
  const pool = new Pool({ connectionString: DB });
  let orgId = '';
  let userId = '';
  let campusA = '';
  let campusB = '';
  let classId = '';
  let roomA = '';

  const one = async (sql: string, params: unknown[]) =>
    (await pool.query<{ id: string }>(`${sql} RETURNING id`, params)).rows[0]!.id;

  const call = async (method: string, path: string, body?: unknown) => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', createClient(URL!, KEY!));
      set('orgId', orgId);
      set('userId', userId);
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', classesRoute as unknown as Hono);
    const res = await app.request(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    userId = (await pool.query<{ id: string }>('SELECT id FROM ba_user LIMIT 1')).rows[0]!.id;
    orgId = await one('INSERT INTO organizations (name) VALUES ($1)', [`c1796-${randomUUID()}`]);
    campusA = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, 'A 校')`, [orgId]);
    campusB = await one(`INSERT INTO campuses (org_id, name) VALUES ($1, 'B 校')`, [orgId]);
    const subjectId = await one(`INSERT INTO subjects (org_id, name) VALUES ($1, 'x')`, [orgId]);
    const courseId = await one(
      `INSERT INTO courses (org_id, campus_id, subject_id, name) VALUES ($1, $2, $3, 'x')`,
      [orgId, campusA, subjectId],
    );
    classId = await one(
      `INSERT INTO classes (org_id, campus_id, course_id, name) VALUES ($1, $2, $3, '數學A')`,
      [orgId, campusA, courseId],
    );
    roomA = await one(
      `INSERT INTO classrooms (org_id, campus_id, name) VALUES ($1, $2, 'A 教室')`,
      [orgId, campusA],
    );
  });

  afterAll(async () => {
    if (orgId) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('SET LOCAL session_replication_role = replica');
        await db.query(
          'DELETE FROM schedules WHERE class_id IN (SELECT id FROM classes WHERE org_id = $1)',
          [orgId],
        );
        for (const t of [
          'audit_logs',
          'classes',
          'classrooms',
          'courses',
          'subjects',
          'campuses',
        ]) {
          await db.query(`DELETE FROM ${t} WHERE org_id = $1`, [orgId]);
        }
        await db.query('DELETE FROM organizations WHERE id = $1', [orgId]);
        await db.query('COMMIT');
      } finally {
        db.release();
      }
    }
    await pool.end();
  });

  let scheduleId = '';

  it('POST 同分校的教室：201，回應帶教室名（班級的 campus_id 真的有讀到）', async () => {
    const { status, body } = await call('POST', `/${classId}/schedules`, {
      weekday: 2,
      startTime: '14:00',
      endTime: '15:00',
      classroomId: roomA,
    });
    expect(status).toBe(201);
    expect(body.data).toMatchObject({ classroomId: roomA, classroomName: 'A 教室' });
    scheduleId = body.data.id;
  });

  it('班級詳情、班級列表：時段帶 classroomName', async () => {
    const detail = await call('GET', `/${classId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.schedules).toEqual([
      expect.objectContaining({ classroomId: roomA, classroomName: 'A 教室' }),
    ]);

    const list = await call('GET', '/');
    expect(list.status).toBe(200);
    const row = list.body.data.find((c: { id: string }) => c.id === classId);
    expect(row.schedules).toEqual([expect.objectContaining({ classroomName: 'A 教室' })]);
  });

  it('班級換了分校：PUT 原封送回舊教室改時間 → 200（比的是 DB 現值，不鎖死）；真的換成別校教室才 409', async () => {
    await pool.query('UPDATE classes SET campus_id = $1 WHERE id = $2', [campusB, classId]);

    const same = await call('PUT', `/${classId}/schedules/${scheduleId}`, {
      startTime: '14:30',
      classroomId: roomA,
    });
    expect(same.status).toBe(200);
    expect(same.body.data).toMatchObject({ startTime: '14:30:00', classroomName: 'A 教室' });

    const otherRoom = await one(
      `INSERT INTO classrooms (org_id, campus_id, name) VALUES ($1, $2, '另一間')`,
      [orgId, campusA],
    );
    const changed = await call('PUT', `/${classId}/schedules/${scheduleId}`, {
      classroomId: otherRoom,
    });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe('CLASSROOM_CAMPUS_MISMATCH');
  });
});
