import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import studentsRoute from './students';

/**
 * #1394：受限管理員對 `/students/{id}` 的讀、改、刪跟列表同一條判準（`studentInScope`），
 * 範圍外回 404 且不寫入。替身不解析 select，`enrollments(classes(campus_id))` 直接種在學生列上。
 */

const ORG = '00000000-0000-0000-0000-0000000000aa';
const C1 = 'campus-1';
const C2 = 'campus-2';

const S0 = '00000000-0000-0000-0000-0000000000a0';
const S1 = '00000000-0000-0000-0000-0000000000a1';
const S2 = '00000000-0000-0000-0000-0000000000a2';
const S3 = '00000000-0000-0000-0000-0000000000a3';

const student = (id: string, campuses: string[]) => ({
  id,
  org_id: ORG,
  name: id,
  is_active: true,
  enrollments: campuses.map((campus_id) => ({ classes: { campus_id } })),
});

function seed() {
  return createMultiOrgDb({
    students: [
      student(S1, [C1]),
      student(S2, [C2]),
      student(S3, [C1, C2]),
      // 沒有任何報名：推不出分校
      student(S0, []),
    ],
    enrollments: [
      { id: 'e1', org_id: ORG, student_id: S1 },
      { id: 'e2', org_id: ORG, student_id: S2 },
      { id: 'e3', org_id: ORG, student_id: S3 },
    ],
    audit_logs: [],
    profiles: [],
  });
}

function appWith(db: ReturnType<typeof seed>, campusScope: string[] | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', campusScope);
    await next();
  });
  app.route('/', studentsRoute as unknown as Hono);
  return app;
}

const put = (app: Hono, id: string) =>
  app.request(`/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '改過' }),
  });

const nameOf = (db: ReturnType<typeof seed>, id: string) =>
  db.rows('students').find((row) => row['id'] === id)?.['name'];

describe('/students/{id} —— 受限管理員的分校範圍（#1394）', () => {
  it('GET：範圍內（含跨校）200，範圍外與無報名 404', async () => {
    const app = appWith(seed(), [C1]);

    expect((await app.request(`/${S1}`)).status).toBe(200);
    expect((await app.request(`/${S3}`)).status).toBe(200);
    expect((await app.request(`/${S2}`)).status).toBe(404);
    expect((await app.request(`/${S0}`)).status).toBe(404);
  });

  it('PUT：範圍外 404 且沒寫入；範圍內照改', async () => {
    const db = seed();
    const app = appWith(db, [C1]);

    expect((await put(app, S2)).status).toBe(404);
    expect(nameOf(db, S2)).toBe(S2);
    expect((await put(app, S1)).status).toBe(200);
    expect(nameOf(db, S1)).toBe('改過');
  });

  it('DELETE：無報名的學生對受限者是範圍外 → 404 且還在', async () => {
    const db = seed();

    expect((await appWith(db, [C1]).request(`/${S0}`, { method: 'DELETE' })).status).toBe(404);
    expect(nameOf(db, S0)).toBe(S0);
  });

  it('一個分校都沒有：範圍內的也 404', async () => {
    expect((await appWith(seed(), []).request(`/${S1}`)).status).toBe(404);
  });

  // 對照組：全校區管理員行為不變 —— 證明上面的 404 是範圍造成的
  it('不受限：讀得到別校、刪得掉無報名的', async () => {
    const db = seed();
    const app = appWith(db, null);

    expect((await app.request(`/${S2}`)).status).toBe(200);
    expect((await put(app, S2)).status).toBe(200);
    expect((await app.request(`/${S0}`, { method: 'DELETE' })).status).toBe(200);
    expect(nameOf(db, S0)).toBeUndefined();
  });
});
