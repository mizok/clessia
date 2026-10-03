import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import attendanceApp from './attendance';
import studentsApp from './students';

const MINE = '00000000-0000-4000-8000-0000000000a1';
const OTHERS = '00000000-0000-4000-8000-0000000000b2';

/**
 * #1098：老師讀得到全機構任一學生（`GET /api/students/{id}` 只有 `.eq('org_id')`）、
 * 與全機構的出勤紀錄（`GET /api/attendance` 列表沒有老師範圍）。跟 #1081 同一個形狀。
 */
function fakeDb() {
  return {
    from(table: string) {
      const query: Record<string, unknown> = {
        select: () => query,
        eq: () => query,
        in: () => query,
        gte: () => query,
        lte: () => query,
        order: () => query,
        range: () => query,
        maybeSingle: () => Promise.resolve({ data: { id: 'staff-me' }, error: null }),
        single: () =>
          Promise.resolve({
            data: { id: 'stu', name: '學生', parent_student_relations: [] },
            error: null,
          }),
        then: (onfulfilled?: ((value: unknown) => unknown) | null) =>
          Promise.resolve({
            data:
              table === 'schedules'
                ? [{ class_id: 'class-mine' }]
                : table === 'enrollments'
                  ? [{ student_id: MINE }]
                  : [],
            error: null,
            count: 0,
          }).then(onfulfilled ?? undefined),
      };
      return query;
    },
  };
}

function appFor(route: Hono, mountAt: string, roles: string[]) {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const context = c as unknown as { set: (key: string, value: unknown) => void };
    context.set('supabase', fakeDb());
    context.set('orgId', 'org-1');
    context.set('userId', 'user-1');
    context.set('roles', roles);
    context.set('campusScope', null);
    await next();
  });
  app.route(mountAt, route);
  return app;
}

describe('GET /api/students/{id} —— 老師只能讀自己任課班的學生', () => {
  const status = async (roles: string[], id: string) =>
    (await appFor(studentsApp as never, '/api/students', roles).request(`/api/students/${id}`))
      .status;

  it('不是自己任課班的學生 → 403', async () => {
    expect(await status(['teacher'], OTHERS)).toBe(403);
  });

  it('自己任課班的學生 → 200', async () => {
    expect(await status(['teacher'], MINE)).toBe(200);
  });

  it('管理員不受限', async () => {
    expect(await status(['admin'], OTHERS)).toBe(200);
  });
});

/**
 * 出勤列表只有管理端在用（儀表板的電話請假），老師端沒有任何呼叫 ——
 * 比照同檔 `/student-day` 只開給管理員，不另做一套老師範圍。
 */
describe('GET /api/attendance —— 只開給管理員', () => {
  const status = async (roles: string[]) =>
    (await appFor(attendanceApp as never, '/api/attendance', roles).request('/api/attendance'))
      .status;

  it('老師 → 403', async () => {
    expect(await status(['teacher'])).toBe(403);
  });

  it('管理員 → 200', async () => {
    expect(await status(['admin'])).toBe(200);
  });
});
