import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { reminderPayload, runPush } from './push-run';
import { toB64u } from './web-push';

/**
 * #1661 送出那一段的形狀：預算、404／410 清訂閱、白名單再驗、VAPID 每個服務簽一次、鎖不到就跳過。
 * 排入的 SQL 語意（收件人、偏好、去重）在 `contract/push-run.contract.ts` 對真 Postgres 驗。
 */

// RFC 8291 的收件端公鑰 —— 加密要一把合法的 P-256 點
const P256DH =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';

async function vapid() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as CryptoKeyPair;
  const publicKey = toB64u(
    new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
  );
  const { d } = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey, privateKey: d! };
}

type Row = Record<string, unknown>;
const sub = (
  deliveryId: string,
  subId: string | null,
  endpoint = 'https://fcm.googleapis.com/x',
) => ({
  id: deliveryId,
  payload: { title: 't', body: 'b', url: '/parent/payments', topic: 'abc' },
  sub_id: subId,
  endpoint: subId ? `${endpoint}/${subId}` : null,
  p256dh: subId ? P256DH : null,
  auth: subId ? AUTH : null,
});

function fakePool(pending: Row[]) {
  const sent: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      sent.push({ sql, params });
      if (/FROM organizations org/.test(sql)) return { rows: [], rowCount: 0 }; // 沒有要排入的
      if (/LEFT JOIN push_subscriptions/.test(sql))
        return { rows: pending, rowCount: pending.length };
      return { rows: [], rowCount: 0 };
    },
    release: vi.fn(),
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const find = (re: RegExp) => sent.filter((q) => re.test(q.sql));
  return { pool, sent, find };
}

async function run(pending: Row[], status: (url: string) => number, batchSize = 10) {
  const db = fakePool(pending);
  const urls: string[] = [];
  const auths: string[] = [];
  const signals: unknown[] = [];
  const result = await runPush(db.pool, {
    today: '2026-10-16',
    batchSize,
    vapid: await vapid(),
    subject: 'mailto:ops@example.com',
    send: async (url, init) => {
      db.sent.push({ sql: `SEND ${url}` });
      signals.push(init.signal);
      urls.push(url);
      auths.push((init.headers as Record<string, string>)['Authorization']!);
      return { status: status(url) };
    },
  });
  return { result, urls, auths, signals, ...db };
}

