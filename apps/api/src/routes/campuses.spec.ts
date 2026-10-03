import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import * as campusesRoute from './campuses';

describe('buildCampusSummary', () => {
  it('builds global campus summary counts from filtered rows', () => {
    const buildCampusSummary = (campusesRoute as Record<string, unknown>)['buildCampusSummary'] as
      | ((rows: Array<{ is_active: boolean }>) => {
          total: number;
          activeCount: number;
          inactiveCount: number;
        })
      | undefined;

    expect(buildCampusSummary).toBeTypeOf('function');

    const summary = buildCampusSummary?.([
      { is_active: true },
      { is_active: false },
      { is_active: true },
    ]);

    expect(summary).toEqual({
      total: 3,
      activeCount: 2,
      inactiveCount: 1,
    });
  });

  /**
   * #751：三個數字要對得起來。
   *
   * `activeCount` / `inactiveCount` 一直是從**未套 `isActive` 篩選**的 rows 算的
   * （`campuses.ts` 那行註解：「summary 不套用 isActive filter，永遠反映全機構的
   * 真實總數」），但 `total` 原本是主清單查詢的 `count`，那一支**有**套篩選。
   * 於是隱藏停用分校時畫面印出「12 個分校 / 12 啟用中 / 1 已停用」—— 12 ≠ 12+1。
   *
   * **上面那條既有測試沒抓到，是因為它給的 rows.length 與 total 剛好相等。**
   * 這一條刻意讓兩者不一致。
   */
  it('#751 總數含停用 —— 三個數字必須自洽，不受清單篩選影響', () => {
    const buildCampusSummary = (campusesRoute as Record<string, unknown>)['buildCampusSummary'] as (
      rows: Array<{ is_active: boolean }>,
    ) => { total: number; activeCount: number; inactiveCount: number };

    // 全機構 3 間（2 啟用 1 停用），而清單當下只顯示啟用的那 2 間
    const summary = buildCampusSummary([
      { is_active: true },
      { is_active: false },
      { is_active: true },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.activeCount).toBe(2);
    expect(summary.inactiveCount).toBe(1);
    expect(summary.total).toBe(summary.activeCount + summary.inactiveCount);
  });
});

/**
 * 分校範圍要套在**清單與統計兩支查詢上**（#515 下半）。
 *
 * `campuses.ts:156` 與 `:183` 各套一次 `applyCampusFilter(…, 'id', campusScope)`，
 * 而 `:182` 的註解寫著理由：**「統計要跟清單同範圍，否則『共 5 間』配上 2 列」**。
 *
 * **所以這裡釘的是次數不是「有出現過」** —— 兩處產生同樣形狀的呼叫，
 * 只斷言「有出現」的話，其中一處掉了另一處仍然滿足（attendance 那支實測過：
 * 拿掉其中一處，`toContainEqual` 版本照樣綠）。
 *
 * 這條只能斷言查詢形狀：替身回的是固定資料，條件下對下錯回一樣的東西。
 */
describe('GET /api/campuses —— 分校範圍要套在清單與統計兩支查詢上', () => {
  function fakeSupabase() {
    const inCalls: Array<{ column: string; values: string[] }> = [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder as never;

    Object.assign(builder, {
      select: () => chain(),
      eq: () => chain(),
      ilike: () => chain(),
      order: () => chain(),
      range: () => chain(),
      in: (column: string, values: readonly string[]) => {
        inCalls.push({ column, values: [...values] });
        return chain();
      },
      then: (resolve: (value: { data: unknown[]; count: number; error: null }) => unknown) =>
        resolve({ data: [], count: 0, error: null }),
    });

    return { inCalls, from: () => builder };
  }

  async function list(campusScope: readonly string[] | null) {
    const supabase = fakeSupabase();
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', '00000000-0000-0000-0000-0000000000aa');
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('campusScope', campusScope);
      await next();
    });
    app.route('/', campusesRoute.default as unknown as Hono);

    const res = await app.request('/');
    expect(res.status).toBe(200);

    return supabase.inCalls;
  }

  it('受限管理員：清單與統計各帶一次他的分校清單', async () => {
    const inCalls = await list(['campus-1']);

    const scoped = inCalls.filter((call) => call.column === 'id');
    expect(scoped).toHaveLength(2);
    for (const call of scoped) {
      expect(call.values).toEqual(['campus-1']);
    }
  });

  it('不受分校限制時兩支都不下這個條件（確認上一條不是無腦通過）', async () => {
    const inCalls = await list(null);

    expect(inCalls.some((call) => call.column === 'id')).toBe(false);
  });
});

/**
 * **#837：分校的稽核 `details` 全是 `{}`** —— `update` 只留改完後的名字，
 * 「這一筆改了什麼」完全查不到（labor-8 實按比對六種 `resource_type` 時發現）。
 *
 * 分校是 13 個實例的實體、改名／停用是行政上會被追問的動作 ——
 * 稽核答得出誰／何時、答不出改成什麼，等於只有一半。
 *
 * ⚠️ **工單說「五顆都補」，而 API 只有三個端點**：UI 的停用／啟用走的是
 * `PUT /{id}`（改 `is_active`），所以那五次操作在稽核上是
 * `create` / `update` ×3 / `delete`。三個端點補完就涵蓋五顆。
 */
