import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import campusesRoute from './campuses';

/**
 * #1314 SE3：分校的教室（設計稿 kb/wiki/specs/admin/system/campus-classrooms.md §3）。
 *
 * `classrooms` 的 FK 只保證分校、教室存在，**擋不住跨 org 或跨分校**（#1765 計畫席提醒）——
 * 牆只有 Hono 這一層。所以每一道條件都要有一支拿掉就紅的突變：
 * - 分校別 org → 404，別 org 的分校底下不會多一間教室
 * - 分校在 org、不在範圍 → 403
 * - 教室屬於本 org 但**別的分校** → 404（只驗 org 的話 A 校網址改得到 B 校教室）
 * - 教室屬於別 org（網址的分校是自己的）→ 404
 * - 寫入的 `org_id` 來自分校列，不是請求
 */

const ORG = '00000000-0000-0000-0000-0000000000aa';
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';
const MINE = '00000000-0000-0000-0000-0000000000c1';
const SIBLING = '00000000-0000-0000-0000-0000000000c2';
const FOREIGN = '00000000-0000-0000-0000-0000000000c9';
const ROOM_A = '00000000-0000-0000-0000-0000000000d1';
const ROOM_SIBLING = '00000000-0000-0000-0000-0000000000d2';
const ROOM_FOREIGN = '00000000-0000-0000-0000-0000000000d9';
const SCHEDULE = '00000000-0000-0000-0000-0000000000e1';

const campus = (id: string, orgId = ORG) => ({
  id,
  org_id: orgId,
  name: id === MINE ? '中正分校' : id,
  address: null,
  phone: null,
  is_active: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
});

const room = (id: string, campusId: string, orgId = ORG, name = id) => ({
  id,
  org_id: orgId,
  campus_id: campusId,
  name,
  capacity: 30,
  equipment: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
});

function setup(
  campusScope: readonly string[] | null = null,
  extraRooms: Array<Record<string, unknown>> = [],
) {
  const db = createMultiOrgDb({
    campuses: [campus(MINE), campus(SIBLING), campus(FOREIGN, OTHER_ORG)],
    classrooms: [
      room(ROOM_A, MINE, ORG, 'A 教室'),
      room(ROOM_SIBLING, SIBLING),
      room(ROOM_FOREIGN, FOREIGN, OTHER_ORG),
      ...extraRooms,
    ],
    schedules: [{ id: SCHEDULE, class_id: 'x', classroom_id: ROOM_A }],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'user-1');
    set('roles', ['admin']);
    set('permissions', []);
    set('campusScope', campusScope);
    await next();
  });
  app.route('/', campusesRoute as unknown as Hono);

  async function call(method: string, path: string, body?: unknown) {
    const res = await app.request(path, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0)); // 稽核 fire-and-forget
    const text = await res.text();
    return { status: res.status, body: (text.startsWith('{') ? JSON.parse(text) : text) as any };
  }

  return { db, call, rooms: () => db.rows('classrooms') };
}

describe('GET /{id}/classrooms', () => {
  it('只列這個分校的教室（不混入同 org 別分校、別 org）', async () => {
    const { call } = setup();
    const { status, body } = await call('GET', `/${MINE}/classrooms`);

    expect(status).toBe(200);
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([ROOM_A]);
    expect(body.data[0]).toMatchObject({ campusId: MINE, name: 'A 教室', capacity: 30 });
  });

  it('依名稱排序', async () => {
    // 後種的排在前面 —— 沒下 order 會照種子順序回 A、0
    const { call } = setup(null, [
      room('00000000-0000-0000-0000-0000000000d3', MINE, ORG, '0 教室'),
    ]);
    const { body } = await call('GET', `/${MINE}/classrooms`);
    expect(body.data.map((r: { name: string }) => r.name)).toEqual(['0 教室', 'A 教室']);
  });

  it('別 org 的分校：404', async () => {
    expect((await setup().call('GET', `/${FOREIGN}/classrooms`)).status).toBe(404);
  });

  it('範圍外的分校：403', async () => {
    expect((await setup([MINE]).call('GET', `/${SIBLING}/classrooms`)).status).toBe(403);
  });
});

