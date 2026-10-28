import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const minted: string[] = [];
vi.mock('./login-links/mint', () => ({
  mintLoginLinkForRequest: async (_c: unknown, email: string) => {
    minted.push(email);
    return email === 'broken@x' ? null : `https://app/verify?token=for-${email}`;
  },
}));

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import {
  MAX_PENDING_HANDOFFS,
  handoffCompleteRoute,
  publicHandoffRoute,
  sha256Hex,
} from './auth-handoff';

/**
 * #2027 iOS PWA 外部登入交接。真的會套條件的記憶體 DB：拿掉 secret／過期／一次性任何一個條件就會紅。
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const future = () => new Date(Date.now() + 5 * 60_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

function seed(handoffs: Record<string, unknown>[] = []) {
  return createMultiOrgDb({
    auth_handoffs: handoffs,
    ba_user: [
      { id: 'u-parent', email: 'parent@line.internal' },
      { id: 'u-broken', email: 'broken@x' },
    ],
  });
}

function app(db: ReturnType<typeof seed>, userId: string | null = null) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    if (userId) set('userId', userId);
    await next();
  });
  a.route('/', publicHandoffRoute as unknown as Hono);
  a.route('/', handoffCompleteRoute as unknown as Hono);
  return a;
}

const post = (a: Hono, path: string, body?: unknown) =>
  a.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  minted.length = 0;
});

describe('POST /start', () => {
  it('回 handoffId＋secret；DB 只存 secret 的雜湊、10 分鐘後過期；順手清掉過期的', async () => {
    const db = seed([{ id: id(1), secret_hash: 'old', user_id: null, expires_at: past() }]);
    const res = await post(app(db), '/start');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      handoffId: string;
      secret: string;
      expiresInSeconds: number;
    };
    expect(body.secret.length).toBeGreaterThanOrEqual(43);
    expect(body.expiresInSeconds).toBe(600);
    const rows = db.rows('auth_handoffs');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: body.handoffId,
      secret_hash: await sha256Hex(body.secret),
    });
    expect(JSON.stringify(rows)).not.toContain(body.secret);
    const ttl = Date.parse(rows[0]!['expires_at'] as string) - Date.now();
    expect(ttl).toBeGreaterThan(590_000);
    expect(ttl).toBeLessThanOrEqual(600_000);
  });

  it('未過期的已經到上限 → 429，不再建', async () => {
    const db = seed(
      Array.from({ length: MAX_PENDING_HANDOFFS }, (_, i) => ({
        id: id(100 + i),
        secret_hash: 'h',
        user_id: null,
        expires_at: future(),
      })),
    );
    const res = await post(app(db), '/start');
    expect(res.status).toBe(429);
    expect(db.rows('auth_handoffs')).toHaveLength(MAX_PENDING_HANDOFFS);
  });
});

describe('POST /{id}/complete（要登入）', () => {
  it('標成目前登入的人', async () => {
    const db = seed([{ id: id(1), secret_hash: 'h', user_id: null, expires_at: future() }]);
    expect((await post(app(db, 'u-parent'), `/${id(1)}/complete`)).status).toBe(204);
    expect(db.rows('auth_handoffs')[0]).toMatchObject({ user_id: 'u-parent' });
  });

  it('已被標過、過期、不存在 → 404，原本的人不被換掉', async () => {
    const db = seed([
      {
        id: id(1),
        secret_hash: 'h',
        user_id: 'u-first',
        completed_at: past(),
        expires_at: future(),
      },
      { id: id(2), secret_hash: 'h', user_id: null, expires_at: past() },
    ]);
    const a = app(db, 'u-attacker');
    expect((await post(a, `/${id(1)}/complete`)).status).toBe(404);
    expect((await post(a, `/${id(2)}/complete`)).status).toBe(404);
    expect((await post(a, `/${id(3)}/complete`)).status).toBe(404);
    expect(db.rows('auth_handoffs')[0]).toMatchObject({ user_id: 'u-first' });
    expect(db.rows('auth_handoffs')[1]).toMatchObject({ user_id: null });
  });
});

describe('POST /{id}/redeem', () => {
  const SECRET = 'the-secret';
  async function rowWith(over: Record<string, unknown>) {
    return {
      id: id(1),
      secret_hash: await sha256Hex(SECRET),
      user_id: null,
      expires_at: future(),
      ...over,
    };
  }

  it('還沒完成 → 202 pending，列還在', async () => {
    const db = seed([await rowWith({})]);
    const res = await post(app(db), `/${id(1)}/redeem`, { secret: SECRET });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'pending' });
    expect(db.rows('auth_handoffs')).toHaveLength(1);
  });

  it('還沒完成但 secret 不對 → 404（不洩漏「還在等」）', async () => {
    const db = seed([await rowWith({})]);
    expect((await post(app(db), `/${id(1)}/redeem`, { secret: 'wrong' })).status).toBe(404);
  });

  it('完成了 → 換到那個人的一次性連結，交接刪掉；再換一次 404', async () => {
    const db = seed([await rowWith({ user_id: 'u-parent', completed_at: past() })]);
    const res = await post(app(db), `/${id(1)}/redeem`, { secret: SECRET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://app/verify?token=for-parent@line.internal' });
    expect(minted).toEqual(['parent@line.internal']);
    expect(db.rows('auth_handoffs')).toHaveLength(0);
    expect((await post(app(db), `/${id(1)}/redeem`, { secret: SECRET })).status).toBe(404);
  });

  it('secret 不對、過期、不存在 → 一律 404 同一句話，不鑄連結、不刪列', async () => {
    const db = seed([
      await rowWith({ user_id: 'u-parent', completed_at: past() }),
      await rowWith({ id: id(2), user_id: 'u-parent', completed_at: past(), expires_at: past() }),
    ]);
    const bodies: unknown[] = [];
    for (const [hid, secret] of [
      [id(1), 'wrong'],
      [id(2), SECRET],
      [id(3), SECRET],
    ]) {
      const res = await post(app(db), `/${hid}/redeem`, { secret });
      expect(res.status).toBe(404);
      bodies.push(await res.json());
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(minted).toEqual([]);
    expect(db.rows('auth_handoffs')).toHaveLength(2);
  });

  it('鑄連結失敗 → 500（不能說成成功）', async () => {
    const db = seed([await rowWith({ user_id: 'u-broken', completed_at: past() })]);
    expect((await post(app(db), `/${id(1)}/redeem`, { secret: SECRET })).status).toBe(500);
  });
});
