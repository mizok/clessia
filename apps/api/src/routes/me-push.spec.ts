import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { isAllowedPushEndpoint } from '../lib/push-endpoint';
import mePushRoute from './me-push';

/**
 * #1659：推播訂閱與偏好 —— 「一切都是自己的」。替身是一個**真的會套用過濾條件**的記憶體表，
 * 所以拿掉路由裡任何一個 `.eq('user_id', …)`，刪別人／讀別人的那幾條就會紅。
 */

type Row = Record<string, unknown>;

function memoryDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    push_subscriptions: [],
    notification_preferences: [],
    ...structuredClone(seed),
  };
  let seq = 0;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: 'select' } | { kind: 'delete' } | { kind: 'upsert'; out: Row[] } = {
      kind: 'select',
    };
    const match = () => rows.filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (op.kind === 'delete') {
        const hit = match();
        tables[table] = rows.filter((r) => !hit.includes(r));
        return { data: hit, error: null };
      }
      if (op.kind === 'upsert') return { data: op.out, error: null };
      return { data: match(), error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      order: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
      delete: () => ((op = { kind: 'delete' }), b),
      upsert: (input: Row | Row[], opts: { onConflict: string }) => {
        const keys = opts.onConflict.split(',');
        const out = (Array.isArray(input) ? input : [input]).map((row) => {
          const existing = rows.find((r) => keys.every((k) => r[k] === row[k]));
          if (existing) return Object.assign(existing, row);
          const added = { id: `id-${++seq}`, created_at: '2026-10-16T00:00:00Z', ...row };
          rows.push(added);
          return added;
        });
        op = { kind: 'upsert', out };
        return b;
      },
      single: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, ng),
    };
    return b;
  };
  return { tables, client: { from } };
}

const FCM = 'https://fcm.googleapis.com/fcm/send/abc';
const KEYS = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

function app(
  db: ReturnType<typeof memoryDb>,
  who: { userId?: string; roles?: string[] } = {},
  env: Record<string, string> = { VAPID_PUBLIC_KEY: 'BPUB' },
) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', 'org-1');
    set('userId', who.userId ?? 'me');
    set('roles', who.roles ?? ['parent']);
    await next();
  });
  a.route('/', mePushRoute as unknown as Hono);
  return (method: string, path: string, body?: unknown) =>
    a.request(
      path,
      {
        method,
        ...(body
          ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
          : {}),
      },
      env,
    );
}

describe('isAllowedPushEndpoint', () => {
  it.each([
    [FCM, true],
    ['https://updates.push.services.mozilla.com/wpush/v2/x', true],
    ['https://web.push.apple.com/abc', true],
    ['https://db5p.notify.windows.com/w/?token=x', true],
    ['http://fcm.googleapis.com/fcm/send/abc', false], // 不是 https
    ['https://evil.example.com/fcm.googleapis.com', false],
    ['https://fcm.googleapis.com.evil.example.com/x', false],
    ['https://evil.com/?x=fcm.googleapis.com', false], // 網域藏在 query 裡
    ['https://x.fcm.googleapis.com/fcm/send/abc', false], // 逐字比對，不收子網域
    ['https://push.apple.com/abc', false], // 後綴要以「.」接，裸網域不算
    ['https://api.push.apple.com/abc', true], // WebKit 官方範圍 *.push.apple.com
    ['https://evilpush.apple.com/abc', false],
    ['https://evilnotify.windows.com/x', false], // WNS 後綴要以「.」接
    ['https://user:pw@fcm.googleapis.com/x', false], // 帶帳密
    ['not a url', false],
  ])('%s → %s', (url, ok) => expect(isAllowedPushEndpoint(url)).toBe(ok));
});

describe('GET /push-config', () => {
  it('有設公鑰 → 回公鑰；沒設 → 404 PUSH_NOT_CONFIGURED', async () => {
    const on = await app(memoryDb())('GET', '/push-config');
    expect(await on.json()).toEqual({ publicKey: 'BPUB' });
    const off = await app(memoryDb(), {}, {})('GET', '/push-config');
    expect(off.status).toBe(404);
    expect(await off.json()).toMatchObject({ code: 'PUSH_NOT_CONFIGURED' });
  });
});

