import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import studentsRoute from './students';

/**
 * 學生列表依「年級（高年級在前）→ 姓名」排序（#1314 名冊換形前置；照 A6，計畫席 10-10 裁）。
 *
 * ⚠️ 替身比的是字串，**驗不出 enum 的列舉序**（真 DB 是 P1…S3，字串序是 J… < P… < S…）。
 * 這支只驗鍵的優先序；列舉序由契約測試對真 PostgREST 驗（`list-endpoints.contract.ts`）。
 */
describe('GET /students —— 先年級（高年級在前）、再姓名', () => {
  it('混排的 fixture 依年級分組（J2 在 J1 前）、組內依姓名', async () => {
    const student = (id: string, grade: string, name: string) => ({
      id,
      org_id: 'org-a',
      grade,
      name,
      is_active: true,
    });
    const db = createMultiOrgDb({
      students: [
        student('s1', 'J2', 'Amy'),
        student('s2', 'J1', 'Ben'),
        student('s3', 'J2', 'Cat'),
        student('s4', 'J1', 'Ann'),
      ],
      parent_student_relations: [],
    });
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db.client);
      set('orgId', 'org-a');
      set('userId', 'u1');
      set('roles', ['admin']);
      set('campusScope', null);
      await next();
    });
    app.route('/', studentsRoute as unknown as Hono);

    const body = (await (await app.request('/?withToday=false')).json()) as {
      data: Array<{ name: string }>;
    };
    // 只照姓名排會是 Amy, Ann, Ben, Cat
    expect(body.data.map((s) => s.name)).toEqual(['Amy', 'Cat', 'Ann', 'Ben']);
  });

  // reviewer 二讀 #1473：末鍵 order('id') 沒被守。同名同年級時沒有末鍵，翻頁會重複／漏人。
  // 插入順序刻意跟 id 相反 —— 少了 id 鍵，替身會照插入順序回、這條就紅
  it('同年級同名：依 id 穩定翻頁（第 1 頁 a、第 2 頁 b）', async () => {
    const twin = (id: string) => ({
      id,
      org_id: 'org-a',
      grade: 'J1',
      name: '王小明',
      is_active: true,
    });
    const db = createMultiOrgDb({ students: [twin('b'), twin('a')], parent_student_relations: [] });
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db.client);
      set('orgId', 'org-a');
      set('userId', 'u1');
      set('roles', ['admin']);
      set('campusScope', null);
      await next();
    });
    app.route('/', studentsRoute as unknown as Hono);
    const page = async (n: number) =>
      (
        (await (await app.request(`/?pageSize=1&page=${n}&withToday=false`)).json()) as {
          data: Array<{ id: string }>;
        }
      ).data.map((s) => s.id);

    expect([...(await page(1)), ...(await page(2))]).toEqual(['a', 'b']);
  });
});
