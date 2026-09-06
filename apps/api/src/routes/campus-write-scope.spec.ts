import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import academyExamsRoute from './academy-exams';
import announcementsRoute from './announcements';
import coursesRoute from './courses';
import staffRoute from './staff';

/**
 * **分校範圍在寫入路徑上的守衛。**
 *
 * `campusScope` 原本只套在讀取路徑（`applyCampusFilter` / `campusFilterIds`），
 * 而 `middleware/auth.ts` 的全域 `campusRequestGuard` **只看 query string 的
 * `campusId` / `campusIds`** —— body 帶進來的分校完全在它的視野外。
 *
 * 其中 `PUT /api/staff/:id` 是**自我提權**：`campusScope` 直接來自請求者自己的
 * `staff_campuses` 列（`middleware/auth.ts:140-150`），而 `checkRoleAssignment` 的
 * 「不能改自己」只在動 `roles` / `permissions` 時生效 —— `campusIds` 不在其中。
 * 於是一個只管中正分校的管理員可以把自己那筆 staff 的 `campusIds` 設成全部分校，
 * 下一個請求起就不受限了。**這支路由已經擋掉「自己改自己的角色與權限」，
 * 分校是同一件事的另一個載體，只是沒被涵蓋。**
 *
 * 正確寫法 repo 裡本來就有：`routes/daily-checkins.ts:56-60` 對 body 的 campusId
 * 呼叫 `isCampusAllowed`。這組測試釘的是「其餘四處也要這樣做」。
 */

const ORG = '00000000-0000-0000-0000-0000000000aa';
const MINE = '00000000-0000-0000-0000-0000000000c1'; // 我管的分校
const THEIRS = '00000000-0000-0000-0000-0000000000c2'; // 我不管的分校
const STAFF_ID = '00000000-0000-0000-0000-0000000000d1';
const SUBJECT_ID = '00000000-0000-0000-0000-0000000000e1';
const CLASS_ID = '00000000-0000-0000-0000-0000000000f1';

/** 極簡替身：守衛在 handler 最前面，所以這些測試打不到任何一次查詢 */
function fakeDb(canned: Record<string, unknown> = {}) {
  const make = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder as never;
    Object.assign(builder, {
      select: () => chain(),
      insert: () => chain(),
      update: () => chain(),
      delete: () => chain(),
      eq: () => chain(),
      in: () => chain(),
      order: () => chain(),
      limit: () => chain(),
      maybeSingle: () => Promise.resolve({ data: canned[table] ?? null, error: null }),
      single: () => Promise.resolve({ data: canned[table] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: canned[table] ?? [], count: 0, error: null }),
    });

    return builder;
  };

  return { from: (table: string) => make(table) };
}

function appWith(route: unknown, scope: readonly string[] | null, db: unknown = fakeDb()) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db);
    set('orgId', ORG);
    set('userId', 'requester-user');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', scope);
    await next();
  });
  app.route('/', route as Hono);

  return app;
}

function post(route: unknown, body: unknown, scope: readonly string[] | null = [MINE]) {
  return appWith(route, scope).request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('寫入路徑的分校範圍 —— body 帶的 campusId 不能超出自己的範圍', () => {
  it('PUT /api/staff/:id —— 不能把自己的分校範圍改成範圍外的分校（自我提權）', async () => {
    const db = fakeDb({
      staff: { id: STAFF_ID, user_id: 'requester-user', org_id: ORG },
      user_roles: { role: 'admin' },
      campuses: [{ id: THEIRS }],
    });

    const res = await appWith(staffRoute, [MINE], db).request(`/${STAFF_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campusIds: [MINE, THEIRS] }),
    });

    expect(res.status).toBe(403);
  });

  it('PUT /api/staff/:id —— 範圍內的分校照樣改得動（守衛不是無腦擋）', async () => {
    const db = fakeDb({
      staff: { id: STAFF_ID, user_id: 'requester-user', org_id: ORG },
      user_roles: { role: 'admin' },
      campuses: [{ id: MINE }],
    });

    const res = await appWith(staffRoute, [MINE], db).request(`/${STAFF_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campusIds: [MINE] }),
    });

    expect(res.status).not.toBe(403);
  });

  it('POST /api/announcements —— 不能對自己不管的分校發公告', async () => {
    const res = await post(announcementsRoute, {
      title: '停課通知',
      body: '本週三停課',
      audience: 'all_teachers',
      campusId: THEIRS,
    });

    expect(res.status).toBe(403);
  });

  it('POST /api/courses —— 不能在自己不管的分校建課程', async () => {
    const res = await post(coursesRoute, {
      name: '國一數學',
      campusId: THEIRS,
      subjectId: SUBJECT_ID,
      gradeLevels: ['G7'],
    });

    expect(res.status).toBe(403);
  });

  it('POST /api/academy-exams —— 不能把考試建在自己不管的分校', async () => {
    const res = await post(academyExamsRoute, {
      name: '第一次段考',
      examType: 'quiz',
      examDate: '2026-03-01',
      campusId: THEIRS,
      classIds: [CLASS_ID],
    });

    expect(res.status).toBe(403);
  });

  it('不受分校限制的管理員（scope null）不受影響', async () => {
    const res = await post(
      announcementsRoute,
      { title: 'x', body: 'y', audience: 'all_teachers', campusId: THEIRS },
      null,
    );

    expect(res.status).not.toBe(403);
  });
});
