import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classesApp from './classes';

/**
 * `GET /api/classes/:id/school-calendar`（#1160，產生課堂的疊圖）。
 * 守的條件：只算這班**在讀**的學生（active／pending_payment）、同一位學生只算一次、
 * 只列這些學生的學校、區間重疊即列、別 org 的不列。分校範圍由 `/:id/*` 守門處理
 * （campus-scope-classes.spec 守著那支中介層）。
 */
type Row = Record<string, unknown>;

const ORG = 'org-1';
const CLS = '00000000-0000-4000-8000-0000000000c1';
const CLS_X = '00000000-0000-4000-8000-0000000000c9';
const A = 'school-a';
const B = 'school-b';
const C = 'school-c'; // 沒有學生在這班

const enr = (student: string, school: string | null, status = 'active', cls = CLS): Row => ({
  org_id: ORG,
  class_id: cls,
  student_id: student,
  status,
  students: { school_id: school },
});

const ev = (school: string, name: string, start: string, end: string, org = ORG): Row => ({
  org_id: org,
  school_id: school,
  kind: 'winter_break',
  start_date: start,
  end_date: end,
  note: null,
  schools: { name },
});

function seed(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    classes: [
      { id: CLS, org_id: ORG },
      { id: CLS_X, org_id: 'org-2' },
    ],
    enrollments: [
      enr('s1', A),
      enr('s1', A, 'pending_payment'), // 同一位學生兩筆：只算一次
      enr('s2', A, 'pending_payment'),
      enr('s3', B),
      enr('s4', null), // 沒填學校：算進學生數、不算任何學校
      enr('s5', C, 'withdrawn'), // 退班：不算
      enr('s6', C, 'active', 'other-class'),
    ],
    school_calendar_events: [
      ev(A, '大安國中', '2027-01-20', '2027-02-10'),
      ev(B, '仁愛國中', '2027-02-11', '2027-02-11'),
      ev(B, '仁愛國中', '2026-06-30', '2026-06-30'), // 區間外
      ev(C, '和平國中', '2027-02-01', '2027-02-03'), // 這班沒有在讀學生
      ev(A, '別人', '2027-02-01', '2027-02-01', 'org-2'),
    ],
    ...over,
  } as Record<string, Row[]>;
}

async function get(id: string, tables = seed()) {
  const db = createMultiOrgDb(tables);
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const ctx = c as unknown as { set: (k: string, v: unknown) => void };
    ctx.set('supabase', db.client);
    ctx.set('orgId', ORG);
    ctx.set('userId', 'user-1');
    ctx.set('roles', ['admin']);
    ctx.set('campusScope', null);
    await next();
  });
  app.route('/api/classes', classesApp);
  const res = await app.request(`/api/classes/${id}/school-calendar?from=2027-02-01&to=2027-06-30`);
  return { status: res.status, body: (await res.json()) as any };
}

describe('GET /api/classes/:id/school-calendar', () => {
  it('只列在讀學生的學校、區間重疊即列，每筆帶該校在這班的學生數', async () => {
    const { status, body } = await get(CLS);
    expect(status).toBe(200);
    expect(body.data).toEqual([
      {
        kind: 'winter_break',
        startDate: '2027-01-20',
        endDate: '2027-02-10',
        note: null,
        schoolId: A,
        schoolName: '大安國中',
        studentCount: 2,
      },
      {
        kind: 'winter_break',
        startDate: '2027-02-11',
        endDate: '2027-02-11',
        note: null,
        schoolId: B,
        schoolName: '仁愛國中',
        studentCount: 1,
      },
    ]);
    // s1、s2、s3、s4（沒填學校也是這班的學生）
    expect(body.meta).toEqual({ studentCount: 4 });
  });

  it('這班沒有在讀學生 → 空陣列、studentCount 0（前端寫「這班還沒有學生」）', async () => {
    const { status, body } = await get(CLS, seed({ enrollments: [enr('s5', C, 'withdrawn')] }));
    expect(status).toBe(200);
    expect(body).toEqual({ data: [], meta: { studentCount: 0 } });
  });

  it('別 org 的班 404', async () => {
    const { status } = await get(CLS_X);
    expect(status).toBe(404);
  });
});
