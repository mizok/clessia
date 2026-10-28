import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classesRoute from './classes';

/**
 * #1796：時段指定教室 —— 教室要屬於本 org、**而且跟班級同一個分校**。
 * FK 只保證教室存在，擋不住別 org、別分校（#1765 migration 註解：由 API 驗）。
 * 別 org（或不存在）→ 404；本 org 別分校 → 409。PUT 只在真的換了教室才驗（同 #854 老師）。
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const CAMPUS_1 = id(11);
const CAMPUS_2 = id(12);
const CAMPUS_B = id(13);
const CLASS = id(101);
const SCHEDULE = id(201);
const ROOM_SAME = id(301);
const ROOM_SIBLING = id(302);
const ROOM_FOREIGN = id(303);
const SLOT = { weekday: 2, startTime: '14:00', endTime: '15:00' };

function setup(scheduleRoom: string | null = null, insertErrorCode?: string) {
  const db = createMultiOrgDb({
    classes: [{ id: CLASS, org_id: ORG_A, campus_id: CAMPUS_1, name: 'A 班', is_active: true }],
    classrooms: [
      { id: ROOM_SAME, org_id: ORG_A, campus_id: CAMPUS_1, name: 'A 教室' },
      { id: ROOM_SIBLING, org_id: ORG_A, campus_id: CAMPUS_2, name: '別校教室' },
      { id: ROOM_FOREIGN, org_id: ORG_B, campus_id: CAMPUS_B, name: '別 org 教室' },
    ],
    schedules: [
      {
        id: SCHEDULE,
        class_id: CLASS,
        weekday: 1,
        start_time: '10:00',
        end_time: '11:00',
        teacher_id: null,
        classroom_id: scheduleRoom,
        // 替身不解 PostgREST 的嵌入：`classrooms(name)` 直接放在列上
        classrooms: scheduleRoom === ROOM_SAME ? { name: 'A 教室' } : null,
      },
    ],
    audit_logs: [],
    profiles: [],
  });
  const call = async (method: string, path: string, body: unknown) => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      // 替身不模擬 DB 約束：要驗約束錯誤怎麼對成 HTTP 時，讓 schedules 的 insert 直接回那個錯誤碼
      const client = db.client as { from: (t: string) => Record<string, unknown> };
      set(
        'supabase',
        insertErrorCode
          ? {
              ...client,
              from: (t: string) =>
                t === 'schedules'
                  ? {
                      ...client.from(t),
                      insert: () => ({
                        select: () => ({
                          single: () =>
                            Promise.resolve({
                              data: null,
                              error: { code: insertErrorCode, message: 'constraint' },
                            }),
                        }),
                      }),
                    }
                  : client.from(t),
            }
          : db.client,
      );
      set('orgId', ORG_A);
      set('userId', 'admin-a');
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', classesRoute as unknown as Hono);
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const schedules = () => db.rows('schedules');
  const audits = () => db.rows('audit_logs');
  const roomOf = (sid: string) => schedules().find((r) => r['id'] === sid)?.['classroom_id'];
  return { call, schedules, roomOf, audits };
}

describe('POST /api/classes/{id}/schedules —— 指定教室（#1796）', () => {
  it('同分校的教室：寫進去，回應帶 classroomId；稽核記得指定了哪間', async () => {
    const { call, schedules, audits } = setup();
    const { status, body } = await call('POST', `/${CLASS}/schedules`, {
      ...SLOT,
      classroomId: ROOM_SAME,
    });
    expect(status).toBe(201);
    expect(body.data.classroomId).toBe(ROOM_SAME);
    expect(schedules().find((r) => r['weekday'] === 2)?.['classroom_id']).toBe(ROOM_SAME);
    await new Promise((r) => setTimeout(r, 0)); // 稽核在背景寫
    expect(audits().find((r) => r['action'] === 'add_schedule')?.['details']).toMatchObject({
      classroomId: ROOM_SAME,
    });
  });

  it('不帶或 null：不指定', async () => {
    const { call, schedules } = setup();
    expect((await call('POST', `/${CLASS}/schedules`, SLOT)).status).toBe(201);
    expect(
      (await call('POST', `/${CLASS}/schedules`, { ...SLOT, weekday: 3, classroomId: null }))
        .status,
    ).toBe(201);
    expect(
      schedules()
        .filter((r) => r['weekday'] !== 1)
        .map((r) => r['classroom_id']),
    ).toEqual([null, null]);
  });

  it('本 org、別分校的教室 → 409 CLASSROOM_CAMPUS_MISMATCH，沒寫', async () => {
    const { call, schedules } = setup();
    const { status, body } = await call('POST', `/${CLASS}/schedules`, {
      ...SLOT,
      classroomId: ROOM_SIBLING,
    });
    expect(status).toBe(409);
    expect(body.code).toBe('CLASSROOM_CAMPUS_MISMATCH');
    expect(schedules()).toHaveLength(1);
  });

  it('別 org 的教室 → 404 CLASSROOM_NOT_FOUND，沒寫', async () => {
    const { call, schedules } = setup();
    const { status, body } = await call('POST', `/${CLASS}/schedules`, {
      ...SLOT,
      classroomId: ROOM_FOREIGN,
    });
    expect(status).toBe(404);
    expect(body.code).toBe('CLASSROOM_NOT_FOUND');
    expect(schedules()).toHaveLength(1);
  });
});

describe('PUT /api/classes/{id}/schedules/{sid} —— 指定教室（#1796）', () => {
  it('換成同分校的教室：寫進去', async () => {
    const { call, roomOf } = setup();
    const { status, body } = await call('PUT', `/${CLASS}/schedules/${SCHEDULE}`, {
      classroomId: ROOM_SAME,
    });
    expect(status).toBe(200);
    expect(body.data.classroomId).toBe(ROOM_SAME);
    expect(roomOf(SCHEDULE)).toBe(ROOM_SAME);
  });

  it('換成別分校的 → 409；別 org 的 → 404；原本的沒動', async () => {
    const { call, roomOf } = setup(ROOM_SAME);
    const sibling = await call('PUT', `/${CLASS}/schedules/${SCHEDULE}`, {
      classroomId: ROOM_SIBLING,
    });
    expect(sibling.status).toBe(409);
    expect(sibling.body.code).toBe('CLASSROOM_CAMPUS_MISMATCH');

    const foreign = await call('PUT', `/${CLASS}/schedules/${SCHEDULE}`, {
      classroomId: ROOM_FOREIGN,
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('CLASSROOM_NOT_FOUND');
    expect(roomOf(SCHEDULE)).toBe(ROOM_SAME);
  });

  it('回應帶教室名（classroomName）', async () => {
    const { call } = setup(ROOM_SAME);
    const { body } = await call('PUT', `/${CLASS}/schedules/${SCHEDULE}`, { startTime: '10:30' });
    expect(body.data).toMatchObject({ classroomId: ROOM_SAME, classroomName: 'A 教室' });
  });

  it('改回不指定（null）：寫成 null', async () => {
    const { call, roomOf } = setup(ROOM_SAME);
    expect(
      (await call('PUT', `/${CLASS}/schedules/${SCHEDULE}`, { classroomId: null })).status,
    ).toBe(200);
    expect(roomOf(SCHEDULE)).toBeNull();
  });

  it('沒換教室不重驗：班級後來換了分校，帶著舊教室改時間照樣存得進去（不鎖死）', async () => {
    // 時段原本指的是別分校的教室（班級換過分校的歷史資料）；前端改時間時把它原封送回
    const { call, schedules } = setup(ROOM_SIBLING);
    const { status } = await call('PUT', `/${CLASS}/schedules/${SCHEDULE}`, {
      startTime: '10:30',
      classroomId: ROOM_SIBLING,
    });
    expect(status).toBe(200);
    expect(schedules()[0]).toMatchObject({ start_time: '10:30', classroom_id: ROOM_SIBLING });
  });
});

// #1100 #22：唯一鍵換成排除約束後，同時段重疊的錯誤碼是 23P01（不是 23505）——兩個都要是 409
describe('POST /api/classes/{id}/schedules —— 同時段已存在（#1100 #22）', () => {
  it.each(['23505', '23P01'])('DB 回 %s → 409 DUPLICATE（不是 400）', async (code) => {
    const { call } = setup(null, code);
    const { status, body } = await call('POST', `/${CLASS}/schedules`, SLOT);
    expect(status).toBe(409);
    expect(body.code).toBe('DUPLICATE');
  });
});
