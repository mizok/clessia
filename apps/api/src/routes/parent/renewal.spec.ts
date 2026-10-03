import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/taipei-date', () => ({ getCurrentTaipeiDateString: () => '2026-10-04' }));

import renewalRoute from './renewal';

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

const slot = (weekday: number, effectiveTo: string | null = null) => ({
  weekday,
  start_time: '19:00:00',
  end_time: '21:00:00',
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
    next_class: { id: 'n2', name: '國三理化', schedules: [], fee_template: null },
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
    expect(await res.json()).toEqual({ data: { nextPeriod: null, items: [] } });
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
        estimatedAmount: 15000,
        estimateSource: 'enrollment',
      },
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
      'upgraded',
    ]);
  });
});
