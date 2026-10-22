import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createChildDb } from '../../lib/child-db';
import { createMultiOrgDb } from '../../test-utils/multi-org-db';

import attendanceRoute from './attendance';

/**
 * #1075：`GET /api/me/attendance/checkins` —— 家長看孩子哪幾天幾點到班。
 * 用真的 `createChildDb` 包 `createMultiOrgDb`：scope、org、兄弟姊妹的過濾都是它的事，這裡驗有沒有接上。
 */

const ORG = 'org-1';
const MINE = '00000000-0000-0000-0000-000000000001';
const SIBLING = '00000000-0000-0000-0000-000000000002';

function seed() {
  return createMultiOrgDb({
    organizations: [{ id: ORG, attendance_mode: 'per_session' }],
    campuses: [
      { id: 'c-daily', org_id: ORG, attendance_mode: 'daily_checkin' },
      { id: 'c-session', org_id: ORG, attendance_mode: null },
    ],
    classes: [
      { id: 'cls-daily', org_id: ORG, campus_id: 'c-daily' },
      { id: 'cls-session', org_id: ORG, campus_id: 'c-session' },
      { id: 'cls-sibling', org_id: ORG, campus_id: 'c-sibling' },
    ],
    enrollments: [
      { id: 'e1', org_id: ORG, student_id: MINE, class_id: 'cls-daily', status: 'withdrawal' },
      { id: 'e2', org_id: ORG, student_id: MINE, class_id: 'cls-session', status: 'active' },
      { id: 'e3', org_id: ORG, student_id: SIBLING, class_id: 'cls-sibling', status: 'active' },
    ],
    daily_checkins: [
      {
        id: 'k1',
        org_id: ORG,
        campus_id: 'c-daily',
        student_id: MINE,
        checkin_date: '2026-10-21',
        checked_in_at: '2026-10-21T08:42:10+00:00',
        checked_in_by: 'kiosk-user',
        created_at: '2026-10-21T08:42:10+00:00',
      },
      {
        id: 'k0',
        org_id: ORG,
        campus_id: 'c-daily',
        student_id: MINE,
        checkin_date: '2026-10-01',
        checked_in_at: '2026-10-01T08:00:00+00:00',
      },
      {
        // dateTo（10-22）之後的卡：查詢區間外，不能回
        id: 'k4',
        org_id: ORG,
        campus_id: 'c-daily',
        student_id: MINE,
        checkin_date: '2026-10-25',
        checked_in_at: '2026-10-25T08:00:00+00:00',
      },
      {
        id: 'k2',
        org_id: ORG,
        campus_id: 'c-daily',
        student_id: SIBLING,
        checkin_date: '2026-10-21',
        checked_in_at: '2026-10-21T07:00:00+00:00',
      },
    ],
  });
}

/** 一條查詢鏈：每一步都回自己，`await`／`maybeSingle` 時回讀取失敗 */
function failing(): unknown {
  const result = { data: null, error: { message: 'boom' } };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order']) q[m] = () => q;
  q['maybeSingle'] = () => Promise.resolve(result);
  q['then'] = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return q;
}

async function get(
  query: string,
  roles = ['parent'],
  scope: readonly string[] = [MINE, SIBLING],
  failTable?: string,
) {
  const db = seed();
  if (failTable) {
    const client = db.client as unknown as { from: (t: string) => unknown };
    const from = client.from.bind(client);
    client.from = (t: string) => (t === failTable ? failing() : from(t));
  }
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('roles', roles);
    set('studentScope', scope);
    set('childDb', createChildDb(db.client as never, scope, ORG));
    await next();
  });
  app.route('/', attendanceRoute as unknown as Hono);
  const res = await app.request(`/checkins?${query}`);
  return { status: res.status, body: (await res.json()) as any };
}

describe('GET /api/me/attendance/checkins（#1075）', () => {
  it('只回這個孩子、期間內的日期與台北時間 HH:mm；不帶刷卡人等欄位', async () => {
    const { status, body } = await get(`childId=${MINE}&dateFrom=2026-10-10&dateTo=2026-10-22`);

    expect(status).toBe(200);
    // 08:42Z = 台北 16:42；兄弟姊妹的、期間外的都不在（org 由孩子範圍隱含，同列表那支）
    expect(body.data).toEqual([{ date: '2026-10-21', time: '16:42' }]);
  });

  it('dailyCheckinCampusIds：孩子報過名（含已退班）的分校裡，生效模式是日到班的', async () => {
    const { body } = await get(`childId=${MINE}&dateFrom=2026-10-10&dateTo=2026-10-22`);

    expect(body.dailyCheckinCampusIds).toEqual(['c-daily']);
  });

  it('區間：剛好 366 天放行；367 天、或 dateFrom 晚於 dateTo → 400', async () => {
    expect((await get(`childId=${MINE}&dateFrom=2025-10-22&dateTo=2026-10-22`)).status).toBe(200);
    const tooLong = await get(`childId=${MINE}&dateFrom=2025-10-21&dateTo=2026-10-22`);
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.code).toBe('INVALID_RANGE');
    expect((await get(`childId=${MINE}&dateFrom=2026-10-22&dateTo=2026-10-21`)).status).toBe(400);
  });

  // 讀失敗不能變成 200＋空清單：到班行會被讀成「沒有到班紀錄」或整個消失
  it.each([
    ['daily_checkins', '到班紀錄'],
    ['enrollments', '報名（分校來源）'],
    ['classes', '班級（分校來源）'],
    ['organizations', '機構出勤模式（dailyCheckinCampusIds）'],
  ])('讀 %s 失敗（%s）→ 500 FETCH_CHECKINS_FAILED', async (table) => {
    const { status, body } = await get(
      `childId=${MINE}&dateFrom=2026-10-10&dateTo=2026-10-22`,
      ['parent'],
      [MINE, SIBLING],
      table,
    );

    expect(status).toBe(500);
    expect(body.code).toBe('FETCH_CHECKINS_FAILED');
  });

  it('不是家長 → 403；孩子不在範圍 → 403', async () => {
    const q = `childId=${MINE}&dateFrom=2026-10-10&dateTo=2026-10-22`;
    expect((await get(q, ['admin'])).status).toBe(403);
    expect((await get(q, ['parent'], [SIBLING])).body.code).toBe('CHILD_OUT_OF_SCOPE');
  });
});