describe('POST /{id}/classrooms', () => {
  it('新增：org_id 取自分校列、空設備存 null、記稽核', async () => {
    const { call, rooms, db } = setup();
    const { status, body } = await call('POST', `/${MINE}/classrooms`, {
      name: '  C 教室 ',
      capacity: 24,
      equipment: '   ',
    });

    expect(status).toBe(201);
    expect(body.data).toMatchObject({ name: 'C 教室', capacity: 24, equipment: null });
    const stored = rooms().find((r) => r['name'] === 'C 教室');
    expect(stored).toMatchObject({ org_id: ORG, campus_id: MINE, equipment: null });

    const audit = db.rows('audit_logs').find((r) => r['action'] === 'classroom.create');
    expect(audit).toMatchObject({ resource_type: 'campus', resource_id: MINE });
  });

  it('別 org 的分校：404，那邊沒有多一間教室', async () => {
    const { call, rooms } = setup();
    const { status } = await call('POST', `/${FOREIGN}/classrooms`, { name: '入侵教室' });

    expect(status).toBe(404);
    expect(rooms().some((r) => r['name'] === '入侵教室')).toBe(false);
  });

  it('範圍外的分校：403，沒寫', async () => {
    const { call, rooms } = setup([MINE]);
    const { status } = await call('POST', `/${SIBLING}/classrooms`, { name: '越權教室' });

    expect(status).toBe(403);
    expect(rooms().some((r) => r['name'] === '越權教室')).toBe(false);
  });

  it('body 夾帶 orgId／campusId 也不會被採用', async () => {
    const { call, rooms } = setup();
    await call('POST', `/${MINE}/classrooms`, {
      name: 'D 教室',
      orgId: OTHER_ORG,
      org_id: OTHER_ORG,
      campus_id: FOREIGN,
    });

    expect(rooms().find((r) => r['name'] === 'D 教室')).toMatchObject({
      org_id: ORG,
      campus_id: MINE,
    });
  });

  it('空白名稱、容量 0：400', async () => {
    const { call } = setup();
    expect((await call('POST', `/${MINE}/classrooms`, { name: '   ' })).status).toBe(400);
    expect((await call('POST', `/${MINE}/classrooms`, { name: 'E', capacity: 0 })).status).toBe(
      400,
    );
  });

  it('同分校同名（23505）：409 CLASSROOM_NAME_TAKEN', async () => {
    const { call, db } = setup();
    failWrite(db.client, 'insert');
    const { status, body } = await call('POST', `/${MINE}/classrooms`, { name: 'A 教室' });

    expect(status).toBe(409);
    expect(body.code).toBe('CLASSROOM_NAME_TAKEN');
  });
});

describe('PUT /{id}/classrooms/{roomId}', () => {
  it('改名＋容量：寫進去，稽核記 from/to', async () => {
    const { call, rooms, db } = setup();
    const { status } = await call('PUT', `/${MINE}/classrooms/${ROOM_A}`, {
      name: 'A1 教室',
      capacity: 12,
    });

    expect(status).toBe(200);
    expect(rooms().find((r) => r['id'] === ROOM_A)).toMatchObject({
      name: 'A1 教室',
      capacity: 12,
    });
    const audit = db.rows('audit_logs').find((r) => r['action'] === 'classroom.update');
    expect(audit?.['details']).toMatchObject({
      classroomId: ROOM_A,
      from: { name: 'A 教室', capacity: 30 },
      to: { name: 'A1 教室', capacity: 12 },
    });
  });

  it('同 org 別分校的教室掛在自己分校網址下：404，沒改', async () => {
    const { call, rooms } = setup([MINE]);
    const { status } = await call('PUT', `/${MINE}/classrooms/${ROOM_SIBLING}`, { name: '偷改' });

    expect(status).toBe(404);
    expect(rooms().find((r) => r['id'] === ROOM_SIBLING)?.['name']).toBe(ROOM_SIBLING);
  });

  it('別 org 的教室掛在自己分校網址下：404，沒改', async () => {
    const { call, rooms } = setup();
    const { status } = await call('PUT', `/${MINE}/classrooms/${ROOM_FOREIGN}`, { name: '偷改' });

    expect(status).toBe(404);
    expect(rooms().find((r) => r['id'] === ROOM_FOREIGN)?.['name']).toBe(ROOM_FOREIGN);
  });

  // 只有分校條件時這一列會被改到：org 條件是 c1 那道牆本身，不是分校條件的附屬品
  it('教室列的 org_id 跟分校對不上（髒資料）：404，沒改', async () => {
    const STRAY = '00000000-0000-0000-0000-0000000000d5';
    const { call, rooms } = setup(null, [room(STRAY, MINE, OTHER_ORG)]);
    const { status } = await call('PUT', `/${MINE}/classrooms/${STRAY}`, { name: '偷改' });

    expect(status).toBe(404);
    expect(rooms().find((r) => r['id'] === STRAY)?.['name']).toBe(STRAY);
  });

  it('範圍外的分校：403，沒改', async () => {
    const { call, rooms } = setup([MINE]);
    const { status } = await call('PUT', `/${SIBLING}/classrooms/${ROOM_SIBLING}`, {
      name: '偷改',
    });

    expect(status).toBe(403);
    expect(rooms().find((r) => r['id'] === ROOM_SIBLING)?.['name']).toBe(ROOM_SIBLING);
  });

  it('改成同分校已有的名字（23505）：409', async () => {
    const { call, db } = setup();
    failWrite(db.client, 'update');
    const { status, body } = await call('PUT', `/${MINE}/classrooms/${ROOM_A}`, { name: '重複' });

    expect(status).toBe(409);
    expect(body.code).toBe('CLASSROOM_NAME_TAKEN');
  });
});

