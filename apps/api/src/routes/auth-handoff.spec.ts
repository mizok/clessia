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
  MAX_PAIR_ATTEMPTS,
  MAX_PENDING_HANDOFFS,
  MAX_PENDING_PER_SOURCE,
  handoffCompleteRoute,
  pairCodeHash,
  publicHandoffRoute,
  sha256Hex,
} from './auth-handoff';
import { hashClientIp } from './public/application-common';

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

const ENV = { BETTER_AUTH_SECRET: 'test-secret' };

/** `sessionAt`：這個 session 建立的時間（預設「剛剛」＝晚於任何 fixture 的交接） */
function app(
  db: ReturnType<typeof seed>,
  userId: string | null = null,
  sessionAt = new Date().toISOString(),
) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    if (userId) {
      set('userId', userId);
      set('sessionCreatedAt', sessionAt);
    }
    await next();
  });
  a.route('/', publicHandoffRoute as unknown as Hono);
  a.route('/', handoffCompleteRoute as unknown as Hono);
  return a;
}

const post = (a: Hono, path: string, body?: unknown, ip = '203.0.113.7') =>
  a.request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    ENV,
  );

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

  it('回 4 位數配對碼（不進 URL）；DB 只存綁 id 的雜湊、存發起 IP 的 HMAC（不是 IP 本身）', async () => {
    const db = seed();
    const body = (await (await post(app(db), '/start')).json()) as {
      handoffId: string;
      pairCode: string;
    };
    expect(body.pairCode).toMatch(/^\d{4}$/);
    const row = db.rows('auth_handoffs')[0]!;
    expect(row['pair_code_hash']).toBe(await pairCodeHash(body.handoffId, body.pairCode));
    expect(row['ip_hash']).toBe(await hashClientIp('203.0.113.7', ENV.BETTER_AUTH_SECRET));
    expect(JSON.stringify(row)).not.toContain('203.0.113.7');
  });

  it('同一個來源同時進行的交接到上限 → 429；別的來源照常', async () => {
    const db = seed();
    const a = app(db);
    for (let i = 0; i < MAX_PENDING_PER_SOURCE; i++)
      expect((await post(a, '/start')).status).toBe(200);
    expect((await post(a, '/start')).status).toBe(429);
    expect((await post(a, '/start', undefined, '198.51.100.9')).status).toBe(200);
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

describe('POST /{id}/complete（要登入；防交接劫持）', () => {
  const CODE = '0427';
  const CREATED = '2026-10-28T01:00:00.000Z';
  async function pending(over: Record<string, unknown> = {}) {
    return {
      id: id(1),
      secret_hash: 'h',
      pair_code_hash: await pairCodeHash(id(1), CODE),
      failed_attempts: 0,
      user_id: null,
      created_at: CREATED,
      expires_at: future(),
      ...over,
    };
  }
  const AFTER = '2026-10-28T01:01:00.000Z';
  const complete = (a: Hono, code: string, hid = id(1)) =>
    post(a, `/${hid}/complete`, { pairCode: code });

  it('session 晚於交接、配對碼對 → 標成目前登入的人', async () => {
    const db = seed([await pending()]);
    expect((await complete(app(db, 'u-parent', AFTER), CODE)).status).toBe(204);
    expect(db.rows('auth_handoffs')[0]).toMatchObject({ user_id: 'u-parent' });
  });

  it('**劫持**：受害者早就登入著（session 早於交接）、點別人傳來的連結 → 404，就算碼對也不標', async () => {
    const db = seed([await pending()]);
    const res = await complete(app(db, 'u-victim', '2026-10-27T09:00:00.000Z'), CODE);
    expect(res.status).toBe(404);
    expect(db.rows('auth_handoffs')[0]).toMatchObject({ user_id: null });
  });

  it('配對碼不對 → 400 剩幾次；錯滿 5 次就失效，之後連對的碼也 404', async () => {
    const db = seed([await pending()]);
    const a = app(db, 'u-parent', AFTER);
    for (let left = MAX_PAIR_ATTEMPTS - 1; left > 0; left--) {
      const res = await complete(a, '9999');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'PAIR_CODE_MISMATCH', attemptsLeft: left });
    }
    expect((await complete(a, '9999')).status).toBe(404);
    expect((await complete(a, CODE)).status).toBe(404);
    expect(db.rows('auth_handoffs')[0]).toMatchObject({ user_id: null, failed_attempts: 5 });
  });

  it('已經錯滿 5 次（DB 記著）→ 就算碼對也 404、不標', async () => {
    const db = seed([await pending({ failed_attempts: MAX_PAIR_ATTEMPTS })]);
    expect((await complete(app(db, 'u-parent', AFTER), CODE)).status).toBe(404);
    expect(db.rows('auth_handoffs')[0]).toMatchObject({ user_id: null });
  });

  it('**並發**猜錯：10 個同時送，每一個都算次數 —— 只有 4 個拿到 400，其餘 404，次數停在 5', async () => {
    const db = seed([await pending()]);
    const a = app(db, 'u-parent', AFTER);
    const statuses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => complete(a, String(1000 + i))),
    ).then((rs) => rs.map((r) => r.status));
    expect(statuses.filter((x) => x === 400)).toHaveLength(MAX_PAIR_ATTEMPTS - 1);
    expect(statuses.filter((x) => x === 404)).toHaveLength(10 - (MAX_PAIR_ATTEMPTS - 1));
    expect(db.rows('auth_handoffs')[0]).toMatchObject({ user_id: null, failed_attempts: 5 });
    expect((await complete(a, CODE)).status).toBe(404);
  });

  it('並發裡夾著對的碼：最多猜 5 次 —— 對的碼排在第 6 個以後就拿不到', async () => {
    const db = seed([await pending()]);
    const a = app(db, 'u-parent', AFTER);
    const codes = [...Array.from({ length: 9 }, (_, i) => String(1000 + i)), CODE];
    const statuses = await Promise.all(codes.map((code) => complete(a, code))).then((rs) =>
      rs.map((r) => r.status),
    );
    expect(statuses.filter((x) => x !== 404).length).toBeLessThanOrEqual(MAX_PAIR_ATTEMPTS);
    expect(statuses.at(-1)).toBe(404);
    expect(db.rows('auth_handoffs')[0]).toMatchObject({ user_id: null });
  });

  it('沒帶配對碼或格式不對 → 400（zod），不標', async () => {
    const db = seed([await pending()]);
    const a = app(db, 'u-parent', AFTER);
    expect((await post(a, `/${id(1)}/complete`, {})).status).toBe(400);
    expect((await complete(a, '12a4')).status).toBe(400);
    expect(db.rows('auth_handoffs')[0]).toMatchObject({ user_id: null, failed_attempts: 0 });
  });

  it('同一組碼在別的交接上不成立（雜湊綁 id）', async () => {
    const db = seed([
      await pending({ id: id(2), pair_code_hash: await pairCodeHash(id(1), CODE) }),
    ]);
    expect((await complete(app(db, 'u-parent', AFTER), CODE, id(2))).status).toBe(400);
  });

  it('已被標過、過期、不存在 → 404，原本的人不被換掉', async () => {
    const db = seed([
      await pending({ user_id: 'u-first', completed_at: past() }),
      await pending({
        id: id(2),
        pair_code_hash: await pairCodeHash(id(2), CODE),
        expires_at: past(),
      }),
    ]);
    const a = app(db, 'u-attacker', AFTER);
    expect((await complete(a, CODE)).status).toBe(404);
    expect((await complete(a, CODE, id(2))).status).toBe(404);
    expect((await complete(a, CODE, id(3))).status).toBe(404);
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
