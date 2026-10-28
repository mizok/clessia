import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/taipei-date', () => ({ getCurrentTaipeiDateString: () => '2026-10-04' }));

import renewalRoute, { CLASS_SELECT } from './renewal';

const CHILD = '00000000-0000-0000-0000-000000000001';
const SIBLING = '00000000-0000-0000-0000-000000000002';
const STRANGER = '00000000-0000-0000-0000-000000000009';

type Row = Record<string, unknown>;

/**
 * 替身**真的實作 `eq`**（孩子、狀態、計費模式）—— 守的是「兄弟姊妹不混進來」與「只列期繳」，
 * 替身不篩的話拿掉那幾個 eq 照樣綠（charter 1307 §一）。`gt`／`order`／`limit`／`in` 記下來不執行，
 * 期與班由 fixture 直接給。
 */
function fakeChildDb(fixture: { periods: Row[]; enrollments: Row[]; classes: Row[] }) {
  const chain = (rows: Row[]) => {
    const filters: Array<[string, unknown]> = [];
    const q: any = {
      eq: (column: string, value: unknown) => (filters.push([column, value]), q),
      gt: () => q,
      order: () => q,
      limit: () => q,
      in: () => q,
      then: (onfulfilled: (value: unknown) => unknown) =>
        Promise.resolve({
          data: rows.filter((row) => filters.every(([col, val]) => row[col] === val)),
          error: null,
        }).then(onfulfilled),
    };
    return q;
  };
  return {
    from: (table: string) => ({
      select: () => chain(table === 'enrollments' ? fixture.enrollments : []),
    }),
    orgRef: (table: string) => ({
      select: () =>
        chain(
          table === 'billing_periods'
            ? fixture.periods
            : table === 'classes'
              ? fixture.classes
              : [],
        ),
    }),
  };
}

function appWith(roles: string[], scope: string[], db: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('studentScope', scope);
    set('childDb', db);
    set('orgId', 'org-1');
    await next();
  });
  app.route('/', renewalRoute as unknown as Hono);
  return app;
}

const PERIOD = { name: '2027 上學期', start_date: '2027-02-01', end_date: '2027-07-31' };

const enrollment = (id: string, classId: string, over: Row = {}) => ({
  id,
  student_id: CHILD,
  status: 'active',
  billing_mode: 'period',
  class_id: classId,
  effective_from: '2026-09-01',
  effective_to: null,
  agreed_amount: null,
  fee_templates: { amount: 18100 },
  ...over,
});

const slot = (
  weekday: number,
  effectiveTo: string | null = null,
  effectiveFrom = '2026-09-01',
) => ({
  weekday,
  start_time: '19:00:00',
  end_time: '21:00:00',
  effective_from: effectiveFrom,
  effective_to: effectiveTo,
});

const CLASSES = [
  {
    id: 'stay',
    name: '國二數學 A',
    end_date: null,
    courses: { name: '國二數學' },
    schedules: [slot(3), slot(1, '2026-12-31')],
    next_class: null,
  },
  {
    id: 'up',
    name: '國二英文',
    end_date: '2027-01-20',
    courses: { name: '英文' },
    schedules: [slot(2)],
    next_class: {
      id: 'up-next',
      org_id: 'org-1',
      name: '國三英文',
      schedules: [slot(5)],
      fee_template: { amount: 24000, is_active: true },
    },
  },
  {
    id: 'up-no-fee',
    name: '國二理化',
    end_date: '2027-01-20',
    courses: { name: '理化' },
    schedules: [],
    next_class: { id: 'n2', org_id: 'org-1', name: '國三理化', schedules: [], fee_template: null },
  },
];

const request = (db: unknown, childId = CHILD, roles = ['parent'], scope = [CHILD, SIBLING]) =>
  appWith(roles, scope, db).request(`/?childId=${childId}`);

