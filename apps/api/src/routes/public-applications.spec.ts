import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import publicApplicationsRoute from './public-applications';

/**
 * #1245：管理端看公開申請（#1123／#1124 寫進來的）。這張表是陌生人的個資 ——
 * 分校受限的管理員只看得到「任一目標班／課程在自己範圍內」的申請；目標全被刪的只有不受限的看得到。
 * 改狀態、寫備註都記稽核。替身不做 embed，所以 targets 直接放在申請列上（同正式回傳的形狀）。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const CAMPUS_A = 'campus-a';
const CAMPUS_B = 'campus-b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const classTarget = (campus: string, extra: Record<string, unknown> = {}) => ({
  class_id: 'c1',
  course_id: null,
  is_waitlist: false,
  classes: { name: '國二數學 A', campus_id: campus, campuses: { name: `分校 ${campus}` } },
  courses: null,
  ...extra,
});

const application = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  org_id: ORG,
  kind: 'enrollment',
  status: 'new',
  parent_name: '王媽媽',
  parent_email: null,
  parent_phone: '0912345678',
  parent_relation: 'mother',
  student_name: '王小明',
  student_grade: 'J2',
  student_school: '信義國中',
  preferred_start_date: null,
  preferred_times: null,
  note: null,
  staff_note: null,
  created_at: `2026-10-0${n % 9}T00:00:00Z`,
  public_application_targets: [classTarget(CAMPUS_A)],
  ...extra,
});

function seed() {
  return createMultiOrgDb({
    public_applications: [
      application(1),
      application(2, {
        kind: 'trial',
        public_application_targets: [
          {
            class_id: null,
            course_id: 'k1',
            is_waitlist: false,
            classes: null,
            courses: { name: '國小英文', campus_id: CAMPUS_B, campuses: { name: '分校 B' } },
          },
        ],
      }),
      // 目標班被刪了（SET NULL）
      application(3, {
        public_application_targets: [
          { class_id: null, course_id: null, is_waitlist: false, classes: null, courses: null },
        ],
      }),
      application(4, { status: 'spam' }),
      application(5, { org_id: ORG_B }),
    ],
    audit_logs: [],
    profiles: [],
  });
}

function call(
  db: ReturnType<typeof seed>,
  path: string,
  init: RequestInit = {},
  scope: readonly string[] | null = null,
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'admin-1');
    set('roles', ['admin']);
    set('permissions', ['manage_students']);
    set('campusScope', scope);
    await next();
  });
  app.route('/', publicApplicationsRoute as unknown as Hono);
  return app.request(path, init, {}, {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as never);
}

const ids = async (res: Response) =>
  ((await res.json()) as any).data.map((a: { id: string }) => a.id);

describe('GET /api/public-applications', () => {
  it('預設只列待處理（new＋contacted）、本 org、新的在前；目標展開成名稱＋分校', async () => {
    const res = await call(seed(), '/');
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.data.map((a: { id: string }) => a.id)).toEqual([id(3), id(2), id(1)]);
    expect(body.data.find((a: { id: string }) => a.id === id(1))).toMatchObject({
      kind: 'enrollment',
      parent: { name: '王媽媽', phone: '0912345678', email: null, relation: 'mother' },
      student: { name: '王小明', grade: 'J2', school: '信義國中' },
      targets: [
        {
          type: 'class',
          name: '國二數學 A',
          campusName: '分校 campus-a',
          isWaitlist: false,
          deleted: false,
        },
      ],
    });
    expect(body.data.find((a: { id: string }) => a.id === id(3)).targets).toEqual([
      { type: 'class', name: null, campusName: null, isWaitlist: false, deleted: true },
    ]);
  });

  it('?status=spam 看得到垃圾送件', async () => {
    expect(await ids(await call(seed(), '/?status=spam'))).toEqual([id(4)]);
  });

  it('分校受限：只看得到目標在範圍內的（試聽看課程的分校）；目標全刪的看不到', async () => {
    expect(await ids(await call(seed(), '/', {}, [CAMPUS_A]))).toEqual([id(1)]);
    expect(await ids(await call(seed(), '/', {}, [CAMPUS_B]))).toEqual([id(2)]);
  });
});

describe('PATCH /api/public-applications/:id', () => {
  const patch = (
    db: ReturnType<typeof seed>,
    target: string,
    body: unknown,
    scope: readonly string[] | null = null,
  ) =>
    call(
      db,
      `/${target}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      scope,
    );

  it('改狀態與備註，記稽核（前後值）', async () => {
    const db = seed();
    const res = await patch(db, id(1), { status: 'contacted', staffNote: '10/4 打過電話' });

    expect(res.status).toBe(200);
    expect(db.rows('public_applications').find((r) => r['id'] === id(1))).toMatchObject({
      status: 'contacted',
      staff_note: '10/4 打過電話',
    });
    const [audit] = db.rows('audit_logs');
    expect(audit).toMatchObject({
      resource_type: 'public_application',
      resource_id: id(1),
      action: 'update',
    });
    expect(JSON.stringify(audit!['details'])).toContain('new');
  });

  it('範圍外、別 org、不存在：404 NOT_FOUND，沒改', async () => {
    const db = seed();
    for (const [target, scope] of [
      [id(2), [CAMPUS_A]],
      [id(5), null],
      [id(99), null],
    ] as const) {
      const res = await patch(db, target, { status: 'spam' }, scope);
      expect(res.status).toBe(404);
      expect(((await res.json()) as any).code).toBe('NOT_FOUND');
    }
    expect(db.rows('public_applications').filter((r) => r['status'] === 'spam')).toHaveLength(1);
  });
});
