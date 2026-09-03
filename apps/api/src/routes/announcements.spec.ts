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
        order: () => query,
        maybeSingle: () =>
          Promise.resolve({ data: table === 'staff' ? { id: 'staff-1' } : null, error: null }),
        upsert: (rows: Array<Record<string, unknown>>) => {
          if (table === 'announcement_reads') upserted.push(...rows);
          return Promise.resolve({ error: null });
        },
        then: (onfulfilled?: ((value: { data: unknown[]; error: null }) => unknown) | null) => {
          const data =
            table === 'announcements'
              ? (options.announcements ?? [])
              : table === 'staff_campuses'
                ? (options.campusIds ?? []).map((campusId) => ({ campus_id: campusId }))
                : [];
          return Promise.resolve({ data, error: null }).then(onfulfilled ?? undefined);
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
