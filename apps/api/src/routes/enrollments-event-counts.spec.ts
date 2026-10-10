import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/taipei-date', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/taipei-date')>()),
  getCurrentTaipeiDateString: () => '2026-10-10',
}));

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import enrollmentsRoute from './enrollments';

/**
 * #1507：報名進出的事件計數與 `event` 篩選。數的是**期間內發生過的事**，不是列
 * （計畫席 10-10 裁 A）：報了又退的人，新報名與退班各算一次。
 *
 * 替身的 `or()` 照 `and(…)` 真的過濾，但字串比較、不懂 enum —— PostgREST 對這些條件字串的
 * 真語意由契約測試（`contract/list-endpoints.contract.ts` 的 BRANCHES）驗。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';

const embeds = {
  classes: { name: '班', campus_id: null, campuses: null, courses: { id: 'c', name: '課' } },
  students: { name: '生', grade: 'J1', schools: null },
};

function enrollment(id: string, over: Record<string, unknown>) {
  return {
    id,
    org_id: ORG,
    class_id: 'cls-1',
    student_id: 'stu-1',
    status: 'active',
    effective_from: '2026-09-01',
    effective_to: null,
    status_changed_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...embeds,
    ...over,
  };
}

const SEED = [
  enrollment('joined', { effective_from: '2026-10-02' }),
  enrollment('withdrew', { status: 'withdrawal', effective_to: '2026-10-05' }),
  // 到期結束：active 但 effective_to 已過 —— 離開名冊了，算退班
  enrollment('expired', { effective_to: '2026-10-03' }),
  // 排定 10-20 結束，今天 10-10 還在班上 —— 不是退班，也不在這段期間的進出裡
  enrollment('scheduled', { effective_to: '2026-10-20' }),
  // 報了又作廢：新報名＋作廢各一（作廢不算退班）
  enrollment('voided', {
    status: 'void',
    effective_from: '2026-10-01',
    effective_to: '2026-10-04',
  }),
  enrollment('paused', { status: 'suspended', status_changed_at: '2026-10-06' }),
  // 報了又退：新報名＋退班各一
  enrollment('churned', {
    status: 'withdrawal',
    effective_from: '2026-10-02',
    effective_to: '2026-10-08',
  }),
  enrollment('other-org', { org_id: OTHER, effective_from: '2026-10-02' }),
];

async function get(path: string) {
  const db = createMultiOrgDb({ enrollments: SEED });
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', null);
    await next();
  });
  app.route('/', enrollmentsRoute as unknown as Hono);
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const PERIOD = 'from=2026-10-01&to=2026-10-31';

describe('GET /api/enrollments/event-counts（#1507）', () => {
  it('期間內發生過的事各數一次，只數自己 org 的', async () => {
    const res = await get(`/event-counts?${PERIOD}`);

    expect(res.status).toBe(200);
    expect(res.body['data']).toEqual({ joined: 3, left: 3, paused: 1, voided: 1 });
  });
});

describe('GET /api/enrollments 的事件篩選與期間（#1507）', () => {
  const ids = (body: Record<string, unknown>) =>
    (body['data'] as { id: string }[]).map((row) => row.id).sort();

  it('event=left：辦理退班與到期結束都在，排定日未到與作廢的不在', async () => {
    const res = await get(`/?${PERIOD}&event=left`);

    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(['churned', 'expired', 'withdrew']);
  });

  it('不指定事件時＝四種事件的聯集；排定日未到的在籍生不列入', async () => {
    const res = await get(`/?${PERIOD}`);

    expect(ids(res.body)).toEqual(['churned', 'expired', 'joined', 'paused', 'voided', 'withdrew']);
  });
});