describe('DELETE /{id}/classrooms/{roomId}', () => {
  it('刪掉，回應帶受影響時段數，稽核留快照', async () => {
    const { call, rooms, db } = setup();
    const { status, body } = await call('DELETE', `/${MINE}/classrooms/${ROOM_A}`);

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, affectedSchedules: 1 });
    expect(rooms().some((r) => r['id'] === ROOM_A)).toBe(false);
    const audit = db.rows('audit_logs').find((r) => r['action'] === 'classroom.delete');
    expect(audit?.['details']).toMatchObject({
      classroomId: ROOM_A,
      affectedSchedules: 1,
      name: 'A 教室',
    });
  });

  it('同 org 別分校的教室：404，沒刪', async () => {
    const { call, rooms } = setup();
    expect((await call('DELETE', `/${MINE}/classrooms/${ROOM_SIBLING}`)).status).toBe(404);
    expect(rooms().some((r) => r['id'] === ROOM_SIBLING)).toBe(true);
  });

  it('別 org 的教室（網址用別 org 的分校）：404，沒刪', async () => {
    const { call, rooms } = setup();
    expect((await call('DELETE', `/${FOREIGN}/classrooms/${ROOM_FOREIGN}`)).status).toBe(404);
    expect(rooms().some((r) => r['id'] === ROOM_FOREIGN)).toBe(true);
  });

  it('範圍外的分校：403，沒刪', async () => {
    const { call, rooms } = setup([MINE]);
    expect((await call('DELETE', `/${SIBLING}/classrooms/${ROOM_SIBLING}`)).status).toBe(403);
    expect(rooms().some((r) => r['id'] === ROOM_SIBLING)).toBe(true);
  });
});

describe('GET / —— 每列帶 classroomCount', () => {
  it('數自己分校的教室，沒有的是 0', async () => {
    const { call } = setup(null, [room('00000000-0000-0000-0000-0000000000d4', MINE)]);
    const { status, body } = await call('GET', '/');

    expect(status).toBe(200);
    const count = Object.fromEntries(
      body.data.map((c: { id: string; classroomCount: number }) => [c.id, c.classroomCount]),
    );
    expect(count).toEqual({ [MINE]: 2, [SIBLING]: 1 });
  });

  it('教室數讀失敗：500，不印「還沒有教室」', async () => {
    const { call, db } = setup();
    const client = db.client as { from: (t: string) => unknown };
    const from = client.from.bind(client);
    vi.spyOn(client, 'from').mockImplementation((table: string) => {
      if (table !== 'classrooms') return from(table);
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: null, error: { code: 'XX000', message: 'boom' } }),
      });
      return chain;
    });

    expect((await call('GET', '/')).status).toBe(500);
  });
});

/** 替身不做 UNIQUE —— 把 classrooms 的 insert／update 換成回 23505 */
function failWrite(client: unknown, op: 'insert' | 'update') {
  const c = client as { from: (t: string) => Record<string, unknown> };
  const from = c.from.bind(c);
  vi.spyOn(c, 'from').mockImplementation((table: string) => {
    const real = from(table);
    if (table !== 'classrooms') return real;
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      eq: () => chain,
      select: () => chain,
      single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }),
    });
    return { ...real, [op]: () => chain };
  });
}
