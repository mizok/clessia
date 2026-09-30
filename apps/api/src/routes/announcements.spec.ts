import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import announcementsApp from './announcements';

/**
 * 「全部標為已讀」的關鍵不是 upsert 本身，是**它涵蓋的範圍必須跟收件匣一模一樣**。
 *
 * 多標 → 標到看不見的公告，那些之後永遠不會再出現在他的未讀裡。
 * 少標 → 使用者按完紅點還在。
 * **兩種都不會報錯**，都要等有人抱怨才發現 —— 所以這裡守的是「下了哪些條件」。
 */
function createApp(options: {
  roles: string[];
  announcements?: Array<{ id: string }>;
  campusIds?: string[];
  /** 這個請求的分校範圍。null = 不受分校限制（多數測試的主題不是分校） */
  campusScope?: readonly string[] | null;
}) {
  const filters: Array<[string, unknown]> = [];
  const upserted: Array<Record<string, unknown>> = [];
  /** 每一次 `insert`，連同表名 —— #911 要斷言 `audit_logs` 真的多了（或沒多）一列 */
  const inserted: Array<{ table: string; row: unknown }> = [];

  const supabase = {
    from(table: string) {
      const query: Record<string, unknown> = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([`${table}.${column}`, value]);
          return query;
        },
        or: (condition: string) => {
          filters.push([`${table}.or`, condition]);
          return query;
        },
        // 記錄 `.in()` 是為了斷言**它沒有被用在 campus_id 上** ——
        // 見下方「公告不能用 .in 過濾分校」那組測試
        in: (column: string, values: readonly string[]) => {
          filters.push([`${table}.in.${column}`, [...values]]);
          return query;
        },
        order: () => query,
        // 發佈：`insert(...).select(SELECT).single()`；稽核：`await insert(row)`。
        // 兩種都要撐住 —— 所以 insert 回 query（可繼續鏈、也可 await）
        insert: (row: unknown) => {
          inserted.push({ table, row });
          return query;
        },
        single: () =>
          Promise.resolve({
            data: {
              id: 'ann-1',
              title: '颱風停課',
              body: '明天停課',
              audience: 'all_parents',
              campus_id: 'campus-1',
              published_at: '2026-09-30T00:00:00Z',
              campuses: { name: '中正分校' },
              creator: { name: '王主任' },
            },
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({ data: table === 'staff' ? { id: 'staff-1' } : null, error: null }),
        // 單則已讀傳物件、全部已讀傳陣列 —— 只收陣列的話單則那支會在這裡炸成 500，
        // 而「請求失敗所以沒有稽核」會讓 #911 的「不記」測試空轉變綠（突變驗證抓到的）
        upsert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
          if (table === 'announcement_reads') upserted.push(...[rows].flat());
          return Promise.resolve({ error: null });
        },
        then: (
          onfulfilled?:
            ((value: { data: unknown[]; error: null; count: number }) => unknown) | null,
        ) => {
          const data =
            table === 'announcements'
              ? (options.announcements ?? [])
              : table === 'staff_campuses'
                ? (options.campusIds ?? []).map((campusId) => ({ campus_id: campusId }))
                : [];
          return Promise.resolve({ data, error: null, count: data.length }).then(
            onfulfilled ?? undefined,
          );
        },
      };
      return query;
    },
  };

  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const context = c as unknown as { set: (key: string, value: unknown) => void };
    context.set('supabase', supabase);
    context.set('orgId', 'org-1');
    context.set('userId', 'user-1');
    context.set('roles', options.roles);
    context.set('campusScope', options.campusScope ?? null);
    await next();
  });
  app.route('/api/announcements', announcementsApp);

  return { app, filters, upserted, inserted };
}

async function readAll(options: Parameters<typeof createApp>[0]) {
  const { app, filters, upserted } = createApp(options);
  const response = await app.request('/api/announcements/read-all', { method: 'POST' });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
    filters,
    upserted,
  };
}

describe('POST /api/announcements/read-all', () => {
  it('把收件匣裡的每一則都標起來，一次 upsert', async () => {
    const { status, body, upserted } = await readAll({
      roles: ['teacher'],
      announcements: [{ id: 'a-1' }, { id: 'a-2' }],
    });

    expect(status).toBe(200);
    expect(body).toEqual({ marked: 2 });
    expect(upserted).toEqual([
      { announcement_id: 'a-1', user_id: 'user-1' },
      { announcement_id: 'a-2', user_id: 'user-1' },
    ]);
  });

  it('可見範圍與收件匣同源 —— audience 與分校條件都要下', async () => {
    const { filters } = await readAll({
      roles: ['teacher'],
      announcements: [{ id: 'a-1' }],
      campusIds: ['campus-1'],
    });

    // 少了 audience 會標到家長的公告；少了分校條件會標到別分校的
    expect(filters).toContainEqual(['announcements.audience', 'all_teachers']);
    expect(filters).toContainEqual([
      'announcements.or',
      'campus_id.is.null,campus_id.in.(campus-1)',
    ]);
  });

  it('沒有分校歸屬時只涵蓋全分校公告', async () => {
    const { filters } = await readAll({ roles: ['parent'], announcements: [{ id: 'a-1' }] });

    expect(filters).toContainEqual(['announcements.audience', 'all_parents']);
    expect(filters).toContainEqual(['announcements.or', 'campus_id.is.null']);
  });

  it('收件匣是空的就回 0，不打一支空的 upsert', async () => {
    const { body, upserted } = await readAll({ roles: ['teacher'], announcements: [] });

    expect(body).toEqual({ marked: 0 });
    expect(upserted).toEqual([]);
  });

  it('沒有收件角色 → 403，而且不碰任何資料', async () => {
    const { status, upserted } = await readAll({
      roles: ['admin'],
      announcements: [{ id: 'a-1' }],
    });

    expect(status).toBe(403);
    expect(upserted).toEqual([]);
  });
});

