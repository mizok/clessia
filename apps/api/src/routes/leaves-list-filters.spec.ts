import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import leavesApp from './leaves';

/**
 * #1100 #31：請假列表的課程／開課班篩選。判準同分校篩選 —— 走報名找學生，
 * 再用 `student_id in (...)` 縮請假單。替身不照條件過濾，所以斷言**送出去的條件**。
 */
const CLASS = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';

function setup(
  opts: { enrolled?: string[]; campusScope?: readonly string[] | null; enrollError?: boolean } = {},
) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const supabase = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain =
        (op: string) =>
        (...args: unknown[]) => (calls.push({ table, op, args }), builder as never);
      for (const op of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range'])
        builder[op] = chain(op);
      builder['then'] = (resolve: (v: unknown) => unknown) =>
        resolve(
          table === 'enrollments' && opts.enrollError
            ? { data: null, error: { message: 'boom' } }
            : {
                data:
                  table === 'enrollments'
                    ? (opts.enrolled ?? ['stu-1']).map((student_id) => ({ student_id }))
                    : [],
                count: 0,
                error: null,
              },
        );
      return builder;
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', supabase);
    set('orgId', 'org-1');
    set('userId', 'user-1');
    set('roles', ['admin']);
    set('campusScope', opts.campusScope ?? null);
    await next();
  });
  app.route('/', leavesApp);
  return { app, calls };
}

const of = (calls: Array<{ table: string; op: string; args: unknown[] }>, table: string) =>
  calls.filter((c) => c.table === table).map((c) => [c.op, ...c.args]);

describe('GET /api/leaves —— 課程／開課班篩選（#1100 #31）', () => {
  it('開課班：報名查詢帶 class_id，請假單縮到那些學生', async () => {
    const { app, calls } = setup({ enrolled: ['stu-1', 'stu-2', 'stu-1'] });
    const res = await app.request(`/?classId=${CLASS}`);
    expect(res.status).toBe(200);
    expect(of(calls, 'enrollments')).toEqual(
      expect.arrayContaining([
        ['eq', 'org_id', 'org-1'],
        ['eq', 'class_id', CLASS],
      ]),
    );
    expect(of(calls, 'leave_requests')).toContainEqual(['in', 'student_id', ['stu-1', 'stu-2']]);
    // !inner 寫死：沒有它，classes.* 的條件只濾掉嵌入那層、不濾報名列 → 靜默變成全部學生
    expect(of(calls, 'enrollments')).toContainEqual([
      'select',
      'student_id, classes!inner(campus_id, course_id)',
    ]);
  });

  it('課程：報名查詢帶 classes.course_id', async () => {
    const { app, calls } = setup();
    await app.request(`/?courseId=${COURSE}`);
    expect(of(calls, 'enrollments')).toContainEqual(['eq', 'classes.course_id', COURSE]);
  });

  it('受限管理員＋開課班：分校與班兩個條件都下在同一支報名查詢', async () => {
    const { app, calls } = setup({ campusScope: ['campus-1'] });
    await app.request(`/?classId=${CLASS}`);
    const enr = of(calls, 'enrollments');
    expect(enr).toContainEqual(['in', 'classes.campus_id', ['campus-1']]);
    expect(enr).toContainEqual(['eq', 'class_id', CLASS]);
  });

  it('這個班一個學生都沒有 → 回空，不是不加條件', async () => {
    const { app, calls } = setup({ enrolled: [] });
    const res = await app.request(`/?classId=${CLASS}`);
    expect(((await res.json()) as { meta: { total: number } }).meta.total).toBe(0);
    expect(calls.some((c) => c.table === 'leave_requests' && c.op === 'range')).toBe(false);
  });

  it('沒有分校範圍、沒篩班與課 → 不查報名', async () => {
    const { app, calls } = setup();
    await app.request('/');
    expect(of(calls, 'enrollments')).toEqual([]);
  });

  // #1928：讀失敗原本被當成「這個班一個學生都沒有」→ 回空列表 200
  it('報名讀取失敗 → 500，不是空列表', async () => {
    const { app, calls } = setup({ enrollError: true });
    const res = await app.request(`/?classId=${CLASS}`);
    expect(res.status).toBe(500);
    expect(calls.some((c) => c.table === 'leave_requests' && c.op === 'range')).toBe(false);
  });
});