describe('POST /push-subscriptions', () => {
  it('user_id／org_id 取自 session，body 帶的被忽略；存當下的公鑰', async () => {
    const db = memoryDb();
    const res = await app(db)('POST', '/push-subscriptions', {
      endpoint: FCM,
      keys: KEYS,
      user_id: 'someone-else',
      org_id: 'org-2',
    });
    expect(res.status).toBe(200);
    expect(db.tables['push_subscriptions']).toEqual([
      expect.objectContaining({
        user_id: 'me',
        org_id: 'org-1',
        endpoint: FCM,
        vapid_public_key: 'BPUB',
      }),
    ]);
  });

  it('同一台裝置換人登入 → 改綁成現在的人，不會兩列；上一個人的成功紀錄清掉', async () => {
    const db = memoryDb({
      push_subscriptions: [
        { id: 's1', user_id: 'prev', org_id: 'org-1', endpoint: FCM, last_success_at: 'x' },
      ],
    });
    await app(db)('POST', '/push-subscriptions', { endpoint: FCM, keys: KEYS });
    expect(db.tables['push_subscriptions']).toHaveLength(1);
    expect(db.tables['push_subscriptions']![0]).toMatchObject({
      user_id: 'me',
      last_success_at: null,
    });
  });

  it('不在白名單的 endpoint → 400，什麼都沒寫', async () => {
    const db = memoryDb();
    const res = await app(db)('POST', '/push-subscriptions', {
      endpoint: 'https://evil.example.com/x',
      keys: KEYS,
    });
    expect(res.status).toBe(400);
    expect(db.tables['push_subscriptions']).toEqual([]);
  });

  it('金鑰格式不對 → 400', async () => {
    const res = await app(memoryDb())('POST', '/push-subscriptions', {
      endpoint: FCM,
      keys: { p256dh: 'xyz', auth: KEYS.auth },
    });
    expect(res.status).toBe(400);
  });

  it('推播沒開 → 404，什麼都沒寫', async () => {
    const db = memoryDb();
    const res = await app(db, {}, {})('POST', '/push-subscriptions', { endpoint: FCM, keys: KEYS });
    expect(res.status).toBe(404);
    expect(db.tables['push_subscriptions']).toEqual([]);
  });
});

describe('裝置列表與取消', () => {
  const seed = () =>
    memoryDb({
      push_subscriptions: [
        { id: 'mine', user_id: 'me', org_id: 'org-1', endpoint: FCM, created_at: 'a' },
        { id: 'theirs', user_id: 'other', org_id: 'org-1', endpoint: `${FCM}2`, created_at: 'b' },
      ],
    });

  it('GET 只列自己的', async () => {
    const res = await app(seed())('GET', '/push-subscriptions');
    expect(((await res.json()) as { data: Array<{ id: string }> }).data.map((d) => d.id)).toEqual([
      'mine',
    ]);
  });

  it('DELETE（endpoint）刪不到別人的：回 deleted 0，對方那列還在', async () => {
    const db = seed();
    const res = await app(db)('DELETE', '/push-subscriptions', { endpoint: `${FCM}2` });
    expect(await res.json()).toEqual({ deleted: 0 });
    expect(db.tables['push_subscriptions']!.map((r) => r['id'])).toEqual(['mine', 'theirs']);
  });

  it('DELETE（endpoint）刪自己的', async () => {
    const db = seed();
    const res = await app(db)('DELETE', '/push-subscriptions', { endpoint: FCM });
    expect(await res.json()).toEqual({ deleted: 1 });
    expect(db.tables['push_subscriptions']!.map((r) => r['id'])).toEqual(['theirs']);
  });

  it('DELETE /:id 別人的 → 404，對方那列還在', async () => {
    const db = memoryDb({
      push_subscriptions: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          user_id: 'other',
          org_id: 'org-1',
          endpoint: FCM,
        },
      ],
    });
    const res = await app(db)('DELETE', '/push-subscriptions/00000000-0000-4000-8000-000000000002');
    expect(res.status).toBe(404);
    expect(db.tables['push_subscriptions']).toHaveLength(1);
  });
});

describe('通知偏好', () => {
  it('沒有列 = 全開；只讀自己這個身分的', async () => {
    const db = memoryDb({
      notification_preferences: [
        { user_id: 'me', org_id: 'org-1', role: 'parent', kind: 'invoice_due', enabled: false },
        {
          user_id: 'other',
          org_id: 'org-1',
          role: 'parent',
          kind: 'invoice_overdue',
          enabled: false,
        },
      ],
    });
    const res = await app(db)('GET', '/notification-preferences?role=parent');
    expect(await res.json()).toEqual({
      role: 'parent',
      preferences: [
        { kind: 'invoice_due', enabled: false },
        { kind: 'invoice_overdue', enabled: true },
      ],
    });
  });

  it('PUT 寫進自己（session）的 user_id、org_id', async () => {
    const db = memoryDb();
    const res = await app(db)('PUT', '/notification-preferences', {
      role: 'parent',
      preferences: [{ kind: 'invoice_overdue', enabled: false }],
    });
    expect(res.status).toBe(200);
    expect(db.tables['notification_preferences']).toEqual([
      expect.objectContaining({
        user_id: 'me',
        org_id: 'org-1',
        role: 'parent',
        kind: 'invoice_overdue',
        enabled: false,
      }),
    ]);
  });

  it('沒有 parent 身分 → 403，什麼都沒寫', async () => {
    const db = memoryDb();
    const put = await app(db, { roles: ['teacher'] })('PUT', '/notification-preferences', {
      role: 'parent',
      preferences: [{ kind: 'invoice_due', enabled: false }],
    });
    expect(put.status).toBe(403);
    expect(db.tables['notification_preferences']).toEqual([]);
    const get = await app(db, { roles: ['teacher'] })(
      'GET',
      '/notification-preferences?role=parent',
    );
    expect(get.status).toBe(403);
  });

  it('第一版只開家長：role=teacher → 400（即使本人是老師）', async () => {
    const res = await app(memoryDb(), { roles: ['teacher'] })(
      'GET',
      '/notification-preferences?role=teacher',
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'ROLE_NOT_SUPPORTED' });
  });
});
