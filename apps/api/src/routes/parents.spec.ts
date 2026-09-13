import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

// **靜態 import，不要在 test body 裡動態 import。**
// 原本兩個測試各寫 `await import('./parents')`，於是**模組轉譯的時間被算進
// 5 秒的 test timeout**。這支路由檔很大，轉譯本身就要好幾秒 —— 本機連跑三次
// 分別是 2.5s 過、3.0s 過、5.0s **失敗**。
// 隨機紅在跟改動無關的地方，比慢更貴：它會讓所有人開始不信任 CI。
import parentsRoute, { toParentResponse } from './parents';

describe('toParentResponse', () => {
  it('maps snake_case DB row to camelCase, email 優先作為 loginAccount', () => {
    const row = {
      id: 'parent-uuid',
      user_id: 'ba-user-id',
      org_id: 'org-uuid',
      name: '林志明',
      phone: '0912345678',
      email: 'lin@example.com',
      status: 'active',
      notes: null,
      created_at: '2026-03-17T00:00:00Z',
      updated_at: '2026-03-17T00:00:00Z',
    };

    const result = toParentResponse(row, 2);
    expect(result).toMatchObject({
      id: 'parent-uuid',
      userId: 'ba-user-id',
      orgId: 'org-uuid',
      name: '林志明',
      phone: '0912345678',
      email: 'lin@example.com',
      loginAccount: 'lin@example.com',
      status: 'active',
      studentCount: 2,
    });
  });

  it('無 email 時 loginAccount 使用 phone', () => {
    const row = {
      id: 'parent-uuid',
      user_id: 'ba-user-id',
      org_id: 'org-uuid',
      name: '陳淑芬',
      phone: '0987654321',
      email: null,
      status: 'inactive',
      notes: null,
      created_at: '2026-03-17T00:00:00Z',
      updated_at: '2026-03-17T00:00:00Z',
    };

    const result = toParentResponse(row, 0);
    expect(result.loginAccount).toBe('0987654321');
  });
});

/**
 * **#816：`parents.ts` 原本完全沒有 campus-scope**（`grep -n campus` 回空）——
 * 只被指派一間分校的管理員看得到全機構家長的姓名與 email。
 *
 * 家長身上沒有 `campus_id`，所以範圍要走三跳：
 * `enrollments`（分校）→ `student_id` → `parent_student_relations` → `parent_id`，
 * 形狀照 `students.ts` 既有的做法（先撈 id 集合再 `.in('id', …)`）。
 *
 * 斷言的是**送出去的查詢長什麼樣**，不是回傳值 —— 替身回固定 fixture，
 * 「有下條件」與「沒下條件」在回傳值上完全一樣。
 */
