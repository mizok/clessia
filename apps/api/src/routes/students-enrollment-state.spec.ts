import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import studentsRoute, { deriveEnrollmentState } from './students';

/** #1314 SL2：名冊的報名狀態旗標，照 A6 `students.html` 的 `stateOf` */

describe('deriveEnrollmentState', () => {
  it.each([
    [['active', 'pending_payment'], 'pending_payment'],
    [['withdrawal', 'active'], 'active'],
    [['withdrawal', 'suspended'], 'suspended'],
    [['withdrawal'], 'withdrawal'],
    // 作廢的報名不算：只剩作廢 = 沒有報名
    [['void'], null],
    [['void', 'withdrawal'], 'withdrawal'],
    [[], null],
  ] as const)('%j → %s', (statuses, expected) => {
    expect(deriveEnrollmentState(statuses)).toBe(expected);
  });
});

describe('GET /students —— 每列帶 enrollmentState', () => {
  it('從列表已撈的 enrollments embed 推，沒報名的是 null', async () => {
    const db = createMultiOrgDb({
      students: [
        {
          id: 's1',
          org_id: 'org-a',
          name: 'A',
          enrollments: [{ status: 'active' }, { status: 'pending_payment' }],
        },
        { id: 's2', org_id: 'org-a', name: 'B', enrollments: [] },
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

    const body = (await (await app.request('/')).json()) as {
      data: Array<{ id: string; enrollmentState: string | null }>;
    };
    expect(Object.fromEntries(body.data.map((s) => [s.id, s.enrollmentState]))).toEqual({
      s1: 'pending_payment',
      s2: null,
    });
  });
});
