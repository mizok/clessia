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
      // #1821：欄位不在（migration 還沒套）→ 設計稿預設 3／1
      applicationReviewDays: 3,
      trialFollowupDays: 1,
      // 欄位不在的舊 org 用 14 —— 對齊 billing_rules 規則 7 的「發袋後兩三週」節奏
      invoiceDueDays: 14,
      billingReminderDays: 14,
      leaveWaiverDays: 3,
      mealDefaultPrice: 0,
      prorationBasis: 'days',
      // #1073：還沒設定帳戶資訊 → null（家長頁退回「請洽行政人員」）
      paymentInfo: null,
      // #1660：欄位不在（migration 還沒套）→ 設計稿的預設時間點
      invoiceReminderOffsets: [-3, 0, 1, 7],
    });
  });

  it('帳戶資訊照回；空字串視同未設定（#1073）', () => {
    const base = { id: 'org-1', name: '測試', attendance_mode: 'per_session' };
    expect(toOrgSettingsResponse({ ...base, payment_info: '台銀 004\n帳號 123' })).toMatchObject({
      paymentInfo: '台銀 004\n帳號 123',
    });
    expect(toOrgSettingsResponse({ ...base, payment_info: '' })).toMatchObject({
      paymentInfo: null,
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
    expect(result).not.toHaveProperty('paymentInfo');
    // 老師真正需要的那幾個還在
    expect(result).toMatchObject({
      attendanceMode: 'per_session',
      attendanceResponsible: 'admin',
      attendanceRetroactiveDays: 0,
    });
  });
});

describe('billingReminderDays（#1305）', () => {
  it('有財務權限：回設定值；欄位缺席退回 14', () => {
    expect(toOrgSettingsResponse({ id: 'o', billing_reminder_days: 7 })).toMatchObject({
      billingReminderDays: 7,
    });
    expect(toOrgSettingsResponse({ id: 'o' })).toMatchObject({ billingReminderDays: 14 });
  });

  it('沒有財務權限：回應裡沒有這個 key', () => {
    expect(toOrgSettingsResponse({ id: 'o', billing_reminder_days: 7 }, false)).not.toHaveProperty(
      'billingReminderDays',
    );
  });
});