/**
 * 公告列表的分校範圍（#515 下半）。
 *
 * **這一支的守衛形狀跟其他路由不一樣，而那個不一樣正是重點。**
 * 其他列表用 `.in('campus_id', ids)`；公告**不能**，因為 `campus_id` 為 null
 * 代表「全分校公告」，`.in()` 會把它們一起排除掉 —— 受限的管理員就看不到
 * 全機構公告了（`announcements.ts:106-108` 的註解）。
 *
 * 所以這裡釘兩件事：**`.or()` 的條件字串長什麼樣**，以及 **`campus_id` 沒有被
 * 拿去 `.in()`**。後者是「有人為了跟其他路由統一而改成 `.in`」的反例 ——
 * 那個改動不會報錯，只會讓全分校公告從受限管理員的畫面上消失。
 */
describe('GET /api/announcements —— 分校範圍要用 or 不能用 in', () => {
  async function list(campusScope: readonly string[] | null) {
    const { app, filters } = createApp({ roles: ['admin'], campusScope });
    const response = await app.request('/api/announcements');
    expect(response.status).toBe(200);

    return filters;
  }

  it('受限管理員：條件是「全分校公告 OR 我的分校」', async () => {
    const filters = await list(['campus-1']);

    expect(filters).toContainEqual([
      'announcements.or',
      'campus_id.is.null,campus_id.in.(campus-1)',
    ]);
  });

  it('不能改用 .in(campus_id) —— 那會讓全分校公告消失', async () => {
    const filters = await list(['campus-1']);

    expect(filters.some(([key]) => key === 'announcements.in.campus_id')).toBe(false);
  });

  it('不受分校限制時不下這個條件（確認上一條不是無腦通過）', async () => {
    const filters = await list(null);

    expect(filters.some(([key]) => key === 'announcements.or')).toBe(false);
  });
});

/**
 * #911：公告的稽核**只記發佈**（使用者 2026-09-30 裁定）。
 *
 * 已讀兩支「不記」也寫成測試 —— 否則下一個人會以為是漏接而補上。不記的理由：
 * `announcement_reads` 本身就存了誰、哪一則、何時**第一次**讀（upsert 不覆寫 read_at），
 * 而且永久；audit_logs 90 天就被 cron 清掉，放進去只會把管理異動淹掉。
 *
 * ⚠️ 斷言的是 `audit_logs` 真的多了一列，不是 grep action 字串（#901 的教訓）。
 */
describe('公告的稽核（#911）', () => {
  const auditRows = (inserted: Array<{ table: string; row: unknown }>) =>
    inserted.filter((i) => i.table === 'audit_logs').map((i) => i.row);
  // logAudit 是 fire-and-forget + 兩層 await，不排空 microtask 會斷言在寫入之前
  const flush = () => new Promise((r) => setTimeout(r, 0));

  async function publish(campusScope: readonly string[] | null) {
    const { app, inserted } = createApp({ roles: ['admin'], campusScope });
    const res = await app.request('/api/announcements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '颱風停課',
        body: '明天停課',
        audience: 'all_parents',
        campusId: '00000000-0000-0000-0000-0000000000c1',
      }),
    });
    await flush();
    return { status: res.status, inserted };
  }

  it('發佈 → audit_logs 一列，記得住發給誰、哪個分校', async () => {
    const { status, inserted } = await publish(null);

    expect(status).toBe(201);
    expect(auditRows(inserted)).toEqual([
      expect.objectContaining({
        resource_type: 'announcement',
        resource_id: 'ann-1',
        resource_name: '颱風停課',
        action: 'announcement.publish',
        details: {
          audience: 'all_parents',
          campusId: '00000000-0000-0000-0000-0000000000c1',
        },
      }),
    ]);
  });

  // 分校越權在最前面就 403，什麼都沒寫，所以也不該有稽核
  it('發佈被 403（對自己不管的分校發）→ 不記', async () => {
    const { status, inserted } = await publish(['00000000-0000-0000-0000-0000000000c9']);

    expect(status).toBe(403);
    expect(auditRows(inserted)).toEqual([]);
  });

  it('標記已讀 → 不記（刻意的，見上）', async () => {
    const { app, inserted, upserted } = createApp({ roles: ['parent'] });
    const res = await app.request('/api/announcements/00000000-0000-0000-0000-00000000a001/read', {
      method: 'POST',
    });
    await flush();

    // 確認真的走到寫入那一步 —— 否則「沒有稽核」只是因為請求在前面就被擋掉了
    expect(res.status).toBe(204);
    expect(upserted).toHaveLength(1);
    expect(auditRows(inserted)).toEqual([]);
  });

  it('全部已讀 → 不記（刻意的，見上）', async () => {
    const { app, inserted, upserted } = createApp({
      roles: ['parent'],
      announcements: [{ id: 'a1' }, { id: 'a2' }],
    });
    await app.request('/api/announcements/read-all', { method: 'POST' });
    await flush();

    expect(upserted).toHaveLength(2); // 確認真的走到寫入那一步，不是提早返回
    expect(auditRows(inserted)).toEqual([]);
  });
});
