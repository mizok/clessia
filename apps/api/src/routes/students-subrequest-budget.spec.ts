import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import studentsApp from './students';

/**
 * Cloudflare Workers 免費方案：**每個請求最多 50 個 subrequest**，supabase-js 每一次查詢就是一個
 * （同 `leaves-subrequest-budget.spec.ts`）。本機沒有這個上限，超過了只會在正式站失敗。
 *
 * #2053「沒有有效到班卡」篩選：PostgREST 的聚合不吃 embed 的反連接，開著時年級章節改成每級一支
 * head count（+12）。計畫席 10-28 裁定 A 的條件：**最壞情況 ≤ 45**，超過就改走 pg 池一句 GROUP BY。
 *
 * 最壞情況＝受限管理員（分校範圍）＋數字搜尋（多查家長電話）＋學制不合＋沒有有效卡＋第一頁算今日到班。
 * 替身每一支查詢都回一列「什麼欄位都有」的資料，讓每條分支都走到底，不在半路因為空結果提早回。
 */
const ORG = '00000000-0000-0000-0000-00000000000a';
const CAMPUS = '00000000-0000-0000-0000-0000000000c1';
const TODAY = getCurrentTaipeiDateString();
const ROW = {
  id: '00000000-0000-0000-0000-000000000001',
  org_id: ORG,
  student_id: '00000000-0000-0000-0000-000000000001',
  class_id: '00000000-0000-0000-0000-000000000011',
  campus_id: CAMPUS,
  user_id: 'user-9',
  name: '王小明',
  grade: 'J1',
  level: 'elementary',
  is_active: true,
  status: 'active',
  attendance_mode: 'daily_checkin',
  session_date: TODAY,
  start_time: '09:00:00',
  end_time: '10:00:00',
  effective_from: '2020-01-01',
  effective_to: null,
  phone: '0912345678',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  classes: { id: '00000000-0000-0000-0000-000000000011', name: '國一數學', campus_id: CAMPUS },
  enrollments: [],
  parent_student_relations: [],
  active_card: [],
  count: 1,
};

function countingSupabase() {
  let queries = 0;
  const builder = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const op of [
      'select',
      'eq',
      'neq',
      'in',
      'or',
      'is',
      'not',
      'ilike',
      'gte',
      'lte',
      'lt',
      'gt',
      'order',
      'range',
      'limit',
    ]) {
      b[op] = chain;
    }
    b['maybeSingle'] = () => Promise.resolve({ data: ROW, error: null });
    b['single'] = () => Promise.resolve({ data: ROW, error: null });
    b['then'] = (resolve: (v: unknown) => unknown) =>
      resolve({ data: [ROW], count: 1, error: null });
    return b;
  };
  return {
    client: {
      from: () => {
        queries++;
        return builder();
      },
    },
    count: () => queries,
  };
}

async function queriesFor(query: string) {
  const db = countingSupabase();
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'user-1');
    set('roles', ['admin']);
    set('campusScope', [CAMPUS]);
    await next();
  });
  app.route('/', studentsApp as unknown as Hono);
  const res = await app.request(`/?${query}`);
  expect(res.status).toBe(200);
  return db.count();
}

const WORST = `search=0912&schoolMismatch=true&campusId=${CAMPUS}`;

describe('GET /api/students 的 subrequest 預算（Workers 上限 50，#2053）', () => {
  it('開著「沒有有效卡」＝年級章節從 1 支聚合換成 12 支 head count（多 11 支）', async () => {
    expect((await queriesFor(`${WORST}&withoutCard=true`)) - (await queriesFor(WORST))).toBe(11);
  });

  it('最壞情況（受限管理員＋數字搜尋＋學制不合＋沒有有效卡＋今日到班）≤ 45 次查詢', async () => {
    const n = await queriesFor(`${WORST}&withoutCard=true`);
    // 真的走完了：12 支年級 head count 加上列表、在籍數、搜尋、範圍、今日到班 —— 不是半路回的低數字
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThanOrEqual(45);
  });
});
