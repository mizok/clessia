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
        maybeSingle: () =>
          Promise.resolve({ data: table === 'staff' ? { id: 'staff-1' } : null, error: null }),
        upsert: (rows: Array<Record<string, unknown>>) => {
          if (table === 'announcement_reads') upserted.push(...rows);
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

  return { app, filters, upserted };
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
