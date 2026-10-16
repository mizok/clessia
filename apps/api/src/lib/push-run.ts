import type { Pool, PoolClient } from 'pg';

import { deriveInvoiceStatus, isOpenInvoice, type PaymentRow } from './invoice-status';
import { withTx } from './pg-tx';
import { isAllowedPushEndpoint } from './push-endpoint';
import { buildPushRequest, vapidAuthorization, type VapidKeys } from './web-push';

/**
 * 推播排程的一次 run（#1661，設計稿 kb/wiki/architecture/web-push.md §5）：排入 → 送一批 → 清舊紀錄。
 *
 * **走 pg pool，不用 supabase-js**：免費方案每次 Cron 只有 50 個 subrequest，supabase-js 走 HTTP、
 * 每句都算一個；推播本身就要用掉 K 個。這是 pg-pool-writes.md 規則 1 之外的第二個理由（額度），
 * 交易包法與錯誤對應照那一頁。
 *
 * **對外 fetch 期間沒有交易開著**（見 `runPush`）。Workers cron 與自架 cron 同時開著、或有人手動多打一次，
 * 靠認領時的 `FOR UPDATE SKIP LOCKED`＋`sent_at`／`last_error` 記號，不會同一則送兩次。
 *
 * 這是系統工作，不屬於任何一個使用者 —— **跨 org 跑**，每一句都用資料本身的 org_id 關聯
 * （帳單的 org → 家長的 org → 訂閱的 org），不收任何外部指定的對象。
 */

/** 每次 run 最多送幾台裝置。#1657 在免費方案量的：VAPID＋10 則加密中位數 4ms、最大 11ms */
export const DEFAULT_PUSH_BATCH_SIZE = 10;
/** 帳單提醒隔天才收到就沒意義（RFC 8030 §5.2） */
const TTL_SECONDS = 86400;
const MAX_ATTEMPTS = 3;
const RETENTION_DAYS = 90;
/** 每一次對推播服務的 fetch 最多等多久；逾時算失敗，下一輪重試 */
export const SEND_TIMEOUT_MS = 5000;
/**
 * 認領記號（`last_error` 既有欄位，不加 migration）。回寫成功清成 NULL、失敗寫真正的錯誤；
 * **還是這個記號＝認領之後沒回寫到**（Worker 被砍 —— 免費方案 CPU 超量就是這樣）。
 */
export const CLAIM_MARK = '__claimed__';
/** 認領過了這麼久還沒回寫，就當那個 run 死了，重新開放。遠大於一次 run 的長度（送出最多約 5 秒） */
export const RECLAIM_AFTER_MINUTES = 10;

export interface PushRunOptions {
  /** 台北今天（`getCurrentTaipeiDateString()`），呼叫端決定 */
  readonly today: string;
  readonly batchSize: number;
  readonly vapid: VapidKeys;
  /** VAPID 的 `sub`（`mailto:` 補習班聯絡信箱） */
  readonly subject: string;
  /** 測試替身用；正式就是全域 fetch */
  readonly send?: (url: string, init: RequestInit) => Promise<{ status: number }>;
}

export interface PushRunResult {
  readonly enqueued: number;
  readonly attempted: number;
  readonly delivered: number;
  readonly removedSubscriptions: number;
  readonly purged: number;
}

interface Candidate {
  invoice_id: string;
  org_id: string;
  due_date: string;
  offset: number;
  student_name: string;
  user_id: string;
  item_amounts: Array<number | string>;
  payments: Array<{ kind: PaymentRow['kind']; amount: number | string }>;
}

/**
 * 今天要提醒的「帳單 × 時間點 × 家長」。這裡只做關聯與過濾（作廢、時間點、收件人、偏好、有沒有訂閱）；
 * **未繳清**交給既有的 `deriveInvoiceStatus`＋`isOpenInvoice`，不在 SQL 另寫一套。
 */
