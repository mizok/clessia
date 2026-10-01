import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import loginLinksRoute from '../login-links';
import { reachWithinScope, targetReach } from './scope';

/**
 * #966 A 批：**登入連結就是帳號**，所以鑄連結的人拿到的是對象看得到的全部。
 * 受限管理員替範圍外的人鑄連結 = 一步跳出自己的分校範圍（替不受限管理員鑄 = 全拿）。
 */
describe('targetReach —— 拿到這個人的帳號看得到哪些分校', () => {
  it('不受分校限制的管理員（all_campuses）→ null', () => {
    expect(
      targetReach({
        roles: ['admin'],
        permissions: ['all_campuses'],
        staffCampusIds: ['A'],
        taughtCampusIds: [],
        childCampusIds: [],
      }),
    ).toBeNull();
  });

  it('受限管理員 → 他被指派的分校（跟 authMiddleware 同一支 resolveCampusScope）', () => {
    expect(
      targetReach({
        roles: ['admin'],
        permissions: ['manage_students'],
        staffCampusIds: ['A'],
        taughtCampusIds: [],
        childCampusIds: [],
      }),
    ).toEqual(['A']);
  });

  it('老師 → 指派的分校 ∪ 任課班級的分校', () => {
    expect(
      targetReach({
        roles: ['teacher'],
        permissions: [],
        staffCampusIds: ['A'],
        taughtCampusIds: ['B'],
        childCampusIds: [],
      })?.slice().sort(),
    ).toEqual(['A', 'B']);
  });

  it('家長 → 孩子報名班級的分校；老師兼家長取聯集', () => {
    expect(
      targetReach({
        roles: ['teacher', 'parent'],
        permissions: [],
        staffCampusIds: ['A'],
        taughtCampusIds: [],
        childCampusIds: ['C'],
      })?.slice().sort(),
    ).toEqual(['A', 'C']);
  });
});

describe('reachWithinScope', () => {
  it('呼叫者不受限 → 誰都可以', () => {
    expect(reachWithinScope(null, null)).toBe(true);
    expect(reachWithinScope(null, ['B'])).toBe(true);
  });

  it('受限呼叫者不能替不受限的人鑄（那是全拿）', () => {
    expect(reachWithinScope(['A'], null)).toBe(false);
  });

  it('對象的每一個分校都要在呼叫者範圍內 —— 有一個在外面就不行', () => {
    expect(reachWithinScope(['A'], ['A'])).toBe(true);
    expect(reachWithinScope(['A'], ['A', 'B'])).toBe(false);
  });

  it('對象還沒有任何分校（剛註冊、孩子還沒報名）→ 可以；臨櫃 QR 就是這個時刻', () => {
    expect(reachWithinScope(['A'], [])).toBe(true);
  });
});

describe('POST /api/login-links —— 分校範圍（#966 A 批）', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';

  interface Target {
    roles: Array<{ role: string; permissions?: string[] }>;
    staffCampusIds?: string[];
    taughtClassCampusIds?: string[];
    childCampusIds?: string[];
  }

  /** 每張表回什麼由對象決定；`mint` 那一段打不到真的 auth，所以只斷言「是不是 403」 */
  function fakeDb(target: Target) {
    const rows: Record<string, unknown> = {
      ba_user: { email: 'x@example.test', orgId: ORG },
      user_roles: target.roles,
      staff: target.staffCampusIds
        ? [
            {
              id: 'staff-1',
              staff_campuses: target.staffCampusIds.map((campus_id) => ({ campus_id })),
            },
          ]
        : [],
      schedules: (target.taughtClassCampusIds ?? []).map((_, i) => ({ class_id: `class-${i}` })),
      classes: (target.taughtClassCampusIds ?? []).map((campus_id) => ({ campus_id })),
      parents: target.childCampusIds
        ? [{ id: 'parent-1', parent_student_relations: [{ student_id: 'stu-1' }] }]
        : [],
      enrollments: (target.childCampusIds ?? []).map((campus_id) => ({ classes: { campus_id } })),
    };
    const make = (table: string) => {
      const builder: Record<string, unknown> = {};
      const chain = () => builder as never;
      Object.assign(builder, {
        select: () => chain(),
        eq: () => chain(),
        in: () => chain(),
        maybeSingle: () => Promise.resolve({ data: rows[table] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: rows[table] ?? [], error: null }),
      });
      return builder;
    };
    return { from: (table: string) => make(table) };
  }

  async function post(callerScope: string[] | null, target: Target) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', fakeDb(target));
      set('orgId', ORG);
      set('userId', 'caller');
      set('roles', ['admin']);
      set('permissions', ['manage_students', 'manage_staff']);
      set('campusScope', callerScope);
      await next();
    });
    app.route('/', loginLinksRoute as unknown as Hono);

    return app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'target-user' }),
    });
  }

  it('只管 A 校的管理員不能替不受限管理員鑄連結（一步全拿）', async () => {
    const res = await post(['A'], {
      roles: [{ role: 'admin', permissions: ['all_campuses'] }],
      staffCampusIds: ['A'],
    });
    expect(res.status).toBe(403);
  });

  it('不能替 B 校的老師鑄連結', async () => {
    const res = await post(['A'], { roles: [{ role: 'teacher' }], staffCampusIds: ['B'] });
    expect(res.status).toBe(403);
  });

  it('老師只指派在 A、卻在 B 校任課 —— 也不行', async () => {
    const res = await post(['A'], {
      roles: [{ role: 'teacher' }],
      staffCampusIds: ['A'],
      taughtClassCampusIds: ['B'],
    });
    expect(res.status).toBe(403);
  });

  it('不能替孩子在 B 校報名的家長鑄連結', async () => {
    const res = await post(['A'], { roles: [{ role: 'parent' }], childCampusIds: ['B'] });
    expect(res.status).toBe(403);
  });

  // ── 反向對照：守衛不是無腦擋 ──
  it('A 校的家長、A 校的老師照樣可以', async () => {
    expect(
      (await post(['A'], { roles: [{ role: 'parent' }], childCampusIds: ['A'] })).status,
    ).not.toBe(403);
    expect(
      (await post(['A'], { roles: [{ role: 'teacher' }], staffCampusIds: ['A'] })).status,
    ).not.toBe(403);
  });

  it('剛註冊、孩子還沒報名的家長可以（臨櫃註冊完當場給 QR）', async () => {
    const res = await post(['A'], { roles: [{ role: 'parent' }], childCampusIds: [] });
    expect(res.status).not.toBe(403);
  });

  it('不受分校限制的呼叫者不受影響', async () => {
    const res = await post(null, {
      roles: [{ role: 'admin', permissions: ['all_campuses'] }],
      staffCampusIds: ['B'],
    });
    expect(res.status).not.toBe(403);
  });
});