describe('GET /api/me/renewal-preview（#1121）', () => {
  it('不是家長 → 403 NOT_PARENT；別人的孩子 → 403 CHILD_OUT_OF_SCOPE', async () => {
    const db = fakeChildDb({ periods: [], enrollments: [], classes: [] });
    const notParent = await request(db, CHILD, ['admin']);
    expect(notParent.status).toBe(403);
    expect(((await notParent.json()) as { code: string }).code).toBe('NOT_PARENT');
    const stranger = await request(db, STRANGER);
    expect(stranger.status).toBe(403);
    expect(((await stranger.json()) as { code: string }).code).toBe('CHILD_OUT_OF_SCOPE');
  });

  it('沒有下一期 → nextPeriod null、items 空', async () => {
    const res = await request(fakeChildDb({ periods: [], enrollments: [], classes: [] }));
    expect(await res.json()).toEqual({
      data: { nextPeriod: null, items: [], hasMonthlyEnrollments: false },
    });
  });

  it('沿用原班：跟期 run 同一條 —— 議定價優先、整期在讀就是全額；只列下期仍在讀的', async () => {
    const res = await request(
      fakeChildDb({
        periods: [PERIOD],
        enrollments: [
          enrollment('e-agreed', 'stay', { agreed_amount: 15000 }),
          // 下期開始前就結束的報名不列
          enrollment('e-ended', 'stay', { effective_to: '2027-01-31' }),
        ],
        classes: CLASSES,
      }),
    );
    const body = (await res.json()) as { data: { nextPeriod: unknown; items: Row[] } };
    expect(body.data.nextPeriod).toEqual({
      name: '2027 上學期',
      startDate: '2027-02-01',
      endDate: '2027-07-31',
    });
    expect(body.data.items).toEqual([
      {
        enrollmentId: 'e-agreed',
        courseName: '國二數學',
        currentClassName: '國二數學 A',
        nextClassName: '國二數學 A',
        upgraded: false,
        // 12/31 就失效的時段不列
        schedules: [{ weekday: 3, startTime: '19:00', endTime: '21:00' }],
        teacherNames: [],
        estimatedAmount: 15000,
        estimateSource: 'enrollment',
      },
    ]);
  });

  it('時段要跟下期有交集（#1100 #22）：下期中途才生效的新段要列、下期結束後才生效的不列', async () => {
    const res = await request(
      fakeChildDb({
        periods: [PERIOD],
        enrollments: [enrollment('e-agreed', 'stay', { agreed_amount: 15000 })],
        classes: [
          {
            ...CLASSES[0],
            // 週二 3/1 起（下期中）、週四 8/1 起（下期 7/31 結束後）
            schedules: [slot(2, null, '2027-03-01'), slot(4, null, '2027-08-01')],
          },
        ],
      }),
    );
    const body = (await res.json()) as { data: { items: Row[] } };
    expect(body.data.items[0]['schedules']).toEqual([
      { weekday: 2, startTime: '19:00', endTime: '21:00' },
    ]);
  });

  it('期中才結束的報名照天數比例（同 prorateByDays）', async () => {
    const res = await request(
      fakeChildDb({
        periods: [PERIOD],
        enrollments: [enrollment('e-half', 'stay', { effective_to: '2027-04-30' })],
        classes: CLASSES,
      }),
    );
    const item = ((await res.json()) as { data: { items: Row[] } }).data.items[0];
    expect(item['estimateSource']).toBe('enrollment');
    expect(item['estimatedAmount']).toBeGreaterThan(0);
    expect(item['estimatedAmount']).toBeLessThan(18100);
  });

  it('有設下一班、但原班下期還在上 → 不升班，照原班與這筆報名的價格', async () => {
    const res = await request(
      fakeChildDb({
        periods: [PERIOD],
        enrollments: [enrollment('e-cont', 'continuing')],
        classes: [
          {
            id: 'continuing',
            name: '國二國文',
            end_date: '2027-12-31',
            courses: { name: '國文' },
            schedules: [slot(4)],
            next_class: {
              id: 'x',
              org_id: 'org-1',
              name: '國三國文',
              schedules: [],
              fee_template: { amount: 30000, is_active: true },
            },
          },
        ],
      }),
    );
    const item = ((await res.json()) as { data: { items: Row[] } }).data.items[0];
    expect(item).toMatchObject({
      nextClassName: '國二國文',
      upgraded: false,
      estimatedAmount: 18100,
      estimateSource: 'enrollment',
    });
  });

  it('原班在下期前結束、有下一班 → 升班，用新班的預設參考價；新班沒設參考價 → null', async () => {
    const res = await request(
      fakeChildDb({
        periods: [PERIOD],
        enrollments: [enrollment('e-up', 'up'), enrollment('e-nofee', 'up-no-fee')],
        classes: CLASSES,
      }),
    );
    const items = ((await res.json()) as { data: { items: Row[] } }).data.items;
    expect(items[0]).toMatchObject({
      nextClassName: '國三英文',
      upgraded: true,
      schedules: [{ weekday: 5, startTime: '19:00', endTime: '21:00' }],
      estimatedAmount: 24000,
      estimateSource: 'next_class_default',
    });
    expect(items[1]).toMatchObject({
      nextClassName: '國三理化',
      upgraded: true,
      estimatedAmount: null,
      estimateSource: null,
    });
  });

  it('下一班是別的機構的班 → 當作沒有下一班（不把別機構的班名、時段、參考價給家長）', async () => {
    const res = await request(
      fakeChildDb({
        periods: [PERIOD],
        enrollments: [enrollment('e-x', 'cross')],
        classes: [
          {
            id: 'cross',
            name: '國二數學 B',
            end_date: '2027-01-20',
            courses: { name: '數學' },
            schedules: [slot(3)],
            next_class: {
              id: 'other-org-class',
              org_id: 'org-2',
              name: '別家的國三數學',
              schedules: [slot(6)],
              fee_template: { amount: 99999, is_active: true },
            },
          },
        ],
      }),
    );
    const item = ((await res.json()) as { data: { items: Row[] } }).data.items[0];
    expect(item).toMatchObject({ nextClassName: '國二數學 B', upgraded: false });
    expect(JSON.stringify(item)).not.toContain('別家');
  });

  it('只列這個孩子、在讀、期繳的報名（兄弟姊妹、月繳、已結束的報名都不出現）', async () => {
    const res = await request(
      fakeChildDb({
        periods: [PERIOD],
        enrollments: [
          enrollment('mine', 'stay'),
          enrollment('sibling', 'stay', { student_id: SIBLING }),
          enrollment('monthly', 'stay', { billing_mode: 'monthly' }),
          enrollment('withdrawn', 'stay', { status: 'withdrawn' }),
        ],
        classes: CLASSES,
      }),
    );
    const items = ((await res.json()) as { data: { items: Row[] } }).data.items;
    expect(items.map((i) => i['enrollmentId'])).toEqual(['mine']);
    // allowlist：沒有議定價、範本、備註這些內部欄位
    expect(Object.keys(items[0]).sort()).toEqual([
      'courseName',
      'currentClassName',
      'enrollmentId',
      'estimateSource',
      'estimatedAmount',
      'nextClassName',
      'schedules',
      'teacherNames',
      'upgraded',
    ]);
  });

  // ── 計畫席 10-22：家長端續課頁要的兩欄 ─────────────────────────────────────
  const teacher = (name: string, orgId = 'org-1') => ({ display_name: name, org_id: orgId });

  // 替身不解析 select 字串：拿掉老師嵌入替身照樣回 fixture 的 teacher，要直接攔字串（第二審核席 #1838）
  it('select 在本班與下一班的時段都嵌了老師（display_name、org_id）', () => {
    const embed = /schedules\([^)]*teacher:staff!teacher_id\(display_name, org_id\)\)/g;
    expect(CLASS_SELECT.match(embed)).toHaveLength(2);
    const next = CLASS_SELECT.slice(CLASS_SELECT.indexOf('next_class:'));
    expect(next).toMatch(embed);
  });

  it('teacherNames：下期仍有效時段的老師，去重；別機構的 staff、已失效時段的老師不回', async () => {
    const res = await request(
      fakeChildDb({
        periods: [PERIOD],
        enrollments: [enrollment('e1', 't')],
        classes: [
          {
            id: 't',
            name: '國二數學 A',
            end_date: null,
            courses: { name: '數學' },
            schedules: [
              { ...slot(1), teacher: teacher('游佩珊') },
              { ...slot(3), teacher: [teacher('游佩珊')] },
              { ...slot(4), teacher: teacher('別家老師', 'org-2') },
              { ...slot(5, '2026-12-31'), teacher: teacher('已離開的老師') },
              { ...slot(6), teacher: null },
            ],
            next_class: null,
          },
        ],
      }),
    );
    const item = ((await res.json()) as { data: { items: Row[] } }).data.items[0]!;
    expect(item['teacherNames']).toEqual(['游佩珊']);
    expect(JSON.stringify(item)).not.toContain('org-');
  });

  it('teacherNames：升班時是新班的老師', async () => {
    const res = await request(
      fakeChildDb({
        periods: [PERIOD],
        enrollments: [enrollment('e-up', 'up2')],
        classes: [
          {
            id: 'up2',
            name: '國二英文',
            end_date: '2027-01-20',
            courses: { name: '英文' },
            schedules: [{ ...slot(2), teacher: teacher('舊班老師') }],
            next_class: {
              id: 'n',
              org_id: 'org-1',
              name: '國三英文',
              schedules: [{ ...slot(5), teacher: teacher('江承睿') }],
              fee_template: null,
            },
          },
        ],
      }),
    );
    const item = ((await res.json()) as { data: { items: Row[] } }).data.items[0]!;
    expect(item['teacherNames']).toEqual(['江承睿']);
  });

  it('hasMonthlyEnrollments：這個孩子有在讀的月繳才 true（兄弟姊妹、已退的不算）；沒有下一期也回', async () => {
    const run = async (enrollments: Row[], periods: Row[] = [PERIOD]) =>
      (
        (await (await request(fakeChildDb({ periods, enrollments, classes: CLASSES }))).json()) as {
          data: { hasMonthlyEnrollments: boolean };
        }
      ).data.hasMonthlyEnrollments;

    expect(await run([enrollment('m', 'stay', { billing_mode: 'monthly' })])).toBe(true);
    expect(await run([enrollment('m', 'stay', { billing_mode: 'monthly' })], [])).toBe(true);
    expect(
      await run([enrollment('m', 'stay', { billing_mode: 'monthly', student_id: SIBLING })]),
    ).toBe(false);
    expect(
      await run([enrollment('m', 'stay', { billing_mode: 'monthly', status: 'withdrawn' })]),
    ).toBe(false);
    expect(await run([enrollment('p', 'stay')])).toBe(false);
  });

  it('月繳那支讀失敗 → 500（不當成沒有月繳）', async () => {
    const db = fakeChildDb({ periods: [PERIOD], enrollments: [], classes: CLASSES });
    const from = db.from;
    db.from = (table: string) => ({
      select: (cols?: string) =>
        cols === 'id'
          ? {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: () => Promise.resolve({ data: null, error: { message: 'x' } }),
                  }),
                }),
              }),
            }
          : from(table).select(),
    });
    const res = await request(db);
    expect(res.status).toBe(500);
  });
});