describe('GET /api/parents —— 分校範圍（#816）', () => {
  interface QueryRecord {
    readonly table: string;
    columns: string;
    readonly ins: Array<{ column: string; values: string[] }>;
  }

  function fakeSupabase(queries: QueryRecord[]) {
    return {
      from(table: string) {
        const record: QueryRecord = { table, columns: '', ins: [] };
        queries.push(record);

        const builder: Record<string, unknown> = {};
        const chain = () => builder as never;
        Object.assign(builder, {
          select: (columns?: string) => {
            record.columns = columns ?? '';
            return chain();
          },
          eq: () => chain(),
          or: () => chain(),
          order: () => chain(),
          range: () => chain(),
          ilike: () => chain(),
          in: (column: string, values: readonly string[]) => {
            record.ins.push({ column, values: [...values] });
            return chain();
          },
          then: (resolve: (value: { data: unknown[]; count: number; error: null }) => unknown) => {
            // 每張表回剛好夠讓下一跳有輸入的最小 fixture
            const data =
              table === 'parents'
                ? [{ id: 'parent-1', user_id: 'user-1', org_id: 'org-1', name: '家長一' }]
                : table === 'enrollments'
                  ? [{ student_id: 'student-1' }]
                  : table === 'parent_student_relations'
                    ? [{ parent_id: 'parent-1', students: { id: 'student-1', name: '學生一' } }]
                    : [];
            return resolve({ data, count: data.length, error: null });
          },
        });

        return builder;
      },
    };
  }

  async function listParents(campusScope: readonly string[] | null) {
    const queries: QueryRecord[] = [];
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', fakeSupabase(queries));
      set('orgId', 'org-1');
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('campusScope', campusScope);
      await next();
    });
    app.route('/', parentsRoute as unknown as Hono);

    // **第三個參數是 env** —— handler 會讀 `c.env.PLACEHOLDER_EMAIL_DOMAIN`
    // 來判斷 email 是不是佔位信箱，裸 Hono 的 `c.env` 沒有值，不給就是 500
    const res = await app.request('/', {}, { PLACEHOLDER_EMAIL_DOMAIN: 'placeholder.invalid' });
    expect(res.status).toBe(200);

    return queries;
  }

  it('受限管理員：分校條件下到 enrollments，家長 id 條件下到 parents', async () => {
    const queries = await listParents(['campus-1']);

    // 第一跳：用他管的分校撈報名。**`classes.campus_id` 是巢狀欄位** ——
    // select 必須是無條件的 `classes!inner`，否則就是 #815 那個洞
    const enrollmentQuery = queries.find((q) => q.table === 'enrollments');
    expect(enrollmentQuery?.ins).toContainEqual({
      column: 'classes.campus_id',
      values: ['campus-1'],
    });
    expect(enrollmentQuery?.columns).toContain('classes!inner');

    // 最後一跳：家長清單真的被那組 id 縮限
    const listQuery = queries.find((q) => q.table === 'parents' && q.columns === '*');
    expect(listQuery?.ins.some((call) => call.column === 'id')).toBe(true);
  });

  it('不受分校限制時三跳都不做（確認上一條不是無腦通過）', async () => {
    const queries = await listParents(null);

    expect(queries.some((q) => q.table === 'enrollments')).toBe(false);
    const listQuery = queries.find((q) => q.table === 'parents' && q.columns === '*');
    expect(listQuery?.ins.some((call) => call.column === 'id')).toBe(false);
  });
});

/**
 * **#821：`GET /` 套了範圍（#816），其餘 8 個端點沒有。**
 *
 * `lib/campus-scope.ts` 的檔頭自己反對「一個守得住的畫面加其餘全部守不住的畫面」——
 * 那比全都不守更糟，它讓人相信系統有隔離。
 *
 * 越權回 **403**（計畫席裁定）：跟既有的 `campusRequestGuard` 一致，不另創 404 語意。
 * 「洩漏 id 存在」在這個 app 不成立 —— id 是 UUID，沒有列舉價值。
 */
describe('parents 的單筆端點 —— 越權回 403（#821）', () => {
  const OTHER_CAMPUS_PARENT = '99999999-9999-4999-8999-999999999999';

  /**
   * 替身按表回最小 fixture。關鍵是 **`parent_student_relations` 回空** ——
   * 也就是「受限管理員的分校裡沒有任何家長」，所以 `OTHER_CAMPUS_PARENT` 不在範圍內。
   */
  function fakeSupabase() {
    const builder: Record<string, unknown> = {};
    const chain = () => builder as never;
    Object.assign(builder, {
      select: () => chain(),
      eq: () => chain(),
      in: () => chain(),
      or: () => chain(),
      order: () => chain(),
      range: () => chain(),
      update: () => chain(),
      insert: () => chain(),
      ilike: () => chain(),
      single: () => Promise.resolve({ data: { id: OTHER_CAMPUS_PARENT }, error: null }),
      maybeSingle: () =>
        Promise.resolve({
          data: { id: OTHER_CAMPUS_PARENT, user_id: 'user-x', status: 'active' },
          error: null,
        }),
      then: (resolve: (value: { data: unknown[]; count: number; error: null }) => unknown) =>
        resolve({ data: [], count: 0, error: null }),
    });

    return { from: () => builder };
  }

  async function request(
    method: string,
    path: string,
    campusScope: readonly string[] | null,
    body?: unknown,
  ) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', fakeSupabase());
      set('orgId', 'org-1');
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('campusScope', campusScope);
      await next();
    });
    app.route('/', parentsRoute as unknown as Hono);

    return app.request(
      path,
      {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      },
      { PLACEHOLDER_EMAIL_DOMAIN: 'placeholder.invalid' },
    );
  }

  const endpoints: Array<{ name: string; method: string; path: string; body?: unknown }> = [
    { name: 'GET /{id}', method: 'GET', path: `/${OTHER_CAMPUS_PARENT}` },
    {
      name: 'PUT /{id}',
      method: 'PUT',
      path: `/${OTHER_CAMPUS_PARENT}`,
      body: { name: '改名', studentIds: [] },
    },
    { name: 'PATCH /{id}/activate', method: 'PATCH', path: `/${OTHER_CAMPUS_PARENT}/activate` },
    { name: 'PATCH /{id}/deactivate', method: 'PATCH', path: `/${OTHER_CAMPUS_PARENT}/deactivate` },
    { name: 'PATCH /{id}/archive', method: 'PATCH', path: `/${OTHER_CAMPUS_PARENT}/archive` },
  ];

  for (const ep of endpoints) {
    it(`${ep.name}：受限管理員打別校家長 → 403`, async () => {
      const res = await request(ep.method, ep.path, ['campus-1'], ep.body);

      expect(res.status).toBe(403);
    });

    // 反向對照：不受分校限制的管理員前後都進得去（403 不是無條件回的）
    it(`${ep.name}：不受分校限制時不擋`, async () => {
      const res = await request(ep.method, ep.path, null, ep.body);

      expect(res.status).not.toBe(403);
    });
  }
});

