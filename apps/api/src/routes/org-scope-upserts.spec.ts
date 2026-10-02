import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classLogsRoute from './class-logs';
import contactBookRoute from './contact-book';
import dailyCheckinsRoute from './daily-checkins';

/**
 * **衝突鍵不含 `org_id` 的 upsert，寫入前要驗 id 屬於本 org（c1，#966 B6）。**
 *
 * `studentWriteScope`／`classWriteScope`（原 `isStudentInScope`／`isClassInScope`）在
 * `scope === null`（不受限的管理員）時原本直接放行。這三支的 upsert 衝突鍵是
 * `student_id,…`／`class_id,…`，payload 又寫 `org_id: orgId` —— 拿別 org 的 id 打進來，
 * **別 org 那一列被整列覆寫、`org_id` 換成呼叫者的**（#1043 meals 同形）。
 *
 * 兩組（計畫席裁定 A）：
 * - 別 org 的 id → **404**，不分受限與否，那一列沒變
 * - 同 org 但分校外 → **403**（文案不變），那一列沒變
 * 再加一條同 org 分校內 → 成功，防過度擋。
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const CAMPUS_A1 = id(11);
const CAMPUS_A2 = id(12);
const CLASS_A1 = id(21); // A1 校
const CLASS_A2 = id(22); // A2 校
const CLASS_B = id(23);
const STUDENT_A1 = id(31); // 只在 A1 校有報名
const STUDENT_A2 = id(32); // 只在 A2 校有報名
const STUDENT_B = id(33);
const DATE = '2026-04-01';

function seed() {
  return createMultiOrgDb({
    students: [
      { id: STUDENT_A1, org_id: ORG_A, name: '甲' },
      { id: STUDENT_A2, org_id: ORG_A, name: '乙' },
      { id: STUDENT_B, org_id: ORG_B, name: '丙' },
    ],
    classes: [
      { id: CLASS_A1, org_id: ORG_A, campus_id: CAMPUS_A1, name: 'A1 班' },
      { id: CLASS_A2, org_id: ORG_A, campus_id: CAMPUS_A2, name: 'A2 班' },
      { id: CLASS_B, org_id: ORG_B, campus_id: id(13), name: 'B 班' },
    ],
    enrollments: [
      {
        org_id: ORG_A,
        student_id: STUDENT_A1,
        status: 'active',
        classes: { campus_id: CAMPUS_A1 },
      },
      {
        org_id: ORG_A,
        student_id: STUDENT_A2,
        status: 'active',
        classes: { campus_id: CAMPUS_A2 },
      },
    ],
    // 每支都先放一列「那一天已經寫好的」—— 覆寫就會改到它
    daily_checkins: [
      { id: id(41), org_id: ORG_B, student_id: STUDENT_B, checkin_date: DATE },
      { id: id(42), org_id: ORG_A, student_id: STUDENT_A2, checkin_date: DATE },
    ],
    contact_book_entries: [
      { id: id(51), org_id: ORG_B, student_id: STUDENT_B, entry_date: DATE, content: 'B 原文' },
      { id: id(52), org_id: ORG_A, student_id: STUDENT_A2, entry_date: DATE, content: 'A2 原文' },
    ],
    class_logs: [
      { id: id(61), org_id: ORG_B, class_id: CLASS_B, log_date: DATE, homework: 'B 原文' },
      { id: id(62), org_id: ORG_A, class_id: CLASS_A2, log_date: DATE, homework: 'A2 原文' },
    ],
    events: [],
    attendance_records: [],
  });
}

type Db = ReturnType<typeof seed>;

function call(db: Db, route: unknown, method: string, body: unknown, scope: string[] | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG_A);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', scope);
    await next();
  });
  app.route('/', route as Hono);
  return app.request('/', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const CASES = [
  {
    name: 'POST /api/daily-checkins',
    route: dailyCheckinsRoute,
    method: 'POST',
    table: 'daily_checkins',
    key: 'student_id',
    body: (target: string) => ({ studentId: target, checkinDate: DATE }),
    theirs: STUDENT_B,
    outOfCampus: STUDENT_A2,
    inCampus: STUDENT_A1,
    ok: 201,
  },
  {
    name: 'PUT /api/contact-book',
    route: contactBookRoute,
    method: 'PUT',
    table: 'contact_book_entries',
    key: 'student_id',
    body: (target: string) => ({ studentId: target, entryDate: DATE, content: '覆寫' }),
    theirs: STUDENT_B,
    outOfCampus: STUDENT_A2,
    inCampus: STUDENT_A1,
    ok: 200,
  },
  {
    name: 'PUT /api/class-logs',
    route: classLogsRoute,
    method: 'PUT',
    table: 'class_logs',
    key: 'class_id',
    body: (target: string) => ({ classId: target, logDate: DATE, homework: '覆寫' }),
    theirs: CLASS_B,
    outOfCampus: CLASS_A2,
    inCampus: CLASS_A1,
    ok: 200,
  },
] as const;

describe.each(CASES)('$name', (t) => {
  const rowOf = (db: Db, target: string) => db.rows(t.table).filter((r) => r[t.key] === target);

  it.each([
    ['不受分校限制', null],
    ['受分校限制', [CAMPUS_A1]],
  ] as const)('別 org 的 id（%s）→ 404，那一列沒變', async (_label, scope) => {
    const db = seed();
    const before = rowOf(db, t.theirs);

    const res = await call(db, t.route, t.method, t.body(t.theirs), scope ? [...scope] : null);

    expect(res.status).toBe(404);
    expect(rowOf(db, t.theirs)).toEqual(before);
  });

  it('同 org 但分校外 → 403（文案不變），那一列沒變', async () => {
    const db = seed();
    const before = rowOf(db, t.outOfCampus);

    const res = await call(db, t.route, t.method, t.body(t.outOfCampus), [CAMPUS_A1]);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('沒有這個分校的權限');
    expect(rowOf(db, t.outOfCampus)).toEqual(before);
  });

  it('同 org 分校內 → 成功（防過度擋）', async () => {
    const db = seed();

    const res = await call(db, t.route, t.method, t.body(t.inCampus), [CAMPUS_A1]);

    expect(res.status).toBe(t.ok);
    expect(rowOf(db, t.inCampus)).toEqual([expect.objectContaining({ org_id: ORG_A })]);
  });
});
