import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import leavesApp from './leaves';

/**
 * #1100 #31：請假列表的課程／開課班篩選。判準同分校篩選 —— 走報名找學生。
 * 替身不照條件過濾，所以斷言**送出去的條件**。
 */
const CLASS = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';

function setup(opts: { campusScope?: readonly string[] | null } = {}) {
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
        resolve({ data: [], count: 0, error: null });
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

const SCOPED_EMBED =
  'students!inner(name, enrollments!inner(class_id, classes!inner(campus_id, course_id)))';
const selectOf = (calls: Array<{ table: string; op: string; args: unknown[] }>) =>
  String(of(calls, 'leave_requests').find((c) => c[0] === 'select')?.[1] ?? '');

/**
 * #1928 起範圍在請假單那支查詢的 join 裡套（不再先撈報名的學生 id 再塞回 `.in`：大分校 414、
 * 報名列被 max_rows 截斷）。三層 `!inner` 寫死 —— 少任何一層，條件只濾掉嵌入那層、不濾請假單 →
 * 靜默變成全部。真 PostgREST 的行為由 `contract/leaves-scope.contract.ts` 守。
 */
describe('GET /api/leaves —— 課程／開課班／分校篩選（#1100 #31、#1928）', () => {
  it('開課班：請假單查詢帶報名的巢狀 inner join，條件下在 students.enrollments.class_id', async () => {
    const { app, calls } = setup();
    const res = await app.request(`/?classId=${CLASS}`);
    expect(res.status).toBe(200);
    expect(selectOf(calls)).toContain(SCOPED_EMBED);
    expect(of(calls, 'leave_requests')).toContainEqual([
      'eq',
      'students.enrollments.class_id',
      CLASS,
    ]);
  });

  it('課程：條件下在 students.enrollments.classes.course_id', async () => {
    const { app, calls } = setup();
    await app.request(`/?courseId=${COURSE}`);
    expect(of(calls, 'leave_requests')).toContainEqual([
      'eq',
      'students.enrollments.classes.course_id',
      COURSE,
    ]);
  });

  it('受限管理員＋開課班：分校與班兩個條件都下在同一支查詢', async () => {
    const { app, calls } = setup({ campusScope: ['campus-1'] });
    await app.request(`/?classId=${CLASS}`);
    const q = of(calls, 'leave_requests');
    expect(q).toContainEqual(['in', 'students.enrollments.classes.campus_id', ['campus-1']]);
    expect(q).toContainEqual(['eq', 'students.enrollments.class_id', CLASS]);
  });

  it('不再先撈報名的學生 id（那份清單塞回 .in 會 414）', async () => {
    const { app, calls } = setup({ campusScope: ['campus-1'] });
    await app.request(`/?classId=${CLASS}`);
    expect(of(calls, 'enrollments')).toEqual([]);
    expect(of(calls, 'leave_requests').some((c) => c[0] === 'in' && c[1] === 'student_id')).toBe(
      false,
    );
  });

  it('沒有分校範圍、沒篩班與課 → 不加報名的 join', async () => {
    const { app, calls } = setup();
    await app.request('/');
    expect(selectOf(calls)).not.toContain('enrollments');
    expect(selectOf(calls)).toContain('students!inner(name)');
  });
});
