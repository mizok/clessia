import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import studentsRoute from './students';

/**
 * 學生列表依「年級 → 姓名」排序（#1314 名冊換形前置）。
 *
 * ⚠️ 替身比的是字串，**驗不出 enum 的列舉序**（真 DB 是 P1…S3，字串序是 J… < P… < S…）。
 * 這支只驗鍵的優先序；列舉序由契約測試對真 PostgREST 驗（`list-endpoints.contract.ts`）。
 */
describe('GET /students —— 先年級、再姓名', () => {
  it('混排的 fixture 依年級分組、組內依姓名', async () => {
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
    expect(body.data.map((s) => s.name)).toEqual(['Ann', 'Ben', 'Amy', 'Cat']);
  });
});