const CANDIDATES_SQL = `
SELECT i.id AS invoice_id, i.org_id, i.due_date::text AS due_date, o.off AS offset,
       s.name AS student_name, p.user_id,
       COALESCE((SELECT json_agg(ii.amount) FROM invoice_items ii WHERE ii.invoice_id = i.id), '[]') AS item_amounts,
       COALESCE((SELECT json_agg(json_build_object('kind', pr.kind, 'amount', pr.amount))
                   FROM payment_records pr WHERE pr.invoice_id = i.id AND pr.org_id = i.org_id), '[]') AS payments
FROM organizations org
CROSS JOIN LATERAL unnest(org.invoice_reminder_offsets) AS o(off)
JOIN invoices i ON i.org_id = org.id AND i.due_date = $1::date - o.off AND i.voided_at IS NULL
JOIN students s ON s.id = i.student_id AND s.org_id = i.org_id
JOIN parent_student_relations r ON r.student_id = i.student_id
JOIN parents p ON p.id = r.parent_id AND p.org_id = i.org_id AND p.status = 'active' AND p.user_id IS NOT NULL
WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = p.user_id AND ur.role = 'parent')
  AND EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = p.user_id AND ps.org_id = i.org_id)
  AND NOT EXISTS (
    SELECT 1 FROM notification_preferences np
    WHERE np.user_id = p.user_id AND np.org_id = i.org_id AND np.role = 'parent' AND NOT np.enabled
      AND np.kind = (CASE WHEN o.off <= 0 THEN 'invoice_due' ELSE 'invoice_overdue' END)::notification_kind
  )`;

/** 鎖定畫面看得到 —— **不放金額**（#1626 Q3） */
export function reminderPayload(
  c: Pick<Candidate, 'invoice_id' | 'due_date' | 'offset' | 'student_name'>,
) {
  const [, m, d] = c.due_date.split('-');
  const md = `${Number(m)}/${Number(d)}`;
  const body =
    c.offset < 0
      ? `${c.student_name} 的帳單 ${md} 到期（還有 ${-c.offset} 天）`
      : c.offset === 0
        ? `${c.student_name} 的帳單今天（${md}）到期`
        : `${c.student_name} 的帳單已逾期 ${c.offset} 天（${md} 到期）`;
  return {
    title: '繳費提醒',
    body,
    url: '/parent/payments',
    // 同一張帳單的提醒互相蓋掉（RFC 8030 §5.4，最多 32 字元）
    topic: c.invoice_id.replace(/-/g, ''),
  };
}

async function enqueue(db: PoolClient, today: string): Promise<number> {
  const { rows } = await db.query<Candidate>(CANDIDATES_SQL, [today]);
  const open = rows.filter((c) =>
    isOpenInvoice(
      deriveInvoiceStatus(
        c.item_amounts.map((a) => ({ amount: Number(a) })),
        c.payments.map((p) => ({ kind: p.kind, amount: Number(p.amount) })),
        false, // 作廢的在 SQL 就濾掉了
      ),
    ),
  );
  if (open.length === 0) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO push_deliveries (org_id, user_id, role, kind, dedupe_key, payload)
     SELECT x.org_id, x.user_id, 'parent', x.kind, x.dedupe_key, x.payload
     FROM unnest($1::uuid[], $2::text[], $3::notification_kind[], $4::text[], $5::jsonb[])
       AS x(org_id, user_id, kind, dedupe_key, payload)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
    [
      open.map((c) => c.org_id),
      open.map((c) => c.user_id),
      open.map((c) => (c.offset <= 0 ? 'invoice_due' : 'invoice_overdue')),
      // 時間點在鍵裡、日期不在（Q2）：改設定後已推過的時間點不會重推
      open.map((c) => `invoice_reminder:${c.invoice_id}:${c.offset}`),
      open.map((c) => JSON.stringify(reminderPayload(c))),
    ],
  );
  return rowCount ?? 0;
}

interface PendingRow {
  id: string;
  payload: unknown;
  sub_id: string | null;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
}

interface Job {
  readonly deliveryId: string;
  readonly row: PendingRow;
}

/**
 * 認領（短交易內）：取還沒送的最舊幾則，`FOR UPDATE SKIP LOCKED` 讓同時跑的另一個 run 拿不到同一列，
 * 再把選中的 `sent_at` 先設成 now() 當「已認領」記號 —— 交易一結束鎖就放了，記號讓下一個 run 也不碰它。
 * 送失敗的在回寫時把 `sent_at` 改回 NULL，下一輪重試。
 */
