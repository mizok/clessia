import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import notificationsRoute, { notificationRoleFor } from './notifications';

/**
 * #1688：通知中心的通知 —— 「一切都是自己的」。替身是**真的會套用過濾條件**的記憶體表，
 * 拿掉路由裡任何一個 `user_id`／`org_id` 條件，標到別人的那幾條就會紅。
 */

type Row = Record<string, unknown>;
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function memoryDb(rows: Row[]) {
  const table = structuredClone(rows);
  const from = () => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let opts: { count?: string; head?: boolean } = {};
    let limit = Infinity;
    let sort: { col: string; asc: boolean } | null = null;
    const match = () => {
      const hit = table.filter((r) => filters.every((f) => f(r)));
      if (!sort) return hit;
      const { col, asc } = sort;
      return [...hit].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    };
    const run = () => {
      const hit = match();
      if (patch) for (const r of hit) Object.assign(r, patch);
      const count = opts.count ? hit.length : null;
      const data = opts.head ? null : hit.slice(0, limit).map((r) => ({ ...r }));
      return { data, count, error: null };
    };
    const b: Record<string, unknown> = {
      select: (_cols: string, o?: { count?: string; head?: boolean }) => ((opts = o ?? {}), b),
      limit: (n: number) => ((limit = n), b),
      order: (col: string, o?: { ascending?: boolean }) => (
        (sort = { col, asc: o?.ascending ?? true }),
        b
      ),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
      update: (p: Row) => ((patch = p), b),
      maybeSingle: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, ng),
    };
    return b;
  };
  return { table, client: { from } };
}

const notification = (n: number, over: Row = {}): Row => ({
  id: ID(n),
  user_id: 'me',
  org_id: 'org-1',
  role: 'parent',
  kind: 'invoice_due',
  payload: { title: '繳費提醒', body: `王小明 的帳單 ${n}`, url: '/parent/payments' },
  created_at: `2026-10-1${n}T01:00:00Z`,
  read_at: null,
  ...over,
});

function app(
  db: ReturnType<typeof memoryDb>,
  who: { roles?: string[]; activeRole?: string | null } = {},
) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', 'org-1');
    set('userId', 'me');
    set('roles', who.roles ?? ['parent']);
    set('activeRole', who.activeRole === undefined ? 'parent' : who.activeRole);
    await next();
  });
  a.route('/', notificationsRoute as unknown as Hono);
  return (method: string, path: string) => a.request(path, { method });
}

describe('notificationRoleFor', () => {
  it('有 active role 用它；沒有時先老師後家長（跟公告的 audienceFor 同一條）', () => {
    expect(notificationRoleFor(['admin', 'parent'], 'parent')).toBe('parent');
    expect(notificationRoleFor(['teacher', 'parent'], null)).toBe('teacher');
    expect(notificationRoleFor(['parent'], null)).toBe('parent');
    expect(notificationRoleFor(['admin'], null)).toBe('admin');
    expect(notificationRoleFor([], null)).toBeNull();
  });
});

describe('GET /inbox（#1688）', () => {
  const others = [
    notification(1),
    notification(2, { read_at: '2026-10-12T02:00:00Z' }),
    notification(3, { user_id: 'someone-else' }),
    notification(4, { org_id: 'org-2' }),
    notification(5, { role: 'teacher' }),
  ];

  it('只回自己、這個 org、這個身分的；形狀對齊公告 inbox；未讀數', async () => {
    const res = await app(memoryDb(others))('GET', '/inbox');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }>; meta: unknown };
    // 新的在前：ID(2)（10-12）先於 ID(1)（10-11）
    expect(body.data.map((d) => d.id)).toEqual([ID(2), ID(1)]);
    expect(body.meta).toEqual({ total: 2, unread: 1 });
    expect(body.data[1]).toEqual({
      id: ID(1),
      kind: 'invoice_due',
      title: '繳費提醒',
      body: '王小明 的帳單 1',
      createdAt: '2026-10-11T01:00:00Z',
      isRead: false,
      link: '/parent/payments',
      hasChangeDetail: false,
    });
  });

  it('切到老師身分：看不到家長的繳費提醒（只看 role = teacher 的）', async () => {
    const res = await app(memoryDb(others), {
      roles: ['teacher', 'parent'],
      activeRole: 'teacher',
    })('GET', '/inbox');
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((d) => d.id)).toEqual([ID(5)]);
  });

  it('管理員身分：只看 role = admin 的（#1693：管理員有通知、不推播）；沒有就是 200 空清單', async () => {
    const res = await app(memoryDb([...others, notification(6, { role: 'admin' })]), {
      roles: ['admin', 'parent'],
      activeRole: 'admin',
    })('GET', '/inbox');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((d) => d.id)).toEqual([ID(6)]);
    const empty = await app(memoryDb(others), { roles: ['admin'], activeRole: 'admin' })(
      'GET',
      '/inbox',
    );
    expect(await empty.json()).toEqual({ data: [], meta: { total: 0, unread: 0 } });
  });
});

