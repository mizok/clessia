import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { reminderPayload, runPush } from './push-run';
import { toB64u } from './web-push';

/**
 * #1661 run 的形狀：push_status 狀態機、預算、404／410 清訂閱、白名單再驗、VAPID 每個服務簽一次、
 * 送出期間沒有交易。排入與 skipped 的 SQL 語意（收件人、偏好、去重）在 `contract/push-run.contract.ts` 對真 Postgres 驗。
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

function fakePool(pending: Row[], fail?: RegExp, digests = 0) {
  const sent: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      sent.push({ sql, params });
      if (fail?.test(sql)) throw new Error('boom');
      // 管理員摘要：今天還沒排、有一位財務管理員、有一張逾期未繳 → 寫進 digests 筆
      if (digests > 0) {
        if (/FROM organizations o\n/.test(sql))
          return { rows: [{ org_id: 'o1', overdue: true, unbilled: false }], rowCount: 1 };
        if (/HAVING bool_or/.test(sql))
          return {
            rows: [
              { org_id: 'o1', user_id: 'u1', roles: ['admin'], permissions: ['*'], campus_ids: [] },
            ],
            rowCount: 1,
          };
        if (/i\.due_date < \$2/.test(sql))
          return {
            rows: [
              {
                org_id: 'o1',
                due_date: '2026-10-01',
                items: [{ amount: 100 }],
                payments: [],
                scope_student: null,
                scope_items: [],
              },
            ],
            rowCount: 1,
          };
        if (
          /INSERT INTO notifications \(org_id, user_id, role, kind, dedupe_key, payload, push_status/.test(
            sql,
          )
        )
          return { rows: [], rowCount: digests };
      }
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

async function run(pending: Row[], status: (url: string) => number, batchSize = 10, fail?: RegExp) {
  const db = fakePool(pending, fail);
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

describe('runPush —— push_status 狀態機（#1661，#1626 改版）', () => {
  const claimUpdate = /SET push_status = 'claimed'/;
  const sentUpdate = /SET push_status = 'sent'/;
  const failUpdate = /FROM unnest\(\$1::uuid\[\], \$2::text\[\]\) AS x\(id, err\)/;

  it('成功：認領成 claimed → 回寫成 sent、更新 last_success_at；COMMIT', async () => {
    const { result, find, sent } = await run([sub('d1', 's1')], () => 201);
    expect(result).toMatchObject({ attempted: 1, delivered: 1, removedSubscriptions: 0 });
    expect(find(claimUpdate)[0]!.params).toEqual([['d1']]);
    expect(find(sentUpdate)[0]!.params).toEqual([['d1']]);
    expect(find(/SET last_success_at = now\(\)/)[0]!.params).toEqual([['s1']]);
    expect(sent.at(-1)!.sql).toBe('COMMIT');
  });

  it('失敗：回到 pending（滿三次 failed）、push_attempts＋1、記錯誤', async () => {
    const { find } = await run([sub('d1', 's1')], () => 500);
    const q = find(failUpdate)[0]!;
    expect(q.params).toEqual([['d1'], ['HTTP 500']]);
    expect(q.sql).toMatch(/WHEN push_attempts \+ 1 >= 3 THEN 'failed' ELSE 'pending'/);
    expect(find(sentUpdate)).toEqual([]);
  });

  it('404 與 410 都刪訂閱；那則記失敗', async () => {
    const { result, find } = await run([sub('d1', 's1'), sub('d1', 's2')], (u) =>
      u.endsWith('s1') ? 404 : 410,
    );
    expect(result).toMatchObject({ delivered: 0, removedSubscriptions: 2 });
    expect(find(/DELETE FROM push_subscriptions/)[0]!.params).toEqual([['s1', 's2']]);
    expect(find(failUpdate)[0]!.params).toEqual([['d1'], ['HTTP 404, HTTP 410']]);
  });

  it('一台成功一台 500：算送達，不重送', async () => {
    const { result, find } = await run([sub('d1', 's1'), sub('d1', 's2')], (u) =>
      u.endsWith('s1') ? 201 : 500,
    );
    expect(result).toMatchObject({ delivered: 1 });
    expect(find(failUpdate)).toEqual([]);
  });

  it('DB 裡存的 endpoint 不在白名單：不送、刪掉那個訂閱', async () => {
    const { urls, find } = await run([sub('d1', 's1', 'https://evil.example.com/x')], () => 201);
    expect(urls).toEqual([]);
    expect(find(/DELETE FROM push_subscriptions/)[0]!.params).toEqual([['s1']]);
    expect(find(failUpdate)[0]!.params).toEqual([['d1'], ['ENDPOINT_NOT_ALLOWED']]);
  });

  it('認領時訂閱已經被刪光：不送，標 skipped／NO_SUBSCRIPTION（不是失敗）', async () => {
    const { result, urls, find } = await run([sub('d1', null)], () => 201);
    expect(urls).toEqual([]);
    expect(result).toMatchObject({ skipped: 1, attempted: 0 });
    const q = find(/push_error = 'NO_SUBSCRIPTION'\s+WHERE id = ANY/)[0]!;
    expect(q.sql).toMatch(/push_status = 'skipped'/);
    expect(q.params).toEqual([['d1']]);
  });

  it('認領前先把不推播的整批標 skipped（沒有訂閱、偏好關掉）—— 不佔 K 的名額', async () => {
    const { find, sent } = await run([sub('d1', 's1')], () => 201);
    const skip = find(
      /SET push_status = 'skipped', push_updated_at = now\(\),\s+push_error = CASE/,
    )[0]!;
    expect(skip.sql).toMatch(/notification_preferences/);
    expect(skip.sql).toMatch(/np\.kind = n\.kind AND NOT np\.enabled/);
    const at = (re: RegExp) => sent.findIndex((q) => re.test(q.sql));
    expect(at(/push_error = CASE/)).toBeLessThan(at(/FOR UPDATE SKIP LOCKED/));
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
    // 並行送出，完成順序不固定 —— 比集合
    expect(urls.map((u) => u.split('/').at(-1)).sort()).toEqual(['a', 'b']);
  });

  it('推播角色白名單（PUSH_ENABLED_ROLES）同時帶進 skip 與認領兩句', async () => {
    const { find } = await run([sub('d1', 's1')], () => 201);
    const skip = find(/push_error = CASE/)[0]!;
    expect(skip.sql).toMatch(/WHEN NOT \(n\.role::text = ANY\(\$2\)\) THEN 'ROLE_PUSH_DISABLED'/);
    expect(skip.params).toEqual([null, ['parent']]);
    const claim = find(/FOR UPDATE SKIP LOCKED/)[0]!;
    expect(claim.sql).toMatch(/role::text = ANY\(\$3\)/);
    expect(claim.params?.[2]).toEqual(['parent']);
  });

  it('批次邊界：裝置數剛好等於 K 的那一則要放進這一批（K=2：1 台＋1 台都認領）', async () => {
    const { urls, find } = await run(
      [sub('d1', 'a'), sub('d2', 'b'), sub('d3', 'c')],
      () => 201,
      2,
    );
    expect(urls.map((u) => u.split('/').at(-1)).sort()).toEqual(['a', 'b']);
    expect(find(/SET push_status = 'claimed'/)[0]!.params).toEqual([['d1', 'd2']]);
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
    expect(db.find(failUpdate)[0]!.params).toEqual([['d1'], ['HTTP 0']]);
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

  it('認領只拿 pending、FOR UPDATE SKIP LOCKED：同時跑的另一個 run 拿不到同一則', async () => {
    const { find } = await run([sub('d1', 's1')], () => 201);
    const select = find(/FOR UPDATE SKIP LOCKED/)[0]!;
    expect(select.sql).toMatch(/WHERE push_status = 'pending'/);
  });

  it('每一次 fetch 都帶逾時的 AbortSignal', async () => {
    const { signals } = await run([sub('d1', 'a'), sub('d2', 'b')], () => 201);
    expect(signals).toHaveLength(2);
    for (const sig of signals) expect(sig).toBeInstanceOf(AbortSignal);
  });

  it('每一輪開頭先重新開放 claimed 超過 10 分鐘的（算一次嘗試，滿三次 failed）', async () => {
    const { find, sent } = await run([], () => 201);
    const reopen = find(/CLAIM_EXPIRED/)[0]!;
    expect(reopen.params).toEqual([10, null]); // null = 全部 org（正式）
    expect(reopen.sql).toMatch(/WHERE push_status = 'claimed'/);
    expect(reopen.sql).toMatch(/WHEN push_attempts \+ 1 >= 3 THEN 'failed' ELSE 'pending'/);
    expect(sent.findIndex((q) => /CLAIM_EXPIRED/.test(q.sql))).toBeLessThan(
      sent.findIndex((q) => /FOR UPDATE SKIP LOCKED/.test(q.sql)),
    );
  });

  it('不帶 orgIds（正式）＝每一句都跑全部 org；帶了就每一句都只跑那幾個', async () => {
    const all = await run([sub('d1', 's1')], () => 201);
    const scoped = (await all.find(/FROM organizations org/))[0]!;
    expect(scoped.params).toEqual(['2026-10-16', null]);
    for (const re of [
      /CLAIM_EXPIRED/,
      /push_error = CASE/,
      /FOR UPDATE SKIP LOCKED/,
      /DELETE FROM notifications/,
    ]) {
      expect(all.find(re)[0]!.sql).toMatch(/IS NULL OR (org\.id|n\.org_id|org_id) = ANY/);
    }
  });

  it('清 90 天前的通知（Q-b：不管已讀未讀）', async () => {
    const { find } = await run([], () => 201);
    const purge = find(/DELETE FROM notifications/)[0]!;
    expect(purge.params).toEqual([90, null]);
    expect(purge.sql).not.toMatch(/read_at/);
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

describe('runPush —— 學年升級前提醒（#1820，二讀 P1）', () => {
  it('每輪都跑，第一句帶 org 範圍，包在自己的 SAVEPOINT', async () => {
    const db = fakePool([]);
    await runPush(db.pool, {
      today: '2026-10-16',
      orgIds: ['o1'],
      batchSize: 10,
      vapid: await vapid(),
      subject: 'mailto:ops@example.com',
      send: async () => ({ status: 201 }),
    });
    const order = db.sent.map((q) => q.sql);
    const first = db.find(/grade_promotion_month_day/);
    expect(first).toHaveLength(1);
    expect(first[0]!.params).toEqual([['o1']]);
    const sp = order.indexOf('SAVEPOINT grade_promotion_reminders');
    expect(sp).toBeGreaterThan(-1);
    expect(order.indexOf(first[0]!.sql)).toBeGreaterThan(sp);
    expect(order).toContain('RELEASE SAVEPOINT grade_promotion_reminders');
  });

  it('它出錯只退自己的 SAVEPOINT：財務摘要照常釋放、繳費提醒照送', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, sent } = await run(
      [sub('d1', 's1')],
      () => 201,
      10,
      /grade_promotion_month_day/,
    );
    const order = sent.map((q) => q.sql);
    expect(order).toContain('ROLLBACK TO SAVEPOINT grade_promotion_reminders');
    expect(order).toContain('RELEASE SAVEPOINT staff_digests');
    expect(order).not.toContain('ROLLBACK');
    expect(result).toMatchObject({ attempted: 1, delivered: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('grade_promotion_reminders'), 'boom');
    log.mockRestore();
  });
});

describe('runPush —— 申請提醒（#1821，二讀 P1）', () => {
  it('每輪都跑，第一句帶今天、org 範圍、回看 30 天，包在自己的 SAVEPOINT', async () => {
    const db = fakePool([]);
    await runPush(db.pool, {
      today: '2026-10-16',
      orgIds: ['o1'],
      batchSize: 10,
      vapid: await vapid(),
      subject: 'mailto:ops@example.com',
      send: async () => ({ status: 201 }),
    });
    const order = db.sent.map((q) => q.sql);
    const candidates = db.find(/FROM public_applications pa/);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.params).toEqual(['2026-10-16', ['o1'], 30]);
    const sp = order.indexOf('SAVEPOINT application_reminders');
    expect(sp).toBeGreaterThan(-1);
    expect(order.indexOf(candidates[0]!.sql)).toBeGreaterThan(sp);
    expect(order).toContain('RELEASE SAVEPOINT application_reminders');
  });

  it('它出錯只退自己的 SAVEPOINT：財務摘要的 SAVEPOINT 照常釋放、繳費提醒照送', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, sent } = await run(
      [sub('d1', 's1')],
      () => 201,
      10,
      /FROM public_applications pa/,
    );
    const order = sent.map((q) => q.sql);
    expect(order).toContain('ROLLBACK TO SAVEPOINT application_reminders');
    expect(order).toContain('RELEASE SAVEPOINT staff_digests');
    expect(order).not.toContain('ROLLBACK');
    expect(result).toMatchObject({ attempted: 1, delivered: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('application_reminders'), 'boom');
    log.mockRestore();
  });
});

describe('runPush —— 管理員每日摘要（#1693）', () => {
  it('摘要出錯只退它自己的 SAVEPOINT、記 [notify]；同一個交易裡的繳費提醒照常送', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, find, sent } = await run(
      [sub('d1', 's1')],
      () => 201,
      10,
      /FROM organizations o\n/,
    );
    const order = sent.map((q) => q.sql);
    const sp = order.indexOf('SAVEPOINT staff_digests');
    expect(sp).toBeGreaterThan(-1);
    expect(order).toContain('ROLLBACK TO SAVEPOINT staff_digests');
    expect(order.indexOf('ROLLBACK TO SAVEPOINT staff_digests')).toBeGreaterThan(sp);
    expect(order).not.toContain('ROLLBACK');
    expect(find(/FOR UPDATE SKIP LOCKED/)).toHaveLength(1);
    expect(result).toMatchObject({ digests: 0, attempted: 1, delivered: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[notify]'), 'boom');
    log.mockRestore();
  });

  it('這輪排入了摘要：不認領、不送推播，留給下一輪（計畫席 10-16 裁，免費方案 10ms）', async () => {
    const db = fakePool([sub('d1', 's1')], undefined, 1);
    const sends: string[] = [];
    const result = await runPush(db.pool, {
      today: '2026-10-16',
      batchSize: 10,
      vapid: await vapid(),
      subject: 'mailto:ops@example.com',
      send: async (url) => (sends.push(url), { status: 201 }),
    });
    expect(result).toMatchObject({ digests: 1, attempted: 0, delivered: 0 });
    expect(db.find(/FOR UPDATE SKIP LOCKED/)).toHaveLength(0);
    expect(sends).toEqual([]);
    expect(db.sent.filter((q) => q.sql === 'BEGIN')).toHaveLength(1); // 沒有回寫的交易
  });

  it('沒有排入摘要（今天排過了，或算了但 0 筆）：照常認領與送出', async () => {
    const { result, find } = await run([sub('d1', 's1')], () => 201);
    expect(result).toMatchObject({ digests: 0, attempted: 1, delivered: 1 });
    expect(find(/FOR UPDATE SKIP LOCKED/)).toHaveLength(1);
  });

  it('帶 orgIds 時摘要也只跑那幾個 org；日期是呼叫端給的台北日期', async () => {
    const db = fakePool([]);
    await runPush(db.pool, {
      today: '2026-10-16',
      batchSize: 10,
      vapid: await vapid(),
      subject: 'mailto:ops@example.com',
      orgIds: ['org-x'],
    });
    expect(db.find(/FROM organizations o\n/)[0]!.params).toEqual(['2026-10-16', ['org-x']]);
  });
});