describe('runPush —— 送出（#1661）', () => {
  it('成功的：認領時記 sent_at，回寫更新 last_success_at；COMMIT', async () => {
    const { result, find, sent } = await run([sub('d1', 's1')], () => 201);
    expect(result).toMatchObject({ attempted: 1, delivered: 1, removedSubscriptions: 0 });
    expect(find(/SET sent_at = now\(\)/)[0]!.params).toEqual([['d1']]);
    expect(find(/last_error = NULL/)[0]!.params).toEqual([['d1']]);
    expect(find(/SET last_success_at = now\(\)/)[0]!.params).toEqual([['s1']]);
    expect(sent.at(-1)!.sql).toBe('COMMIT');
  });

  it('404 與 410 都刪訂閱；那則記失敗，下一輪重試', async () => {
    const { result, find } = await run([sub('d1', 's1'), sub('d1', 's2')], (u) =>
      u.endsWith('s1') ? 404 : 410,
    );
    expect(result).toMatchObject({ delivered: 0, removedSubscriptions: 2 });
    expect(find(/DELETE FROM push_subscriptions/)[0]!.params).toEqual([['s1', 's2']]);
    expect(find(/last_error = x.err/)[0]!.params).toEqual([['d1'], ['HTTP 404, HTTP 410']]);
  });

  it('一台成功一台 500：算送達，不重送', async () => {
    const { result, find } = await run([sub('d1', 's1'), sub('d1', 's2')], (u) =>
      u.endsWith('s1') ? 201 : 500,
    );
    expect(result).toMatchObject({ delivered: 1 });
    expect(find(/last_error = x.err/)).toEqual([]);
  });

  it('DB 裡存的 endpoint 不在白名單：不送、刪掉那個訂閱', async () => {
    const { urls, find } = await run([sub('d1', 's1', 'https://evil.example.com/x')], () => 201);
    expect(urls).toEqual([]);
    expect(find(/DELETE FROM push_subscriptions/)[0]!.params).toEqual([['s1']]);
    expect(find(/last_error = x.err/)[0]!.params).toEqual([['d1'], ['ENDPOINT_NOT_ALLOWED']]);
  });

  it('排入後訂閱被刪光：不送，標 NO_SUBSCRIPTION 不再重試', async () => {
    const { urls, find } = await run([sub('d1', null)], () => 201);
    expect(urls).toEqual([]);
    expect(find(/NO_SUBSCRIPTION/)[0]!.params).toEqual([['d1'], 3]);
  });

  it('裝置數用完就停，一則不拆兩次 run', async () => {
    const pending = [
      sub('d1', 'a'),
      sub('d1', 'b'),
      sub('d2', 'c'),
      sub('d2', 'd'),
      sub('d3', 'e'),
    ];
    const { urls } = await run(pending, () => 201, 3);
    expect(urls.map((u) => u.split('/').at(-1))).toEqual(['a', 'b']);
  });

  it('同一個推播服務只簽一次 VAPID', async () => {
    const pending = [
      sub('d1', 'a'),
      sub('d2', 'b'),
      sub('d3', 'c', 'https://web.push.apple.com/x'),
    ];
    const { auths } = await run(pending, () => 201);
    expect(new Set(auths).size).toBe(2);
  });

  it('送出時網路錯誤 → 記失敗，不讓整個 run 掛掉', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = fakePool([sub('d1', 's1')]);
    const result = await runPush(db.pool, {
      today: '2026-10-16',
      batchSize: 10,
      vapid: await vapid(),
      subject: 'mailto:x@example.com',
      send: async () => {
        throw new Error('network');
      },
    });
    expect(result).toMatchObject({ delivered: 0 });
    expect(db.find(/last_error = x.err/)[0]!.params).toEqual([['d1'], ['HTTP 0']]);
  });

  it('送出期間沒有交易開著：認領 COMMIT 之後才送，送完才開回寫的交易', async () => {
    const { sent } = await run([sub('d1', 's1'), sub('d2', 's2')], () => 201);
    const order = sent.map((q) => q.sql.split(/\s+/)[0]);
    const firstSend = order.indexOf('SEND');
    const lastSend = order.lastIndexOf('SEND');
    expect(order.slice(0, firstSend).at(-1)).toBe('COMMIT');
    expect(order[lastSend + 1]).toBe('BEGIN');
    expect(order.filter((o) => o === 'BEGIN')).toHaveLength(2);
  });

  it('認領用 FOR UPDATE SKIP LOCKED＋sent_at 記號：同時跑的另一個 run 拿不到同一則', async () => {
    const { find } = await run([sub('d1', 's1')], () => 201);
    expect(find(/FOR UPDATE SKIP LOCKED/)).toHaveLength(1);
    expect(find(/SET sent_at = now\(\) WHERE id = ANY/)[0]!.params).toEqual([['d1']]);
  });

  it('每一次 fetch 都帶逾時的 AbortSignal', async () => {
    const { signals } = await run([sub('d1', 'a'), sub('d2', 'b')], () => 201);
    expect(signals).toHaveLength(2);
    for (const sig of signals) expect(sig).toBeInstanceOf(AbortSignal);
  });

  it('沒送達的把 sent_at 改回 NULL（下一輪重試）', async () => {
    const { find } = await run([sub('d1', 's1')], () => 500);
    expect(find(/SET sent_at = NULL/)[0]!.params).toEqual([['d1'], ['HTTP 500']]);
  });
});

describe('reminderPayload（Q3：不放金額）', () => {
  const base = {
    invoice_id: '0123abcd-0000-4000-8000-00000000abcd',
    due_date: '2026-10-20',
    student_name: '王小明',
  };
  it.each([
    [-3, '王小明 的帳單 10/20 到期（還有 3 天）'],
    [0, '王小明 的帳單今天（10/20）到期'],
    [7, '王小明 的帳單已逾期 7 天（10/20 到期）'],
  ])('offset %i', (offset, body) => {
    const p = reminderPayload({ ...base, offset });
    expect(p).toEqual({
      title: '繳費提醒',
      body,
      url: '/parent/payments',
      topic: base.invoice_id.replace(/-/g, ''),
    });
    expect(p.topic).toHaveLength(32);
    expect(JSON.stringify(p)).not.toMatch(/\$|元|NT/);
  });
});
