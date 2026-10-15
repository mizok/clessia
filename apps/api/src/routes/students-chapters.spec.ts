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

function seed(extraStudents: Array<Record<string, unknown>> = []) {
  return createMultiOrgDb({
    students: [
      ...extraStudents,
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

type SelectableBuilder = {
  select: (cols?: string, opts?: { count?: string; head?: boolean }) => unknown;
};

function appWith(
  campusScope: string[] | null = null,
  extraStudents: Array<Record<string, unknown>> = [],
  /** 記下每次 `from('students')` 的 select 字串，用來數查詢支數 */
  studentSelects: string[] = [],
  /** 聚合查詢（`count()`）回 error —— 模擬正式站沒開 `pgrst.db_aggregates_enabled` */
  failAggregate = false,
) {
  const db = seed(extraStudents);
  const failing = () => {
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: { message: 'Use of aggregate functions is not allowed' } }),
    };
    for (const m of ['eq', 'in', 'or', 'not', 'is']) chain[m] = () => chain;
    return chain;
  };
  const client = new Proxy(db.client as { from: (table: string) => SelectableBuilder }, {
    get: (target, key, receiver) =>
      key === 'from'
        ? (table: string) => {
            const builder = target.from(table);
            if (table !== 'students') return builder;
            const select = builder.select.bind(builder);
            return Object.assign(builder, {
              select: (cols?: string, opts?: { count?: string; head?: boolean }) => {
                studentSelects.push(cols ?? '*');
                if (failAggregate && /count\(\)/.test(cols ?? '')) return failing();
                return select(cols, opts);
              },
            });
          }
        : Reflect.get(target, key, receiver),
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', client);
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
  // #1595 P3b-B：12 個年級一支 GROUP BY 數完，不是每級一支 head count（14 支會排成 3 波）
  // 正式站若沒開聚合（migration 沒套、或被回退），count() 會回 error —— 要 500，不能默默顯示全 0
  it('年級計數查詢回 error → 500', async () => {
    const res = await appWith(null, [], [], true).request('/?withToday=false');
    expect(res.status).toBe(500);
  });

  it('年級計數只用一支聚合查詢', async () => {
    const selects: string[] = [];
    const res = await appWith(null, [], selects).request('/?withToday=false');
    expect(res.status).toBe(200);
    expect(selects.filter((cols) => /count\(\)/.test(cols))).toHaveLength(1);
    expect(selects).toHaveLength(3); // 列表、在籍數、年級計數
  });

  it('每個年級都回（高年級在前 S3→P1，同列表），只數本 org', async () => {
    const { counts, byGrade } = await list('');

    expect(byGrade.map((g) => g.grade)).toEqual([
      'S3',
      'S2',
      'S1',
      'J3',
      'J2',
      'J1',
      'P6',
      'P5',
      'P4',
      'P3',
      'P2',
      'P1',
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

  // reviewer 二讀 #1450 抓的：學校查詢拿掉 `.eq('org_id')` 原本全綠。
  // 本 org 學生的 school_id 指到**別 org** 的同名學校（髒資料）—— 搜尋不能因別 org 的學校命中他
  it('別 org 的同名學校不命中本 org 學生', async () => {
    const res = await appWith(null, [student('s-cross', 'J1', { school_id: 'sch-other' })]).request(
      `/?search=${encodeURIComponent('建國')}`,
    );
    const body = (await res.json()) as { data: Array<{ id: string }> };

    expect(body.data.map((row) => row.id).sort()).toEqual(['s-j1a', 's-j2']);
  });
});
