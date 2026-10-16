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
 * **整個 run 在一個交易裡，開頭拿 transaction 級的 advisory lock**：Workers cron 與自架 cron 同時開著、
 * 或有人手動多打一次，後到的直接回 `skipped: 'locked'`，不會同一則送兩次。
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
/** advisory lock 的鍵：工單號，跟別的鎖撞不到就好 */
const RUN_LOCK_KEY = 1626;

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
  readonly skipped?: 'locked';
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

async function sendBatch(db: PoolClient, opts: PushRunOptions) {
  const { rows } = await db.query<PendingRow>(
    `SELECT d.id, d.payload, s.id AS sub_id, s.endpoint, s.p256dh, s.auth
     FROM (SELECT id, user_id, org_id, payload, created_at FROM push_deliveries
           WHERE sent_at IS NULL AND attempts < $2
           ORDER BY created_at, id LIMIT $1) d
     LEFT JOIN push_subscriptions s ON s.user_id = d.user_id AND s.org_id = d.org_id
     ORDER BY d.created_at, d.id`,
    [opts.batchSize, MAX_ATTEMPTS],
  );

  // 依佇列順序把整則（含它所有裝置）放進這一批，直到裝置數用完；一則不拆到兩次 run
  const byDelivery = new Map<string, PendingRow[]>();
  for (const r of rows) byDelivery.set(r.id, [...(byDelivery.get(r.id) ?? []), r]);
  const noSubscription: string[] = [];
  const jobs: Array<{ deliveryId: string; row: PendingRow }> = [];
  for (const [id, subs] of byDelivery) {
    const devices = subs.filter((s) => s.sub_id !== null);
    if (devices.length === 0) {
      noSubscription.push(id); // 排入後訂閱被刪了：不再重試
      continue;
    }
    if (jobs.length > 0 && jobs.length + devices.length > opts.batchSize) break;
    for (const row of devices) jobs.push({ deliveryId: id, row });
  }

  const send = opts.send ?? ((url, init) => fetch(url, init));
  const auths = new Map<string, Promise<string>>(); // 每個推播服務一次 run 簽一次
  const outcomes = await Promise.all(
    jobs.map(async ({ deliveryId, row }) => {
      const endpoint = row.endpoint as string;
      // 白名單發送前再驗一次（#1659）：不信 DB 裡存的值
      if (!isAllowedPushEndpoint(endpoint)) return { deliveryId, row, status: 'invalid' as const };
      try {
        const origin = new URL(endpoint).origin;
        if (!auths.has(origin))
          auths.set(origin, vapidAuthorization(endpoint, opts.vapid, opts.subject));
        const { url, init } = await buildPushRequest(
          { endpoint, keys: { p256dh: row.p256dh as string, auth: row.auth as string } },
          JSON.stringify(row.payload),
          {
            authorization: await auths.get(origin)!,
            ttl: TTL_SECONDS,
            topic: (row.payload as { topic?: string }).topic,
          },
        );
        return { deliveryId, row, status: (await send(url, init)).status };
      } catch (err) {
        console.error('[push] send failed:', err instanceof Error ? err.message : err);
        return { deliveryId, row, status: 0 };
      }
    }),
  );

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
      `UPDATE push_deliveries SET sent_at = now(), attempts = attempts + 1, last_error = NULL
       WHERE id = ANY($1::uuid[])`,
      [[...deliveredIds]],
    );
  }
  if (failed.length > 0) {
    await db.query(
      `UPDATE push_deliveries d SET attempts = d.attempts + 1, last_error = x.err
       FROM unnest($1::uuid[], $2::text[]) AS x(id, err) WHERE d.id = x.id`,
      [failed.map((f) => f.id), failed.map((f) => f.error)],
    );
  }
  if (noSubscription.length > 0) {
    await db.query(
      `UPDATE push_deliveries SET attempts = $2, last_error = 'NO_SUBSCRIPTION' WHERE id = ANY($1::uuid[])`,
      [noSubscription, MAX_ATTEMPTS],
    );
  }
  return {
    attempted: jobs.length,
    delivered: deliveredIds.size,
    removedSubscriptions: goneSubs.length,
  };
}

export async function runPush(pool: Pool, opts: PushRunOptions): Promise<PushRunResult> {
  return withTx(pool, async (db) => {
    const { rows } = await db.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1) AS locked',
      [RUN_LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      return {
        skipped: 'locked',
        enqueued: 0,
        attempted: 0,
        delivered: 0,
        removedSubscriptions: 0,
        purged: 0,
      };
    }
    const enqueued = await enqueue(db, opts.today);
    const sent = await sendBatch(db, opts);
    const { rowCount } = await db.query(
      `DELETE FROM push_deliveries WHERE created_at < now() - make_interval(days => $1)`,
      [RETENTION_DAYS],
    );
    return { enqueued, ...sent, purged: rowCount ?? 0 };
  });
}