describe('GET /inbox 的上限（#1688，計畫席讀 diff）', () => {
  it('清單最多 100 則（新的在前）；total／unread 是 DB 數的全部，不是回傳的那幾列', async () => {
    // 105 則：最舊的 3 則已讀，其餘未讀
    const many = Array.from({ length: 105 }, (_, i) => ({
      ...notification(1),
      id: `n-${String(i).padStart(3, '0')}`,
      created_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(),
      read_at: i < 3 ? '2026-10-15T00:00:00Z' : null,
    }));
    const res = await app(memoryDb(many))('GET', '/inbox');
    const body = (await res.json()) as {
      data: Array<{ id: string }>;
      meta: { total: number; unread: number };
    };
    expect(body.data).toHaveLength(100);
    // 回來的是**最新的** 100 則、新的在前：n-104 … n-005；最舊的 5 則（n-000…n-004）不在清單裡
    expect(body.data[0]!.id).toBe('n-104');
    expect(body.data.at(-1)!.id).toBe('n-005');
    expect(body.meta).toEqual({ total: 105, unread: 102 });
  });
});

describe('POST /{id}/read（#1688）', () => {
  it('自己的 → 204，標上已讀', async () => {
    const db = memoryDb([notification(1)]);
    expect((await app(db)('POST', `/${ID(1)}/read`)).status).toBe(204);
    expect(db.table[0]!['read_at']).not.toBeNull();
  });

  it('別人的 → 404，對方那則還是未讀', async () => {
    const db = memoryDb([notification(1, { user_id: 'someone-else' })]);
    expect((await app(db)('POST', `/${ID(1)}/read`)).status).toBe(404);
    expect(db.table[0]!['read_at']).toBeNull();
  });

  it('別的 org 的 → 404，那則還是未讀', async () => {
    const db = memoryDb([notification(1, { org_id: 'org-2' })]);
    expect((await app(db)('POST', `/${ID(1)}/read`)).status).toBe(404);
    expect(db.table[0]!['read_at']).toBeNull();
  });

  it('本來就讀過 → 204，保留第一次讀的時間', async () => {
    const db = memoryDb([notification(1, { read_at: '2026-10-11T03:00:00Z' })]);
    expect((await app(db)('POST', `/${ID(1)}/read`)).status).toBe(204);
    expect(db.table[0]!['read_at']).toBe('2026-10-11T03:00:00Z');
  });
});

describe('POST /read-all（#1688）', () => {
  it('只標自己、這個 org、這個身分的未讀；別人的不動；回這次標了幾則', async () => {
    const db = memoryDb([
      notification(1),
      notification(2),
      notification(3, { read_at: '2026-10-11T03:00:00Z' }),
      notification(4, { user_id: 'someone-else' }),
      notification(5, { org_id: 'org-2' }),
      notification(6, { role: 'teacher' }),
    ]);
    const res = await app(db)('POST', '/read-all');
    expect(await res.json()).toEqual({ marked: 2 });
    const unread = db.table.filter((r) => r['read_at'] === null).map((r) => r['id']);
    expect(unread).toEqual([ID(4), ID(5), ID(6)]);
    expect(db.table[2]!['read_at']).toBe('2026-10-11T03:00:00Z');
  });

  it('管理員身分但沒有自己的通知：marked 0，別的身分的不動', async () => {
    const db = memoryDb([notification(1)]);
    const res = await app(db, { roles: ['admin'], activeRole: 'admin' })('POST', '/read-all');
    expect(await res.json()).toEqual({ marked: 0 });
    expect(db.table[0]!['read_at']).toBeNull();
  });
});
