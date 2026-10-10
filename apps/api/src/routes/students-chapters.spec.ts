import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import studentsRoute from './students';

/**
 * #1314 SL3／SL4：學生名冊依年級分章的計數（`summary.byGrade`）與學校名搜尋。
 *
 * 計數要跟列表吃同一組篩選、但不吃 grade —— 替身真的照條件過濾，所以兩邊分岔就會紅。
 */

const ORG = 'org-a';
const OTHER = 'org-b';

const student = (id: string, grade: string, extra: Record<string, unknown> = {}) => ({
  id,
  org_id: ORG,
  name: id,
  grade,
  school_id: null,
  is_active: true,
  ...extra,
});

function seed() {
  return createMultiOrgDb({
    students: [
      student('s-j1a', 'J1', { school_id: 'sch-jg' }),
      student('s-j1b', 'J1'),
      student('s-j2', 'J2', { school_id: 'sch-jg' }),
      student('s-j3-off', 'J3', { is_active: false }),
      { ...student('s-other', 'J1'), org_id: OTHER },
    ],
    schools: [
      { id: 'sch-jg', org_id: ORG, name: '建國國中', short_name: '建中' },
      { id: 'sch-other', org_id: OTHER, name: '建國國中', short_name: null },
    ],
    enrollments: [{ student_id: 's-j1a', classes: { campus_id: 'campus-1' } }],
    parent_student_relations: [],
  });
}

function appWith(campusScope: string[] | null = null) {
  const db = seed();
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

async function list(query: string, campusScope: string[] | null = null) {
  const res = await appWith(campusScope).request(`/?${query}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: Array<{ id: string }>;
    summary: { byGrade: Array<{ grade: string; count: number }> };
  };
  const counts = Object.fromEntries(
    body.summary.byGrade.filter((g) => g.count > 0).map((g) => [g.grade, g.count]),
  );
  return { ids: body.data.map((s) => s.id).sort(), counts, byGrade: body.summary.byGrade };
}

describe('GET /students —— 年級章節計數（#1314 SL3）', () => {
  it('每個年級都回（列舉順序），只數本 org', async () => {
    const { counts, byGrade } = await list('');

    expect(byGrade.map((g) => g.grade)).toEqual([
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
      'J1',
      'J2',
      'J3',
      'S1',
      'S2',
      'S3',
    ]);
    expect(counts).toEqual({ J1: 2, J2: 1, J3: 1 });
  });

  it('不吃 grade：篩了國一，其他年級的章名數字照樣在', async () => {
    const { ids, counts } = await list('grade=J1');

    expect(ids).toEqual(['s-j1a', 's-j1b']);
    expect(counts).toEqual({ J1: 2, J2: 1, J3: 1 });
  });

  it('吃 isActive：停用的不算', async () => {
    expect((await list('isActive=true')).counts).toEqual({ J1: 2, J2: 1 });
  });

  it('吃分校範圍：受限者只數範圍內的學生', async () => {
    expect((await list('', ['campus-1'])).counts).toEqual({ J1: 1 });
  });
});

describe('GET /students —— 搜尋學校名（#1314 SL4）', () => {
  it('全名與簡稱都找得到該校學生，計數跟著搜尋走', async () => {
    for (const q of ['建國', '建中']) {
      const { ids, counts } = await list(`search=${encodeURIComponent(q)}`);
      expect(ids).toEqual(['s-j1a', 's-j2']);
      expect(counts).toEqual({ J1: 1, J2: 1 });
    }
  });

  it('searchScope=student_name 不比學校', async () => {
    const { ids } = await list(`search=${encodeURIComponent('建國')}&searchScope=student_name`);
    expect(ids).toEqual([]);
  });
});
