import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';
import orgSettingsRoute, { toOrgSettingsResponse, touchesFinanceSettings } from './org-settings';

/**
 * `PATCH /api/org/settings` 的准入。
 *
 * `/api/org` 的 mount 是 `['admin', 'teacher']`（老師要讀得到點名時窗與模式），
 * 而這支 PATCH **原本沒有任何角色檢查** —— 於是任何老師都改得動
 * `attendance_retroactive_days`（他自己的補登時窗）、`attendance_mode`，
 * 以及 `meal_default_price` / `proration_basis` 這些金流參數。後三個尤其荒謬：
 * `/api/invoices` 要 `manage_finance` 才進得去，但餐費單價可以從一支不需要任何
 * 權限的端點改掉。
 *
 * 見 kb/wiki/architecture/authorization-scope.md 洞 1。
 */
function appAs(roles: string[], permissions: string[]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set;
    set('roles', roles);
    set('permissions', permissions);
    set('orgId', 'org-1');
    set('userId', 'user-1');
    await next();
  });
  app.route('/', orgSettingsRoute as unknown as Hono);
  return app;
}

const patch = (roles: string[], permissions: string[]) =>
  appAs(roles, permissions).request('/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ attendanceRetroactiveDays: 30 }),
  });

describe('PATCH /settings 的准入', () => {
  it('老師不能改組織設定', async () => {
    const res = await patch(['teacher'], []);

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('管理員沒有 manage_org_settings 也不能改', async () => {
    expect((await patch(['admin'], ['basic_operations'])).status).toBe(403);
  });

  // 同時是老師的管理員，權限足夠就能改 —— 擋的是角色不是人
  it('有權限的管理員放行（不是 403）', async () => {
    expect((await patch(['admin', 'teacher'], ['manage_org_settings'])).status).not.toBe(403);
  });

  it('`*` 通吃', async () => {
    expect((await patch(['admin'], ['*'])).status).not.toBe(403);
  });

  /**
   * 餐費單價、開帳天數、比例分攤基準是財務設定，要 `manage_finance`。
   *
   * 使用者指出的：**任課老師沒有權限處理餐費問題** —— 而且不只老師，
   * 負責點名規則的行政也不見得該動價目。`/api/invoices` 要 `manage_finance`
   * 才進得去，餐費單價卻能從組織設定改掉，那是同一份權限被繞過。
   */
  it('有 manage_org_settings 但沒有 manage_finance，不能改餐費單價', async () => {
    const res = await appAs(['admin'], ['manage_org_settings']).request('/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mealDefaultPrice: 80 }),
    });

    expect(res.status).toBe(403);
  });

  it('有 manage_finance 就能改', async () => {
    const res = await appAs(['admin'], ['manage_org_settings', 'manage_finance']).request(
      '/settings',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mealDefaultPrice: 80 }),
      },
    );

    expect(res.status).not.toBe(403);
  });

  // GET 不受影響：老師要讀得到點名時窗，儀表板要讀得到 attendanceMode
  it('GET 不受權限限制', async () => {
    expect((await appAs(['teacher'], []).request('/settings')).status).not.toBe(403);
  });
});

describe('toOrgSettingsResponse', () => {
  it('maps DB row to camelCase response', () => {
    const row = {
      id: 'org-1',
      name: '測試補習班',
      attendance_mode: 'per_session',
    };
    const result = toOrgSettingsResponse(row);
    expect(result).toEqual({
      id: 'org-1',
      name: '測試補習班',
      attendanceMode: 'per_session',
      attendanceResponsible: 'admin',
      attendanceRetroactiveDays: 0,
      // 欄位不在的舊 org 用 14 —— 對齊 billing_rules 規則 7 的「發袋後兩三週」節奏
      invoiceDueDays: 14,
      mealDefaultPrice: 0,
      prorationBasis: 'days',
    });
  });

  it('org 有設定天數時照用', () => {
    const row = { id: 'org-1', name: '測試', attendance_mode: 'per_session', invoice_due_days: 21 };

    expect(toOrgSettingsResponse(row)).toMatchObject({ invoiceDueDays: 21 });
  });

  /**
   * 財務設定只給有 `manage_finance` 的人。**是 key 不存在，不是 0** ——
   * 「餐費單價是 0」跟「你不該知道餐費單價」是兩件不同的事，回 0 會讓
   * 讀到的人以為機構真的沒設定。
   */
  it('沒有財務權限時，回應裡根本沒有那三個 key', () => {
    const row = {
      id: 'org-1',
      name: '測試',
      attendance_mode: 'per_session',
      meal_default_price: 80,
      invoice_due_days: 21,
      proration_basis: 'sessions',
    };

    const result = toOrgSettingsResponse(row, false);

    expect(result).not.toHaveProperty('mealDefaultPrice');
    expect(result).not.toHaveProperty('invoiceDueDays');
    expect(result).not.toHaveProperty('prorationBasis');
    // 老師真正需要的那幾個還在
    expect(result).toMatchObject({
      attendanceMode: 'per_session',
      attendanceResponsible: 'admin',
      attendanceRetroactiveDays: 0,
    });
  });
});

describe('touchesFinanceSettings', () => {
  it('只改點名設定不算動到財務', () => {
    expect(touchesFinanceSettings({ attendanceRetroactiveDays: 3 })).toBe(false);
  });

  it('改餐費單價算', () => {
    expect(touchesFinanceSettings({ mealDefaultPrice: 80 })).toBe(true);
  });

  it('改開帳天數算', () => {
    expect(touchesFinanceSettings({ invoiceDueDays: 21 })).toBe(true);
  });

  it('改比例分攤基準算', () => {
    expect(touchesFinanceSettings({ prorationBasis: 'sessions' })).toBe(true);
  });

  // 0 是合法的值，不能被 `!body[key]` 那種寫法漏掉
  it('把餐費單價設成 0 也算動到財務', () => {
    expect(touchesFinanceSettings({ mealDefaultPrice: 0 })).toBe(true);
  });

  it('maps daily_checkin mode correctly', () => {
    const row = { id: 'org-1', name: '測試', attendance_mode: 'daily_checkin' };
    expect(toOrgSettingsResponse(row).attendanceMode).toBe('daily_checkin');
  });
});