describe('campuses 的稽核 details（#837）', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  const CAMPUS = '00000000-0000-0000-0000-0000000000c1';
  const BEFORE = {
    id: CAMPUS,
    name: '中正分校',
    address: '舊地址',
    phone: null,
    is_active: true,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };

  // 真的照條件過濾的替身 —— 路由先以 org 範圍讀「改動前那一列」（#966 B1），
  // 回固定資料的替身分不出條件有沒有下對
  const fakeDb = () => createMultiOrgDb({ campuses: [{ ...BEFORE, org_id: ORG }] });

  async function request(path: string, method: string, body?: unknown) {
    const db = fakeDb();
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db.client);
      set('orgId', ORG);
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', campusesRoute.default as unknown as Hono);

    const res = await app.request(path, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    });
    // 稽核是 fire-and-forget，等它落地
    await new Promise((resolve) => setTimeout(resolve, 0));

    return { status: res.status, auditRows: db.rows('audit_logs') };
  }

  it('改名：details 記得下 from 與 to，只含這次送出的欄位', async () => {
    const { status, auditRows } = await request(`/${CAMPUS}`, 'PUT', { name: '中正旗艦校' });

    expect(status).toBe(200);
    const row = auditRows.find((r) => r['action'] === 'update');
    expect(row?.['details']).toEqual({
      fields: ['name'],
      from: { name: '中正分校' },
      to: { name: '中正旗艦校' },
    });
  });

  // 停用走的是同一支 PUT —— 所以它也要記得下 is_active 的 before
  it('停用：details 的 from 記得下原本是啟用的', async () => {
    const { auditRows } = await request(`/${CAMPUS}`, 'PUT', { isActive: false });

    const row = auditRows.find((r) => r['action'] === 'update');
    expect(row?.['details']).toEqual({
      fields: ['is_active'],
      from: { is_active: true },
      to: { is_active: false },
    });
  });

  it('刪除：details 是刪前快照，不含 created_at 這類不是人改的欄位', async () => {
    const { auditRows } = await request(`/${CAMPUS}`, 'DELETE');

    const row = auditRows.find((r) => r['action'] === 'delete');
    expect(row?.['details']).toEqual({
      name: '中正分校',
      address: '舊地址',
      phone: null,
      is_active: true,
    });
    expect(row?.['details']).not.toHaveProperty('created_at');
  });
});

/**
 * #1112：出勤模式是分校層級。`attendanceMode` null = 沿用機構預設。
 *
 * 改它的門檻跟改機構預設一樣是 `manage_org_settings`（`org-settings.ts`）——
 * 分校這支 PUT 本身只要 admin，若不另擋，沒有那個權限的管理員繞到分校就改得到同一個開關。
 * 受分校限制的管理員也只能改自己管的分校。
 */
describe('PUT /api/campuses/:id —— 出勤模式（#1112）', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  const MINE = '00000000-0000-0000-0000-0000000000c1';
  const THEIRS = '00000000-0000-0000-0000-0000000000c2';
  const row = (id: string) => ({
    id,
    org_id: ORG,
    name: id === MINE ? '中正' : '信義',
    address: null,
    phone: null,
    is_active: true,
    attendance_mode: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  });

  async function put(
    id: string,
    body: unknown,
    who: { permissions?: string[]; campusScope?: readonly string[] | null } = {},
  ) {
    const db = createMultiOrgDb({ campuses: [row(MINE), row(THEIRS)] });
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', db.client);
      set('orgId', ORG);
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('permissions', who.permissions ?? ['manage_org_settings']);
      set('campusScope', who.campusScope ?? null);
      await next();
    });
    app.route('/', campusesRoute.default as unknown as Hono);
    const res = await app.request(`/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stored = db.rows('campuses').find((r) => r['id'] === id)?.['attendance_mode'];
    return { status: res.status, body: (await res.json()) as any, stored };
  }

  it('有 manage_org_settings：寫得進去，回應帶 attendanceMode', async () => {
    const { status, body, stored } = await put(MINE, { attendanceMode: 'per_session' });

    expect(status).toBe(200);
    expect(stored).toBe('per_session');
    expect(body.data.attendanceMode).toBe('per_session');
  });

  it('設回 null = 沿用機構預設', async () => {
    const { status, stored } = await put(MINE, { attendanceMode: null });

    expect(status).toBe(200);
    expect(stored).toBeNull();
  });

  it('沒有 manage_org_settings：403，沒寫', async () => {
    const { status, stored } = await put(
      MINE,
      { attendanceMode: 'per_session' },
      { permissions: ['basic_operations'] },
    );

    expect(status).toBe(403);
    expect(stored).toBeNull();
  });

  it('沒有 manage_org_settings 但只改名：不受這道影響', async () => {
    const { status } = await put(MINE, { name: '中正旗艦' }, { permissions: [] });

    expect(status).toBe(200);
  });

  it('受分校限制：改別人管的分校 403，沒寫', async () => {
    const { status, stored } = await put(
      THEIRS,
      { attendanceMode: 'per_session' },
      { campusScope: [MINE] },
    );

    expect(status).toBe(403);
    expect(stored).toBeNull();
  });

  it('受分校限制：自己的分校照常', async () => {
    const { status } = await put(
      MINE,
      { attendanceMode: 'daily_checkin' },
      { campusScope: [MINE] },
    );

    expect(status).toBe(200);
  });
});
