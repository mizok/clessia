import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import classesRoute from './classes';

/**
 * #1100 #22：同一個班可以有前後接續的時段（舊段止於 X−1、新段起於 X）。
 * 班級列表的時段（摘要、時段數）看「那天」有效的 —— 今天，還沒開課的班看開課日；
 * 老師篩選（`scheduleTeacherIds`）沒有日期脈絡，看今天有效或未來有效（Q3）。
 * 日期一律用遠古／遠未來，不靠今天（`npm run test:timetravel`）。
 */

const ORG = 'org-a';
const slot = (
  id: string,
  teacher: string,
  effective_from: string,
  effective_to: string | null,
) => ({
  id,
  weekday: 1,
  start_time: '18:00:00',
  end_time: '20:00:00',
  teacher_id: teacher,
  effective_from,
  effective_to,
  staff: { display_name: teacher },
  classrooms: null,
});
// 替身不做 join：把 embed 的結果直接放在列上（同 PostgREST 回的形狀）
const klass = (id: string, schedules: unknown[], start_date: string | null = null) => ({
  id,
  org_id: ORG,
  course_id: 'k1',
  campus_id: 'campus-1',
  name: id,
  is_active: true,
  max_students: 24,
  start_date,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  schedules,
});

async function list(classes: unknown[]) {
  const db = createMultiOrgDb({ classes: classes as Record<string, unknown>[] });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', null);
    await next();
  });
  app.route('/', classesRoute as unknown as Hono);
  const res = await app.request('/');
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: Array<{
      id: string;
      scheduleCount: number;
      scheduleTeacherIds: string[];
      schedules: Array<{ id: string }>;
    }>;
  };
  return Object.fromEntries(body.data.map((row) => [row.id, row]));
}

describe('GET /classes —— 時段生效期間（#1100 #22）', () => {
  it('換過時段的班：只列今天有效的那段；老師篩選含下一段的老師、不含已結束的', async () => {
    const rows = await list([
      klass('c1', [
        slot('ended', '舊老師', '2000-01-01', '2000-12-31'),
        slot('now', '王老師', '2001-01-01', '2998-12-31'),
        slot('next', '新老師', '2999-01-01', null),
      ]),
    ]);
    expect(rows['c1'].schedules.map((s) => s.id)).toEqual(['now']);
    expect(rows['c1'].scheduleCount).toBe(1);
    expect(rows['c1'].scheduleTeacherIds.sort()).toEqual(['新老師', '王老師']);
  });

  it('還沒開課的班（開課日 2999-01-01）看開課日那天有效的時段，不會變成「沒有時段」', async () => {
    const rows = await list([
      klass('c2', [slot('first', '王老師', '2999-01-01', null)], '2999-01-01'),
    ]);
    expect(rows['c2'].scheduleCount).toBe(1);
    expect(rows['c2'].schedules.map((s) => s.id)).toEqual(['first']);
  });
});