/**
 * 上一個 run 認領後沒回寫（被砍了）的，重新開放給這一輪。`attempts + 1`：一則若每次都讓 Worker 被砍，
 * 三次之後就不再試，不會永遠卡著後面的。被砍時可能其實已經送出 —— 那種情況會重送一次，
 * 由裝置端 `tag = topic` 合併成一則（#1663）；比無聲漏掉好。
 */
async function reopenAbandoned(db: PoolClient): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE push_deliveries
     SET sent_at = NULL, attempts = attempts + 1, last_error = 'CLAIM_EXPIRED'
     WHERE last_error = $1 AND sent_at < now() - make_interval(mins => $2)`,
    [CLAIM_MARK, RECLAIM_AFTER_MINUTES],
  );
  return rowCount ?? 0;
}

async function claim(db: PoolClient, batchSize: number): Promise<Job[]> {
  const { rows } = await db.query<PendingRow>(
    `SELECT d.id, d.payload, s.id AS sub_id, s.endpoint, s.p256dh, s.auth
     FROM (SELECT id, user_id, org_id, payload, created_at FROM push_deliveries
           WHERE sent_at IS NULL AND attempts < $2
           ORDER BY created_at, id LIMIT $1
           FOR UPDATE SKIP LOCKED) d
     LEFT JOIN push_subscriptions s ON s.user_id = d.user_id AND s.org_id = d.org_id
     ORDER BY d.created_at, d.id`,
    [batchSize, MAX_ATTEMPTS],
  );

  // 依佇列順序把整則（含它所有裝置）放進這一批，直到裝置數用完；一則不拆到兩次 run
  const byDelivery = new Map<string, PendingRow[]>();
  for (const r of rows) byDelivery.set(r.id, [...(byDelivery.get(r.id) ?? []), r]);
  const noSubscription: string[] = [];
  const jobs: Job[] = [];
  for (const [id, subs] of byDelivery) {
    const devices = subs.filter((s) => s.sub_id !== null);
    if (devices.length === 0) {
      noSubscription.push(id); // 排入後訂閱被刪了：不再重試
      continue;
    }
    if (jobs.length > 0 && jobs.length + devices.length > batchSize) break;
    for (const row of devices) jobs.push({ deliveryId: id, row });
  }

  const claimed = [...new Set(jobs.map((j) => j.deliveryId))];
  if (claimed.length > 0) {
    await db.query(
      'UPDATE push_deliveries SET sent_at = now(), last_error = $2 WHERE id = ANY($1::uuid[])',
      [claimed, CLAIM_MARK],
    );
  }
  if (noSubscription.length > 0) {
    await db.query(
      `UPDATE push_deliveries SET attempts = $2, last_error = 'NO_SUBSCRIPTION' WHERE id = ANY($1::uuid[])`,
      [noSubscription, MAX_ATTEMPTS],
    );
  }
  return jobs;
}

/** 送出（**交易外**）：每一次 fetch 都有逾時，推播服務再慢也不會讓任何交易或鎖跟著等 */
async function send(jobs: readonly Job[], opts: PushRunOptions) {
  const doSend = opts.send ?? ((url, init) => fetch(url, init));
  const auths = new Map<string, Promise<string>>(); // 每個推播服務一次 run 簽一次
  return Promise.all(
    jobs.map(async ({ deliveryId, row }) => {
      const endpoint = row.endpoint as string;
      // 白名單發送前再驗一次（#1659）：不信 DB 裡存的值
      if (!isAllowedPushEndpoint(endpoint)) return { deliveryId, row, status: 'invalid' as const };
      try {
        const origin = new URL(endpoint).origin;
        if (!auths.has(origin)) {
          auths.set(origin, vapidAuthorization(endpoint, opts.vapid, opts.subject));
        }
        const { url, init } = await buildPushRequest(
          { endpoint, keys: { p256dh: row.p256dh as string, auth: row.auth as string } },
          JSON.stringify(row.payload),
          {
            authorization: await auths.get(origin)!,
            ttl: TTL_SECONDS,
            topic: (row.payload as { topic?: string }).topic,
          },
        );
        const res = await doSend(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
        return { deliveryId, row, status: res.status };
      } catch (err) {
        // 逾時、網路錯誤：算這一台失敗，那則下一輪重試
        console.error('[push] send failed:', err instanceof Error ? err.message : err);
        return { deliveryId, row, status: 0 };
      }
    }),
  );
}

type Outcome = Awaited<ReturnType<typeof send>>[number];

/** 回寫（短交易內）：送達的保留 sent_at；沒送達的把 sent_at 改回 NULL、attempts＋1 */
async function writeBack(db: PoolClient, outcomes: readonly Outcome[]) {
  const ok = (s: number | 'invalid') => typeof s === 'number' && s >= 200 && s < 300;
  // RFC 8030 §7.3 規定過期是 404；實務上也有 410，都當失效
  const gone = (s: number | 'invalid') => s === 404 || s === 410 || s === 'invalid';
  const deliveredIds = new Set(outcomes.filter((o) => ok(o.status)).map((o) => o.deliveryId));
  const failed = [...new Set(outcomes.map((o) => o.deliveryId))]
    .filter((id) => !deliveredIds.has(id))
    .map((id) => ({
      id,
      error: outcomes
        .filter((o) => o.deliveryId === id)
        .map((o) => (o.status === 'invalid' ? 'ENDPOINT_NOT_ALLOWED' : `HTTP ${o.status}`))
        .join(', '),
    }));
  const succeededSubs = outcomes.filter((o) => ok(o.status)).map((o) => o.row.sub_id as string);
  const goneSubs = outcomes.filter((o) => gone(o.status)).map((o) => o.row.sub_id as string);

  if (succeededSubs.length > 0) {
    await db.query(
      'UPDATE push_subscriptions SET last_success_at = now() WHERE id = ANY($1::uuid[])',
      [succeededSubs],
    );
  }
  if (goneSubs.length > 0) {
    await db.query('DELETE FROM push_subscriptions WHERE id = ANY($1::uuid[])', [goneSubs]);
  }
  if (deliveredIds.size > 0) {
    await db.query(
      `UPDATE push_deliveries SET attempts = attempts + 1, last_error = NULL WHERE id = ANY($1::uuid[])`,
      [[...deliveredIds]],
    );
  }
  if (failed.length > 0) {
    await db.query(
      `UPDATE push_deliveries d SET sent_at = NULL, attempts = d.attempts + 1, last_error = x.err
       FROM unnest($1::uuid[], $2::text[]) AS x(id, err) WHERE d.id = x.id`,
      [failed.map((f) => f.id), failed.map((f) => f.error)],
    );
  }
  return { delivered: deliveredIds.size, removedSubscriptions: goneSubs.length };
}

/**
 * 三段，**對外 fetch 期間沒有任何交易開著**（計畫席 10-16：推播服務慢的話不能拖住交易與鎖；
 * 正式 DB 的 postgres 角色有沒有 idle_in_transaction／statement_timeout 沒有實查，這個形狀不依賴它）：
 *
 * 1. 短交易：排入（去重鍵冪等）＋認領＋清 90 天前紀錄
 * 2. 交易外：送出，每次 fetch 逾時 `SEND_TIMEOUT_MS`；全部並行，所以整段最多約一個逾時長
 * 3. 短交易：回寫
 *
 * 第 1 段之後、第 3 段之前 Worker 被砍（免費方案 CPU 超量會直接終止）：認領的那幾則停在 `CLAIM_MARK`，
 * 下一輪開頭過了 `RECLAIM_AFTER_MINUTES` 就重新開放（`reopenAbandoned`）—— 不會無聲漏掉。
 */
export async function runPush(pool: Pool, opts: PushRunOptions): Promise<PushRunResult> {
  const { enqueued, jobs, purged } = await withTx(pool, async (db) => {
    await reopenAbandoned(db);
    const enqueued = await enqueue(db, opts.today);
    const jobs = await claim(db, opts.batchSize);
    const { rowCount } = await db.query(
      `DELETE FROM push_deliveries WHERE created_at < now() - make_interval(days => $1)`,
      [RETENTION_DAYS],
    );
    return { enqueued, jobs, purged: rowCount ?? 0 };
  });
  if (jobs.length === 0) {
    return { enqueued, attempted: 0, delivered: 0, removedSubscriptions: 0, purged };
  }
  const outcomes = await send(jobs, opts);
  const written = await withTx(pool, (db) => writeBack(db, outcomes));
  return { enqueued, attempted: jobs.length, ...written, purged };
}
