import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runPush } from '../lib/push-run';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import { toB64u } from '../lib/web-push';

/**
 * #1661：通知排程對真 Postgres 跑 —— 收件人推導、去重、未繳清、push_status（含 skipped），這些是 SQL 語意。
 *
 * 自己建一個 org（分校、學生、帳單、家長列）；家長的帳號**借 seed 既有的 parent 使用者**
 * —— 不寫 ba_user（c2）。跑完逐張刪掉（replica 模式：作廢帳單的明細刪不掉，見 class-delete.contract）。
 * 送出用替身，不打任何推播服務。
 */

const DB = process.env['DATABASE_URL'];
if (!DB && process.env['CONTRACT_REQUIRED']) {
  throw new Error('[contract] CONTRACT_REQUIRED 但沒有 DATABASE_URL');
}
const run = DB ? describe : describe.skip;

const P256DH =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';

run('推播排程對真 Postgres（#1661）', () => {
  const pool = new Pool({ connectionString: DB });
  const today = getCurrentTaipeiDateString();
  let orgId = '';
  let studentId = '';
  let mom = ''; // 跟學生有關係的家長帳號
  let stranger = ''; // 同 org、有訂閱、但跟學生沒關係
  let vapid = { publicKey: '', privateKey: '' };
  const sent: string[] = [];

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) =>
    (await q<{ id: string }>(`${sql} RETURNING id`, params))[0]!.id;

  const push = () =>
    runPush(pool, {
      today,
      batchSize: 10,
      vapid,
      subject: 'mailto:contract@example.invalid',
      send: async (url) => {
        sent.push(url);
        return { status: 201 };
      },
    });
  const deliveries = () =>
    q<{
      user_id: string;
      dedupe_key: string;
      kind: string;
      payload: { body: string };
      push_status: string;
      push_error: string | null;
      read_at: string | null;
    }>(
      `SELECT user_id, dedupe_key, kind, payload, push_status, push_error, read_at
       FROM notifications WHERE org_id = $1 ORDER BY dedupe_key`,
      [orgId],
    );
  /** 到期日 = 今天 + days 的未繳帳單（一筆 1000 元明細） */
  const invoice = async (days: number) => {
    const id = await one(
      `INSERT INTO invoices (org_id, student_id, due_date) VALUES ($1, $2, $3::date + $4::int)`,
      [orgId, studentId, today, days],
    );
    await q(`INSERT INTO invoice_items (invoice_id, type, amount) VALUES ($1, 'tuition', 1000)`, [
      id,
    ]);
    return id;
  };

  beforeAll(async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ])) as CryptoKeyPair;
    vapid = {
      publicKey: toB64u(
        new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
      ),
      privateKey: ((await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey).d!,
    };
    const users = await q<{ user_id: string }>(
      `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN ba_user u ON u.id = ur.user_id
       WHERE ur.role = 'parent' ORDER BY ur.user_id LIMIT 2`,
    );
    expect(users).toHaveLength(2); // seed 要有兩位家長帳號
    [mom, stranger] = users.map((u) => u.user_id) as [string, string];
  });

  beforeEach(async () => {
    sent.length = 0;
    orgId = await one(`INSERT INTO organizations (name) VALUES ($1)`, [`c1661-${randomUUID()}`]);
    studentId = await one(
      `INSERT INTO students (org_id, name, grade) VALUES ($1, '王小明', 'J1')`,
      [orgId],
    );
    for (const userId of [mom, stranger]) {
      const parentId = await one(
        `INSERT INTO parents (org_id, name, user_id, status) VALUES ($1, 'x', $2, 'active')`,
        [orgId, userId],
      );
      if (userId === mom) {
        await q(`INSERT INTO parent_student_relations (parent_id, student_id) VALUES ($1, $2)`, [
          parentId,
          studentId,
        ]);
      }
      await q(
        `INSERT INTO push_subscriptions (org_id, user_id, endpoint, p256dh, auth, vapid_public_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          orgId,
          userId,
          `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
          P256DH,
          AUTH,
          vapid.publicKey,
        ],
      );
    }
  });

  async function cleanup(org: string) {
    const db = await pool.connect(); // BEGIN／SET LOCAL／COMMIT 要在同一條連線上
    try {
      await db.query('BEGIN');
      await db.query('SET LOCAL session_replication_role = replica');
      await db.query(
        'DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE org_id = $1)',
        [org],
      );
      await db.query(
        'DELETE FROM parent_student_relations WHERE parent_id IN (SELECT id FROM parents WHERE org_id = $1)',
        [org],
      );
      await db.query('DELETE FROM notification_preferences WHERE org_id = $1', [org]);
      for (const t of [
        'notifications',
        'push_subscriptions',
        'payment_records',
        'invoices',
        'parents',
        'students',
      ]) {
        await db.query(`DELETE FROM ${t} WHERE org_id = $1`, [org]);
      }
      await db.query('COMMIT');
    } finally {
      db.release();
    }
    await pool.query('DELETE FROM organizations WHERE id = $1', [org]);
  }

  const orgs: string[] = [];
  beforeEach(() => {
    orgs.push(orgId);
  });
  afterAll(async () => {
    for (const org of orgs) await cleanup(org);
    await pool.end();
  });

  it('到期前 3 天：只排給有關係的家長，送出；同一天再跑不會再排', async () => {
    const id = await invoice(3);
    const first = await push();
    expect(first).toMatchObject({ enqueued: 1, delivered: 1 });
    const rows = await deliveries();
    expect(rows).toEqual([
      expect.objectContaining({
        user_id: mom,
        kind: 'invoice_due',
        dedupe_key: `invoice_reminder:${id}:-3`,
      }),
    ]);
    expect(rows[0]!.payload.body).toContain('王小明');
    expect(rows[0]!.payload.body).not.toContain('1000'); // Q3：不放金額

    const again = await push();
    expect(again).toMatchObject({ enqueued: 0, attempted: 0 });
    expect(sent).toHaveLength(1);
  });

  it('改設定後已推過的時間點不重推；新加的時間點不補發過去的', async () => {
    await invoice(3);
    await push();
    await q(`UPDATE organizations SET invoice_reminder_offsets = '{-5,-3}' WHERE id = $1`, [orgId]);
    expect(await push()).toMatchObject({ enqueued: 0 });
    expect(await deliveries()).toHaveLength(1);
  });

  it('逾期第 1 天 → invoice_overdue；不在時間點上的不排', async () => {
    await invoice(-1); // 逾期第 1 天
    await invoice(-2); // 不在 {-3,0,1,7}
    await push();
    expect((await deliveries()).map((d) => d.kind)).toEqual(['invoice_overdue']);
  });

  it('家長關掉這一類的推播 → 通知照樣有、算未讀，只是不推（Q-a：偏好只管推播）', async () => {
    await invoice(0);
    await q(
      `INSERT INTO notification_preferences (user_id, org_id, role, kind, enabled)
       VALUES ($1, $2, 'parent', 'invoice_due', false)`,
      [mom, orgId],
    );
    expect(await push()).toMatchObject({ enqueued: 1, skipped: 1, attempted: 0 });
    expect(await deliveries()).toEqual([
      expect.objectContaining({
        user_id: mom,
        push_status: 'skipped',
        push_error: 'PUSH_DISABLED',
        read_at: null,
      }),
    ]);
    expect(sent).toEqual([]);
  });

  it('繳清的、作廢的 → 不排', async () => {
    const paid = await invoice(3);
    await q(
      `INSERT INTO payment_records (org_id, invoice_id, kind, amount, method, paid_at)
       VALUES ($1, $2, 'payment', 1000, 'cash', $3::date)`,
      [orgId, paid, today],
    );
    const voided = await invoice(0);
    await q(`UPDATE invoices SET voided_at = now(), void_reason = 'x' WHERE id = $1`, [voided]);
    expect(await push()).toMatchObject({ enqueued: 0 });
  });

  it('兩個 run 同時跑（推播服務很慢）：同一則只送一次；送出期間沒有交易拖著', async () => {
    await invoice(3);
    await invoice(0);
    const slow = () =>
      runPush(pool, {
        today,
        batchSize: 10,
        vapid,
        subject: 'mailto:contract@example.invalid',
        send: async (url) => {
          sent.push(url);
          // 「送出中」那一刻，認領那個交易還開著嗎？開著的話它對這幾列的列鎖還在，NOWAIT 會立刻失敗。
          // （不用 pg_stat_activity 數「idle in transaction」：另一個 run 的短交易、共用 DB 的其他活動都會算進去）
          try {
            await q('SELECT id FROM notifications WHERE org_id = $1 FOR UPDATE NOWAIT', [orgId]);
            lockedDuringSend.push(false);
          } catch {
            lockedDuringSend.push(true);
          }
          await new Promise((r) => setTimeout(r, 300));
          return { status: 201 };
        },
      });
    const lockedDuringSend: boolean[] = [];
    const [a, b] = await Promise.all([slow(), slow()]);
    expect(a.delivered + b.delivered).toBe(2);
    expect(sent).toHaveLength(2); // 兩則各一台，沒有重送
    expect(lockedDuringSend).toEqual([false, false]);
  });

  it('認領後 Worker 被砍：10 分鐘內不碰，過了 10 分鐘重送一次、而且只送一次', async () => {
    await invoice(3);
    // 「被砍」：送出永遠不回來，回寫永遠不會發生。這個 promise 故意不等（被砍的 run 就是這樣）
    void runPush(pool, {
      today,
      batchSize: 10,
      vapid,
      subject: 'mailto:contract@example.invalid',
      send: () => new Promise(() => undefined),
    });
    // 等到它認領完（第 1 段的交易 commit）
    for (let i = 0; i < 50; i++) {
      const [row] = await q<{ push_status: string }>(
        'SELECT push_status FROM notifications WHERE org_id = $1',
        [orgId],
      );
      if (row?.push_status === 'claimed') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect((await deliveries())[0]).toBeDefined();
    const stuck = await q<{ push_status: string }>(
      'SELECT push_status FROM notifications WHERE org_id = $1',
      [orgId],
    );
    expect(stuck).toEqual([{ push_status: 'claimed' }]); // 沒有明確狀態的話，這裡會看起來像「已送」而無聲漏掉

    // 10 分鐘內：下一輪不碰它（那個 run 可能只是慢）
    expect(await push()).toMatchObject({ attempted: 0 });
    expect(sent).toEqual([]);

    // 時間往前推 11 分鐘：下一輪重新開放並送出，一次
    await q(
      `UPDATE notifications SET push_updated_at = push_updated_at - interval '11 minutes' WHERE org_id = $1`,
      [orgId],
    );
    expect(await push()).toMatchObject({ attempted: 1, delivered: 1 });
    expect(sent).toHaveLength(1);
    const [done] = await q<{
      push_status: string;
      push_error: string | null;
      push_attempts: number;
    }>('SELECT push_status, push_error, push_attempts FROM notifications WHERE org_id = $1', [
      orgId,
    ]);
    expect(done).toEqual({ push_status: 'sent', push_error: null, push_attempts: 2 }); // 重新開放 +1、送達 +1

    // 再跑：不會再送
    expect(await push()).toMatchObject({ attempted: 0 });
    expect(sent).toHaveLength(1);
  });

  it('沒開推播（沒有訂閱）→ 通知照樣有、算未讀，只是不推；不是失敗、不重試', async () => {
    await q('DELETE FROM push_subscriptions WHERE org_id = $1 AND user_id = $2', [orgId, mom]);
    await invoice(3);
    expect(await push()).toMatchObject({ enqueued: 1, skipped: 1, attempted: 0 });
    expect(await deliveries()).toEqual([
      expect.objectContaining({
        user_id: mom,
        push_status: 'skipped',
        push_error: 'NO_SUBSCRIPTION',
        read_at: null,
      }),
    ]);
    expect(await push()).toMatchObject({ enqueued: 0, skipped: 0, attempted: 0 }); // 不重試
    expect(sent).toEqual([]);
  });
});
