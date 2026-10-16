import { describe, expect, it } from 'vitest';

import {
  overdueDigests,
  unbilledDigests,
  type OverdueCandidate,
  type UpcomingPeriod,
} from './staff-digests';

/**
 * #1693 管理員每日摘要的計數。SQL 的形狀與跟儀表板兩支路由的一致性由
 * `contract/staff-digests.contract.ts` 對真 DB 驗；這裡守 JS 端的判準與文案。
 */

const TODAY = '2026-10-16';
const A = 'org-a';
const B = 'org-b';

/** 一張帳單：學生在 `studentCampus`、明細的班在 `itemCampuses`（null＝餐費，沒有班） */
const inv = (
  over: Partial<OverdueCandidate> & {
    studentCampus?: string;
    itemCampuses?: Array<string | null>;
  } = {},
): OverdueCandidate => {
  const { studentCampus = 'c1', itemCampuses = ['c1'], ...rest } = over;
  return {
    org_id: A,
    due_date: '2026-10-10',
    items: [{ amount: 1000 }],
    payments: [],
    scope_student: { enrollments: [{ classes: { campus_id: studentCampus } }] },
    scope_items: itemCampuses.map((c) => ({
      enrollments: c === null ? null : { classes: { campus_id: c } },
    })),
    ...rest,
  };
};

const count = (digests: ReturnType<typeof overdueDigests>, userId: string) => {
  const d = digests.find((x) => x.user_id === userId);
  return d ? Number(/今天有 (\d+) 張/.exec(d.payload.body)![1]) : 0;
};

describe('overdueDigests（逾期張數，照各人的範圍）', () => {
  const candidates = [
    inv(), // c1 未繳
    inv({ payments: [{ kind: 'payment', amount: 500 }] }), // c1 部分繳
    inv({ payments: [{ kind: 'payment', amount: 1000 }] }), // 繳清：不算
    inv({ due_date: TODAY }), // 今天到期：還沒逾期
    inv({ studentCampus: 'c2', itemCampuses: ['c2', null] }), // c2（含餐費）
    inv({ studentCampus: 'c1', itemCampuses: ['c1', 'c2'] }), // 跨校：只有兩校都管的人看得到
    inv({ org_id: B }), // 別的 org
  ];

  it('全分校的人：本 org 所有逾期未繳清的；受限的人只算範圍內的', () => {
    const digests = overdueDigests(
      candidates,
      [
        { org_id: A, user_id: 'all', scope: null },
        { org_id: A, user_id: 'c1', scope: ['c1'] },
        { org_id: A, user_id: 'c2', scope: ['c2'] },
        { org_id: A, user_id: 'both', scope: ['c2', 'c1'] },
      ],
      TODAY,
    );
    expect([count(digests, 'all'), count(digests, 'c1'), count(digests, 'c2')]).toEqual([4, 2, 1]);
    expect(count(digests, 'both')).toBe(4);
  });

  it('文案與連結；0 張不發', () => {
    const digests = overdueDigests(
      candidates,
      [
        { org_id: A, user_id: 'c1', scope: ['c1'] },
        { org_id: A, user_id: 'none', scope: ['c9'] },
      ],
      TODAY,
    );
    expect(digests).toEqual([
      {
        org_id: A,
        user_id: 'c1',
        kind: 'overdue_digest',
        payload: {
          title: '逾期帳單',
          body: '今天有 2 張帳單逾期未繳清',
          url: '/admin/payments?due=overdue',
        },
      },
    ]);
  });

  it('同一個範圍只算一次，但不同 org 的同範圍不能共用答案', () => {
    const digests = overdueDigests(
      candidates,
      [
        { org_id: A, user_id: 'a', scope: null },
        { org_id: B, user_id: 'b', scope: null },
      ],
      TODAY,
    );
    expect([count(digests, 'a'), count(digests, 'b')]).toEqual([4, 1]);
  });
});

describe('unbilledDigests（待開單，同 upcoming-unbilled）', () => {
  const period = (over: Partial<UpcomingPeriod>): UpcomingPeriod => ({
    org_id: A,
    name: '十一月',
    start_date: '2026-10-19',
    pending_all: 3,
    pending_campus_ids: ['c1', 'c1', 'c2'],
    billed_all: 0,
    billed_campus_ids: [],
    ...over,
  });

  it('有該開的、還沒開才算；受限的人只看自己分校的報名與明細', () => {
    const periods = [
      period({}),
      // c1 開過了、c2 還沒
      period({
        name: '十二月',
        start_date: '2026-10-25',
        billed_all: 1,
        billed_campus_ids: ['c1'],
      }),
    ];
    const recipients = [
      { org_id: A, user_id: 'all', scope: null },
      { org_id: A, user_id: 'c1', scope: ['c1'] },
      { org_id: A, user_id: 'c2', scope: ['c2'] },
      { org_id: A, user_id: 'c9', scope: ['c9'] }, // 範圍內沒有該開的
      { org_id: B, user_id: 'b', scope: null }, // 別的 org
    ];
    const bodies = Object.fromEntries(
      unbilledDigests(periods, recipients, '2026-10-16').map((d) => [d.user_id, d.payload.body]),
    );
    expect(bodies).toEqual({
      all: '「十一月」3 天後開始，還沒開單',
      c1: '「十一月」3 天後開始，還沒開單',
      c2: '「十一月」3 天後開始，還沒開單（另有 1 期）',
    });
  });

  it('標題、連結到儀表板（待開單沒有獨立頁面）', () => {
    expect(
      unbilledDigests([period({})], [{ org_id: A, user_id: 'u', scope: null }], '2026-10-16')[0],
    ).toMatchObject({
      kind: 'unbilled_reminder',
      payload: { title: '待開單', url: '/admin/dashboard' },
    });
  });
});
