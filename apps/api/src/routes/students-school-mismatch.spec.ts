import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import studentsRoute from './students';

/**
 * #1820 設計稿 §4：名冊「學制跟年級不合」篩選（`schoolMismatch=true`）。
 * 替身真的照 `or` 條件過濾 —— 子句組錯（學制對錯、漏了 org、未分類算進來）就會紅。
 */

const ORG = 'org-a';

const student = (id: string, grade: string, schoolId: string | null) => ({
  id,
  org_id: ORG,
  name: id,
  grade,
  school_id: schoolId,
  is_active: true,
});

function appWith(
  schools: Array<Record<string, unknown>>,
  /** 記下 `from('schools')` 上的 `eq` —— 別機構的學校不能進子句，替身的資料擋不出這件事 */
  schoolEqs: Array<[string, unknown]> = [],
  /** schools 讀取回 error（二讀：讀失敗不能被當成「沒有學校」而回空結果） */
  schoolsFail = false,
) {
  const db = createMultiOrgDb({
    students: [
      student('s-ok', 'J1', 'sch-j'), // 國一在國中：合
      student('s-up', 'S1', 'sch-j'), // 升高一還掛國中：不合
      student('s-p6', 'P6', 'sch-j'), // 小六掛國中：不合
      student('s-none', 'S1', null), // 沒填學校：不算
      student('s-unk', 'S1', 'sch-null'), // 未分類學校：不算
      { ...student('s-other', 'S1', 'sch-other-j'), org_id: 'org-b' },
    ],
    schools,
    enrollments: [],
    parent_student_relations: [],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    const client = db.client as { from: (t: string) => { eq: (k: string, v: unknown) => unknown } };
    set('supabase', {
      from: (table: string) => {
        const builder = client.from(table);
        if (table !== 'schools') return builder;
        if (schoolsFail) {
          const failing: Record<string, unknown> = {
            then: (ok: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok),
          };
          for (const m of ['select', 'eq']) failing[m] = () => failing;
          return failing;
        }
        const eq = builder.eq.bind(builder);
        return Object.assign(builder, {
          eq: (k: string, v: unknown) => (schoolEqs.push([k, v]), eq(k, v)),
        });
      },
    });
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', null);
    await next();
  });
  app.route('/', studentsRoute as unknown as Hono);
  return app;
}

const SCHOOLS = [
  { id: 'sch-j', org_id: ORG, name: '明湖國中', short_name: null, level: 'junior' },
  { id: 'sch-null', org_id: ORG, name: '某某附中', short_name: null, level: null },
  // 別的機構的國中：不能被拿來組子句（否則別機構的 id 會出現在查詢裡）
  { id: 'sch-other-j', org_id: 'org-b', name: '別校國中', short_name: null, level: 'senior' },
];

async function ids(app: Hono, query: string) {
  const res = await app.request(`/?withToday=false&${query}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: Array<{ id: string }>;
    summary: { byGrade: Array<{ grade: string; count: number }> };
  };
  return {
    ids: body.data.map((s) => s.id).sort(),
    counts: Object.fromEntries(
      body.summary.byGrade.filter((g) => g.count > 0).map((g) => [g.grade, g.count]),
    ),
  };
}

describe('GET /students?schoolMismatch=true（#1820）', () => {
  it('只回學校學制跟年級不合的學生；沒填學校、未分類學校不算', async () => {
    const r = await ids(appWith(SCHOOLS), 'schoolMismatch=true');
    expect(r.ids).toEqual(['s-p6', 's-up']);
  });

  it('年級章節計數吃同一個篩選', async () => {
    const r = await ids(appWith(SCHOOLS), 'schoolMismatch=true');
    expect(r.counts).toEqual({ P6: 1, S1: 1 });
  });

  it('沒帶參數時不篩', async () => {
    const r = await ids(appWith(SCHOOLS), '');
    expect(r.ids).toEqual(['s-none', 's-ok', 's-p6', 's-unk', 's-up']);
  });

  it('組子句的學校只讀本機構', async () => {
    const eqs: Array<[string, unknown]> = [];
    await ids(appWith(SCHOOLS, eqs), 'schoolMismatch=true');
    expect(eqs).toContainEqual(['org_id', ORG]);
  });

  it('讀 schools 失敗 → 500（不能退化成空結果或不篩）', async () => {
    const res = await appWith(SCHOOLS, [], true).request('/?withToday=false&schoolMismatch=true');
    expect(res.status).toBe(500);
  });

  /** 子句是 null（沒有任何組合可能不合）→ 空結果，不能退化成「不篩」 */
  it('機構的學校全是未分類 → 空結果', async () => {
    const r = await ids(
      appWith([{ id: 'sch-null', org_id: ORG, name: '某某附中', short_name: null, level: null }]),
      'schoolMismatch=true',
    );
    expect(r.ids).toEqual([]);
  });
});
