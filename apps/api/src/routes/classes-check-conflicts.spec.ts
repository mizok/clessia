import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classesRoute from './classes';

/**
 * **排課衝突預檢（POST /api/classes/check-conflicts，#1928）**。
 *
 * 原本先撈「整個 org 歷年所有班級 id」再塞進 `.in('class_id', …)`：班一多就 414，而錯誤是 soft-fail ——
 * 回 200「沒有衝突」。兩支讀取也都沒有把失敗當失敗（第一支連 error 都沒看）。
 * 前端在這支失敗時本來就照常儲存（class-form-dialog），所以回 5xx 不會擋住存檔，只是不再假裝「沒有衝突」。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER_ORG = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const TEACHER = id(1);
const CLASS_A = id(101);
const CLASS_B = id(102);
const CLASS_OTHER_ORG = id(201);
const SLOT = { weekday: 2, startTime: '14:00', endTime: '15:00' };

const schedule = (sid: number, classId: string, orgId: string, name: string) => ({
  id: id(sid),
  class_id: classId,
  teacher_id: TEACHER,
  weekday: 2,
  start_time: '14:30:00',
  end_time: '15:30:00',
  effective_to: null,
  // 替身不做 join：把 embed 的結果直接放在列上（同 PostgREST 回的形狀）
  classes: { org_id: orgId, name, courses: { name: `${name}的課` } },
  staff: { display_name: '王老師' },
});

function seed() {
  return createMultiOrgDb({
    classes: [
      { id: CLASS_A, org_id: ORG, name: 'A 班' },
      { id: CLASS_B, org_id: ORG, name: 'B 班' },
      { id: CLASS_OTHER_ORG, org_id: OTHER_ORG, name: '別家的班' },
    ],
    schedules: [
      schedule(11, CLASS_A, ORG, 'A 班'),
      schedule(12, CLASS_OTHER_ORG, OTHER_ORG, '別家的班'),
    ],
  });
}
type Db = ReturnType<typeof seed>;

/** 某張表的讀取一律失敗 */
function failReads(db: Db, table: string) {
  const client = db.client as unknown as { from: (t: string) => unknown };
  const from = client.from.bind(client);
  const failing = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'neq', 'order', 'is']) q[m] = () => q;
    q['then'] = (ok: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok);
    return q;
  };
  client.from = (t: string) => (t === table ? failing() : from(t));
  return db;
}

async function check(db: Db, body: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'admin-1');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', null);
    await next();
  });
  app.route('/', classesRoute as unknown as Hono);
  const res = await app.request('/check-conflicts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as never };
}

describe('POST /check-conflicts（#1928）', () => {
  it('同 org 同老師同一天時段重疊 → 回衝突（班名、課名、老師名）', async () => {
    const res = await check(seed(), { schedules: [{ ...SLOT, teacherId: TEACHER }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      conflicts: [
        {
          scheduleIndex: 0,
          teacherName: '王老師',
          conflictingClassId: CLASS_A,
          conflictingClassName: 'A 班',
          conflictingCourseName: 'A 班的課',
        },
      ],
    });
  });

  it('別的 org 的班不算（同一個老師 id、同一個時段也一樣）', async () => {
    const res = await check(seed(), { schedules: [{ ...SLOT, teacherId: TEACHER }] });
    const ids = (res.body as { conflicts: { conflictingClassId: string }[] }).conflicts.map(
      (c) => c.conflictingClassId,
    );
    expect(ids).not.toContain(CLASS_OTHER_ORG);
  });

  it('excludeClassId（編輯中的那個班自己）不算', async () => {
    const res = await check(seed(), {
      schedules: [{ ...SLOT, teacherId: TEACHER }],
      excludeClassId: CLASS_A,
    });
    expect(res).toEqual({ status: 200, body: { conflicts: [] } });
  });

  it('時段讀取失敗 → 500，不是 200「沒有衝突」', async () => {
    const res = await check(failReads(seed(), 'schedules'), {
      schedules: [{ ...SLOT, teacherId: TEACHER }],
    });
    expect(res.status).toBe(500);
  });

  it('不先撈整個 org 的班級 id（那份清單塞回 .in 會 414）：org 範圍在時段查詢的 join 裡套', async () => {
    const db = seed();
    const client = db.client as unknown as { from: (t: string) => unknown };
    const from = client.from.bind(client);
    const tables: string[] = [];
    client.from = (t: string) => (tables.push(t), from(t));
    const res = await check(db, { schedules: [{ ...SLOT, teacherId: TEACHER }] });
    expect(res.status).toBe(200);
    expect(tables).toEqual(['schedules']);
  });

  // 替身不解析 select：`classes!inner` 沒寫，org 條件只濾嵌入那層、別 org 的時段照樣回來。
  // 真 PostgREST 的行為由 contract/check-conflicts.contract.ts 守，這裡是便宜的第一道
  it('時段查詢的 select 用 classes!inner、條件下在 classes.org_id 與 teacher_id', async () => {
    const db = seed();
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const from = client.from.bind(client);
    const seen: unknown[][] = [];
    client.from = (t: string) => {
      const q = from(t);
      for (const m of ['select', 'eq', 'in']) {
        const orig = (q[m] as (...a: unknown[]) => unknown).bind(q);
        q[m] = (...a: unknown[]) => (seen.push([t, m, ...a]), orig(...a));
      }
      return q;
    };
    await check(db, { schedules: [{ ...SLOT, teacherId: TEACHER }] });
    const select = seen.find((c) => c[0] === 'schedules' && c[1] === 'select')?.[2] as string;
    expect(select).toMatch(/(^|[\s,])classes!inner\(/);
    expect(seen).toContainEqual(['schedules', 'eq', 'classes.org_id', ORG]);
    expect(seen).toContainEqual(['schedules', 'in', 'teacher_id', [TEACHER]]);
  });
});