/**
 * **#821 的第 9 項：`POST /batch-import` 不只建立新家長。**
 *
 * 同名同聯絡時它會 **match 到既有家長**，然後在那個家長底下建學生
 * （`:1625` 起的重複學生檢查就是在既有家長底下做的）——
 * 所以受限管理員的匯入可以把學生掛到一位他看不到的別校家長底下。
 * **那是寫入越權，比讀取嚴重。**
 *
 * 處置：**該筆失敗，不是整批失敗**。批次匯入既有的語意是逐筆
 * `results.push({ status })`，整批擋掉會讓一個越權列把其餘合法的列關在外面。
 */
describe('POST /batch-import —— matched 到別校既有家長時該筆失敗（#821）', () => {
  const OTHER_PARENT = '88888888-8888-4888-8888-888888888888';

  /** 按表回 fixture：`ba_user` 有 match、`parents` 回既有家長，好走到 2b 那條路 */
  function fakeSupabase() {
    return {
      from(table: string) {
        const builder: Record<string, unknown> = {};
        const chain = () => builder as never;
        Object.assign(builder, {
          select: () => chain(),
          eq: () => chain(),
          in: () => chain(),
          or: () => chain(),
          order: () => chain(),
          range: () => chain(),
          limit: () => chain(),
          ilike: () => chain(),
          update: () => chain(),
          insert: () => chain(),
          upsert: () => chain(),
          delete: () => chain(),
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'parents' ? { id: OTHER_PARENT, name: '林小美', user_id: 'ba-1' } : null,
              error: null,
            }),
          single: () => Promise.resolve({ data: { id: OTHER_PARENT }, error: null }),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            resolve({
              // `ba_user` 用電話對到一個既有帳號 → 進 2b；其餘表回空
              data: table === 'ba_user' ? [{ id: 'ba-1', phone: '0912345678', email: null }] : [],
              error: null,
            }),
        });

        return builder;
      },
    };
  }

  async function importOne(campusScope: readonly string[] | null) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', fakeSupabase());
      set('orgId', 'org-1');
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('campusScope', campusScope);
      await next();
    });
    app.route('/', parentsRoute as unknown as Hono);

    const res = await app.request(
      '/batch-import',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rows: [
            {
              parentName: '林小美',
              parentPhone: '0912345678',
              studentName: '林小華',
              studentGrade: 'J1',
              studentSchool: '大安國中',
            },
          ],
        }),
      },
      { PLACEHOLDER_EMAIL_DOMAIN: 'placeholder.invalid' },
    );

    return (await res.json()) as {
      results?: Array<{ status: string; error?: string }>;
      data?: { results?: Array<{ status: string; error?: string }> };
    };
  }

  const resultsOf = (body: Awaited<ReturnType<typeof importOne>>) =>
    body.results ?? body.data?.results ?? [];

  it('受限管理員：matched 到範圍外的家長 → 該筆 failed，錯誤說得出原因', async () => {
    const results = resultsOf(await importOne(['campus-1']));

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toContain('不在你分校範圍內');
  });

  // 反向對照：不受分校限制時這條路不擋（failed 不是無條件回的）
  it('不受分校限制時同一筆不被這條守衛擋掉', async () => {
    const results = resultsOf(await importOne(null));

    expect(results.some((r) => r.error?.includes('不在你分校範圍內'))).toBe(false);
  });
});