describe('leaveWaiverDays（#1732）', () => {
  it('有財務權限：回設定值；欄位缺席退回 3', () => {
    expect(toOrgSettingsResponse({ id: 'o', leave_waiver_days: 5 })).toMatchObject({
      leaveWaiverDays: 5,
    });
    expect(toOrgSettingsResponse({ id: 'o' })).toMatchObject({ leaveWaiverDays: 3 });
  });

  it('沒有財務權限：回應裡沒有這個 key', () => {
    expect(toOrgSettingsResponse({ id: 'o', leave_waiver_days: 5 }, false)).not.toHaveProperty(
      'leaveWaiverDays',
    );
  });

  it('改它算動到財務設定', () => {
    expect(touchesFinanceSettings({ leaveWaiverDays: 4 })).toBe(true);
  });

  // 二讀突變（#1738）：DB 存非預設值 7，select 漏欄位會落到預設 3
  const FIN = ['manage_org_settings', 'manage_finance'];
  it('GET 與 PATCH 回的是 DB 裡的值（SELECT_FIELDS 要有這一欄）', async () => {
    const { get, sendBody } = appWith(FIN, { leave_waiver_days: 7 });
    expect(await (await get()).json()).toMatchObject({ leaveWaiverDays: 7 });
    expect(await (await sendBody({ mealDefaultPrice: 80 })).json()).toMatchObject({
      leaveWaiverDays: 7,
    });
  });

  it('PATCH 真的寫進 leave_waiver_days', async () => {
    const { sendBody, updates } = appWith(FIN, { leave_waiver_days: 7 });
    const res = await sendBody({ leaveWaiverDays: 5 });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ leave_waiver_days: 5 }]);
    expect(await res.json()).toMatchObject({ leaveWaiverDays: 5 });
  });

  it.each([
    [1, 400],
    [2, 200],
    [30, 200],
    [31, 400],
  ])('邊界：%i → %i（DB 的 CHECK 也擋，但那樣會變 500）', async (days, status) => {
    const { sendBody, updates } = appWith(FIN, { leave_waiver_days: 7 });
    expect((await sendBody({ leaveWaiverDays: days })).status).toBe(status);
    expect(updates).toEqual(status === 200 ? [{ leave_waiver_days: days }] : []);
  });

  it('只有 manage_org_settings：403，什麼都沒寫', async () => {
    const { sendBody, updates } = appWith(['manage_org_settings']);
    expect((await sendBody({ leaveWaiverDays: 5 })).status).toBe(403);
    expect(updates).toEqual([]);
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

  // #1305：待開單提醒天數跟開帳天數同一類（開帳節奏）
  it('改待開單提醒天數算', () => {
    expect(touchesFinanceSettings({ billingReminderDays: 7 })).toBe(true);
  });

  it('改比例分攤基準算', () => {
    expect(touchesFinanceSettings({ prorationBasis: 'sessions' })).toBe(true);
  });

  // #1073：改帳戶資訊＝改家長匯款的去向，是金額路徑的門
  it('改帳戶資訊算（含清空成 null）', () => {
    expect(touchesFinanceSettings({ paymentInfo: '台銀 004' })).toBe(true);
    expect(touchesFinanceSettings({ paymentInfo: null })).toBe(true);
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

/**
 * **#828：出勤模式改了不留痕跡。**
 *
 * `attendance_mode` 決定**老師端有沒有點名入口**、出勤紀錄怎麼產生
 * （`schedule.page.ts` 的 `isTeacherLed()` 吃它）——
 * 它是整個系統設定區裡影響面最大的開關，而它原本是唯一一個沒有 `audit_logs` 的。
 * 在這一筆之前，**沒有任何方法可以回答「是誰、什麼時候把出勤模式改掉的」。**
 *
 * ⚠️ 這組測試證明的是「接線存在」，不是「DB 真的收下那一筆」——
 * `resource_type` 的 CHECK 是這一輪才加上 `organization` 的，
 * 而 `logAudit` 被 CHECK 擋掉時只會印一行，測試照樣綠（見 subjects.spec 的同一段）。
 *
 * 上面那組 `appAs` 刻意不給 supabase（它只測准入，到 DB 那行就 500），
 * 所以這裡自己建一個**替身完整**的 app。
 */
describe('PATCH /settings 的稽核紀錄（#828）', () => {
  function appWithDb() {
    const auditRows: Array<Record<string, unknown>> = [];

    const supabase = {
      from(table: string) {
        if (table === 'organizations') {
          return {
            update: () => ({
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        id: 'org-1',
                        name: 'Clessia Demo',
                        attendance_mode: 'daily_checkin',
                        attendance_responsible: 'admin',
                        attendance_retroactive_days: 0,
                        invoice_due_days: 7,
                        meal_default_price: 60,
                        proration_basis: 'sessions',
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        // `logAudit` 先查 profiles 再寫 audit_logs —— 缺任何一個它就靜默失敗
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
            }),
          };
        }
        if (table === 'audit_logs') {
          return {
            insert: (payload: Record<string, unknown>) => {
              auditRows.push(payload);
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`Unsupported table in this fixture: ${table}`);
      },
    };

    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set;
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('orgId', 'org-1');
      set('userId', 'user-1');
      set('supabase', supabase);
      await next();
    });
    app.route('/', orgSettingsRoute as unknown as Hono);

    return { app, auditRows };
  }

  async function patchMode(body: unknown) {
    const { app, auditRows } = appWithDb();
    const res = await app.request('/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    // fire-and-forget：讓 logAudit 的 microtask 跑完
    await Promise.resolve();
    await Promise.resolve();

    return auditRows;
  }

  it('改出勤模式會寫一筆 audit_logs', async () => {
    const auditRows = await patchMode({ attendanceMode: 'daily_checkin' });

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      resource_type: 'organization',
      resource_id: 'org-1',
      action: 'update',
    });
  });

  /**
   * **`details` 只記這次真的送出的欄位。** 一次只改一個欄位時，
   * 稽核紀錄不該看起來像整張設定都動了 —— 那會讓「誰改了出勤模式」這個問題
   * 在每一筆設定變更上都得到「可能是他」的答案。
   */
  it('details 只含這次送出的欄位，不是整張設定', async () => {
    const auditRows = await patchMode({ attendanceMode: 'daily_checkin' });

    expect(auditRows[0]['details']).toEqual({
      fields: ['attendance_mode'],
      values: { attendance_mode: 'daily_checkin' },
    });
  });

  it('改別的欄位時 details 跟著換 —— 不是寫死出勤模式', async () => {
    const auditRows = await patchMode({ attendanceRetroactiveDays: 30 });

    expect(auditRows[0]['details']).toEqual({
      fields: ['attendance_retroactive_days'],
      values: { attendance_retroactive_days: 30 },
    });
  });
});

/**
 * #1660（#1626 Q2）：家長繳費提醒時間點是機構設定，跟帳戶資訊同一道門檻（`manage_finance`）。
 * 範圍 [-30, 60]、最多 6 個、不重複；存的時候排序。
 */
/** 照 select 字串投影的 organizations 替身（#1660 起）；`extra` 是 DB 裡已經存的非預設值 */
function appWith(
  permissions: string[],
  extra: Record<string, unknown> = { invoice_reminder_offsets: [-1] },
) {
  const updates: Array<Record<string, unknown>> = [];
  // DB 裡存的是非預設值 —— select 字串漏了這一欄的話，回應會落到預設的 [-3,0,1,7]
  const row: Record<string, unknown> = {
    id: 'org-1',
    name: 'x',
    attendance_mode: 'per_session',
    ...extra,
  };
  /** 只回 select 字串裡有的欄位（像 PostgREST 一樣），漏選的欄位就是不在 */
  const project = (r: Record<string, unknown>, cols: string) =>
    Object.fromEntries(
      cols
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c in r)
        .map((c) => [c, r[c]]),
    );
  const supabase = {
    from(table: string) {
      if (table === 'organizations') {
        return {
          select: (cols: string) => ({
            eq: () => ({
              single: () => Promise.resolve({ data: project(row, cols), error: null }),
            }),
          }),
          update: (u: Record<string, unknown>) => {
            updates.push(u);
            return {
              eq: () => ({
                select: (cols: string) => ({
                  single: () =>
                    Promise.resolve({ data: project({ ...row, ...u }, cols), error: null }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          }),
        };
      }
      return { insert: () => Promise.resolve({ error: null }) }; // audit_logs
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set;
    set('roles', ['admin']);
    set('permissions', permissions);
    set('orgId', 'org-1');
    set('userId', 'user-1');
    set('supabase', supabase);
    await next();
  });
  app.route('/', orgSettingsRoute as unknown as Hono);
  const send = (offsets: unknown) =>
    app.request('/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoiceReminderOffsets: offsets }),
    });
  const get = () => app.request('/settings');
  const sendBody = (body: object) =>
    app.request('/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { send, updates, get, sendBody };
}
describe('invoiceReminderOffsets（#1660）', () => {
  const FINANCE = ['manage_org_settings', 'manage_finance'];

  it('GET 與 PATCH 回的是 DB 裡的值，不是預設值（SELECT_FIELDS 要有這一欄）', async () => {
    const { get, send } = appWith(['manage_org_settings', 'manage_finance']);
    expect(await (await get()).json()).toMatchObject({ invoiceReminderOffsets: [-1] });
    // 只改別的欄位：回應裡的時間點仍然是 DB 的 [-1]
    const res = await send([-1]);
    expect(await res.json()).toMatchObject({ invoiceReminderOffsets: [-1] });
  });

  it('有 manage_finance：存排序後的值，回應帶回來', async () => {
    const { send, updates } = appWith(FINANCE);
    const res = await send([7, -3, 0]);
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ invoice_reminder_offsets: [-3, 0, 7] }]);
    expect(await res.json()).toMatchObject({ invoiceReminderOffsets: [-3, 0, 7] });
  });

  it('只有 manage_org_settings：403，什麼都沒寫', async () => {
    const { send, updates } = appWith(['manage_org_settings']);
    expect((await send([-3])).status).toBe(403);
    expect(updates).toEqual([]);
  });

  it.each([
    ['7 個', [-5, -3, 0, 1, 2, 3, 7]],
    ['重複', [1, 1]],
    ['小於 -30', [-31]],
    ['大於 60', [61]],
    ['不是整數', [1.5]],
  ])('%s → 400，什麼都沒寫', async (_l, offsets) => {
    const { send, updates } = appWith(FINANCE);
    expect((await send(offsets)).status).toBe(400);
    expect(updates).toEqual([]);
  });

  it('邊界 [-30, 60]、6 個、空陣列都可以', async () => {
    const { send } = appWith(FINANCE);
    expect((await send([-30, -1, 0, 1, 30, 60])).status).toBe(200);
    expect((await send([])).status).toBe(200);
  });

  it('沒有財務權限：GET 的回應裡沒有這個 key；有權限、欄位缺席退回預設', () => {
    expect(
      toOrgSettingsResponse({ id: 'o', invoice_reminder_offsets: [1] }, false),
    ).not.toHaveProperty('invoiceReminderOffsets');
    expect(toOrgSettingsResponse({ id: 'o' })).toMatchObject({
      invoiceReminderOffsets: [-3, 0, 1, 7],
    });
  });

  it('touchesFinanceSettings 認得它', () => {
    expect(touchesFinanceSettings({ invoiceReminderOffsets: [] })).toBe(true);
  });
});

/**
 * #1821 報名審核時效與試聽跟進天數。不是財務設定：`manage_org_settings` 就能改。
 * DB 存非預設值 —— 回應寫死預設、select 漏欄位都會落到 3／1。
 */
describe('applicationReviewDays／trialFollowupDays（#1821）', () => {
  const STORED = { application_review_days: 5, trial_followup_days: 4 };
  const SETTINGS = ['manage_org_settings'];

  it('GET 與 PATCH 回的是 DB 裡的值（SELECT_FIELDS 要有這兩欄）', async () => {
    const { get, sendBody } = appWith(SETTINGS, STORED);
    const expected = { applicationReviewDays: 5, trialFollowupDays: 4 };
    expect(await (await get()).json()).toMatchObject(expected);
    expect(await (await sendBody({ attendanceRetroactiveDays: 1 })).json()).toMatchObject(expected);
  });

  it('欄位缺席退回 3／1', () => {
    expect(toOrgSettingsResponse({ id: 'o' }, false)).toMatchObject({
      applicationReviewDays: 3,
      trialFollowupDays: 1,
    });
  });

  it('PATCH 真的寫進兩欄（只有 manage_org_settings 也可以，不是財務設定）', async () => {
    const { sendBody, updates } = appWith(SETTINGS, STORED);
    const res = await sendBody({ applicationReviewDays: 0, trialFollowupDays: 30 });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ application_review_days: 0, trial_followup_days: 30 }]);
    expect(await res.json()).toMatchObject({ applicationReviewDays: 0, trialFollowupDays: 30 });
  });

  it.each([
    ['applicationReviewDays', 'application_review_days'],
    ['trialFollowupDays', 'trial_followup_days'],
  ])(
    '%s 邊界：-1、31 → 400 不寫（DB 的 CHECK 也擋，但那樣會變 500）；0、30 可以',
    async (key, column) => {
      for (const [days, status] of [
        [-1, 400],
        [0, 200],
        [30, 200],
        [31, 400],
      ] as const) {
        const { sendBody, updates } = appWith(SETTINGS, STORED);
        expect((await sendBody({ [key]: days })).status).toBe(status);
        expect(updates).toEqual(status === 200 ? [{ [column]: days }] : []);
      }
    },
  );
});