/**
 * **#821 第 8 項（計畫席裁定 C 案）：`POST /batch-check` 套範圍，但警告不含姓名。**
 *
 * 它原本回「系統已有同名家長『X』」——**對受限管理員洩漏別校家長的姓名**。
 * 三個選項的權衡寫在 #821 的留言：
 *
 * - A 套範圍（警告整個消失）→ 跨分校重複家長變得**建得出來且零訊號**
 * - B 不套 → 就是 #816 認定的那種洩漏
 * - **C 套範圍 ＋ 不含姓名的警告** → 防重複與不洩漏都成立
 *
 * C 有兩半，兩半都要測：
 * 1. 範圍外的同名家長**不能當 mergeTarget** —— 否則 check 說「可以合併」而
 *    `batch-import` 會擋，**兩支端點對同一筆資料給出相反的答案**
 * 2. 那則警告**不含姓名**
 */
describe('POST /batch-check —— 範圍外的同名家長不具名、不可合併（#821 C 案）', () => {
  const OTHER_PARENT = '77777777-7777-4777-8777-777777777777';
  const OTHER_PARENT_NAME = '陳美玲';

  function fakeSupabase() {
    return {
      from(table: string) {
        const builder: Record<string, unknown> = {};
        const chain = () => builder as never;
        Object.assign(builder, {
          select: () => chain(),
          eq: () => chain(),
          in: () => chain(),
          or: () => chain(),
          order: () => chain(),
          limit: () => chain(),
          ilike: () => chain(),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            resolve({
              data:
                table === 'parents'
                  ? [{ id: OTHER_PARENT, name: OTHER_PARENT_NAME, user_id: 'ba-9' }]
                  : table === 'ba_user'
                    ? // 聯絡方式**相符** —— 所以在沒有範圍限制時這一筆是「可合併」
                      [{ id: 'ba-9', phone: '0955000111', email: null }]
                    : // `parent_student_relations` 回空有兩個作用：範圍查詢算出
                      // 「一個家長都不在範圍內」，而 Step 3.5 也沒有既有學生
                      [],
              error: null,
            }),
        });

        return builder;
      },
    };
  }

  async function check(campusScope: readonly string[] | null) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', fakeSupabase());
      set('orgId', 'org-1');
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('campusScope', campusScope);
      await next();
    });
    app.route('/', parentsRoute as unknown as Hono);

    const res = await app.request(
      '/batch-check',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rows: [
            {
              parentName: OTHER_PARENT_NAME,
              parentPhone: '0955000111',
              studentName: '陳小安',
              studentGrade: 'P5',
              studentSchool: '大安國小',
            },
          ],
        }),
      },
      { PLACEHOLDER_EMAIL_DOMAIN: 'placeholder.invalid' },
    );
    expect(res.status).toBe(200);

    return (await res.json()) as {
      warnings: Array<{ type: string; message: string }>;
      errors: Array<{ type: string; message: string }>;
    };
  }

  it('受限管理員：警告仍然出現（重複防得住），但不含那位家長的姓名', async () => {
    const body = await check(['campus-1']);

    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0].message).not.toContain(OTHER_PARENT_NAME);
    expect(body.warnings[0].message).toContain('請洽總管理者');
  });

  it('受限管理員：範圍外的同名家長不算「可合併」—— 否則跟 batch-import 的答案相反', async () => {
    const body = await check(['campus-1']);

    expect(body.warnings[0].type).toBe('same_name_exists');
    expect(body.warnings[0].type).not.toBe('merging_with_existing');
  });

  // 反向對照：不受分校限制時同一組資料是「可合併」且看得到姓名
  it('不受分校限制時照舊 —— 可合併，而且警告具名', async () => {
    const body = await check(null);

    expect(body.warnings[0].type).toBe('merging_with_existing');
  });
});
