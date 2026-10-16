import type { Pool, PoolClient } from 'pg';

import { deriveInvoiceStatus, isOpenInvoice, type PaymentRow } from './invoice-status';
import { withTx } from './pg-tx';
import { isAllowedPushEndpoint } from './push-endpoint';
import { enqueueStaffDigests } from './staff-digests';
import { buildPushRequest, vapidAuthorization, type VapidKeys } from './web-push';

/**
 * 通知排程的一次 run（#1661，#1626 改版；設計稿 kb/wiki/architecture/web-push.md §5）。
 *
 * **通知是一筆紀錄，推播只是送達管道**（使用者 10-16 17:04）：符合條件的家長每人一筆 `notifications`，
 * 在通知中心（#1683）算未讀 —— **不管有沒有開推播、有沒有關掉偏好**。推播在之後的認領才決定：
 * 沒有訂閱、或這一類的偏好關掉（偏好只管推播，Q-a）→ `skipped`，不算失敗、不重試。
 *
 * `push_status`：`pending → claimed → sent`；送失敗回到 `pending`（`push_attempts + 1`，滿三次 `failed`）；
 * `claimed` 超過 10 分鐘沒回寫＝那個 run 被砍了，重新開放（同樣 +1，滿三次 `failed`）。
 *
 * **走 pg pool，不用 supabase-js**：免費方案每次 Cron 只有 50 個 subrequest，supabase-js 走 HTTP、
 * 每句都算一個；推播本身就要用掉 K 個（pg-pool-writes.md 規則 1 的第二個理由）。
 * **對外 fetch 期間沒有交易開著**（規則 7，見 `runPush`）。
 *
 * 這是系統工作，不屬於任何一個使用者 —— **跨 org 跑**，每一句都用資料本身的 org_id 關聯
 * （帳單的 org → 家長的 org → 訂閱的 org），不收任何外部指定的對象。
 */

/** 每次 run 最多送幾台裝置。#1657 在免費方案量的：VAPID＋10 則加密中位數 4ms、最大 11ms */
export const DEFAULT_PUSH_BATCH_SIZE = 10;
/** 帳單提醒隔天才收到就沒意義（RFC 8030 §5.2） */
const TTL_SECONDS = 86400;
const MAX_ATTEMPTS = 3;
/** 通知（含通知中心裡沒讀的）保留 90 天（#1626 Q4、Q-b）—— 這支 run 負責清 */
const RETENTION_DAYS = 90;
/** 每一次對推播服務的 fetch 最多等多久；逾時算失敗，下一輪重試 */
export const SEND_TIMEOUT_MS = 5000;
/** 認領過了這麼久還沒回寫，就當那個 run 死了，重新開放。遠大於一次 run 的長度（送出最多約 5 秒） */
export const RECLAIM_AFTER_MINUTES = 10;
/**
 * 會推播的角色（白名單，計畫席 10-16 20:18 裁定）。老師、管理員第一版不推播、只進通知中心（#1693）：
 * 不在名單裡的，在 `skipUnreachable` 一律標 `skipped`／`ROLE_PUSH_DISABLED`，認領也不會拿到。
 * 寫入端（`lib/notify.ts`）照舊寫 skipped，是第二道防線。**之後要開放其他角色推播，只改這一份。**
 */
export const PUSH_ENABLED_ROLES: readonly string[] = ['parent'];

export interface PushRunOptions {
  /** 台北今天（`getCurrentTaipeiDateString()`），呼叫端決定 */
  readonly today: string;
  readonly batchSize: number;
  readonly vapid: VapidKeys;
  /** VAPID 的 `sub`（`mailto:` 補習班聯絡信箱） */
  readonly subject: string;
  /** 測試替身用；正式就是全域 fetch */
  readonly send?: (url: string, init: RequestInit) => Promise<{ status: number }>;
  /**
   * 只跑這幾個 org（契約測試用：共用的本機 DB 裡還有 seed 的帳單，全 org 跑會替它們產生通知）。
   * 正式不帶 = 全部 org。
   */
  readonly orgIds?: readonly string[];
}

export interface PushRunResult {
  /** 新產生的通知（通知中心看得到的） */
  readonly enqueued: number;
  /** 新產生的管理員每日摘要（#1693，不推播） */
  readonly digests: number;
  /** 不推播的（沒有訂閱或偏好關掉） */
  readonly skipped: number;
  readonly attempted: number;
  readonly delivered: number;
  readonly removedSubscriptions: number;
  readonly purged: number;
}

/** `null` = 全部 org（正式）；陣列 = 只跑這幾個（契約測試） */
type Orgs = string[] | null;

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
 * 今天要提醒的「帳單 × 時間點 × 家長」。這裡只做關聯與過濾（作廢、時間點、收件人）；
 * **不看訂閱、不看偏好** —— 那兩個只決定推不推播，通知照樣要有。
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
  AND ($2::uuid[] IS NULL OR org.id = ANY($2))`;

/** 鎖定畫面與通知中心都看得到 —— **不放金額**（#1626 Q3；排入當下寫好的金額之後也會過時） */
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

async function enqueue(db: PoolClient, today: string, orgs: Orgs): Promise<number> {
  const { rows } = await db.query<Candidate>(CANDIDATES_SQL, [today, orgs]);
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
    `INSERT INTO notifications (org_id, user_id, role, kind, dedupe_key, payload)
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

/** 失敗一次之後的狀態：還沒滿三次回 pending 重試，滿了就 failed */
const RETRY_OR_FAIL = `CASE WHEN push_attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END::push_status`;

/**
 * 上一個 run 認領後沒回寫（被砍了 —— 免費方案 CPU 超量會直接終止）的，重新開放給這一輪。
 * 算一次嘗試：一則若每次都讓 Worker 被砍，三次之後就 `failed`，不會永遠卡著後面的。
 * 被砍時可能其實已經送出 —— 那種情況會重送一次，由裝置端 `tag = topic` 合併（#1663）；比無聲漏掉好。
 */
async function reopenAbandoned(db: PoolClient, orgs: Orgs): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE notifications
     SET push_status = ${RETRY_OR_FAIL}, push_attempts = push_attempts + 1, push_error = 'CLAIM_EXPIRED'
     WHERE push_status = 'claimed' AND push_updated_at < now() - make_interval(mins => $1)
       AND ($2::uuid[] IS NULL OR org_id = ANY($2))`,
    [RECLAIM_AFTER_MINUTES, orgs],
  );
  return rowCount ?? 0;
}

/**
 * 不推播的直接標 `skipped`（一句、整批）：角色不在 `PUSH_ENABLED_ROLES`、沒有訂閱，
 * 或這一類的偏好關掉（偏好只管推播，Q-a）。
 * 先做這步，認領就只會拿到真的要推的 —— 不佔 K 的名額。
 */
async function skipUnreachable(db: PoolClient, orgs: Orgs): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE notifications n SET push_status = 'skipped', push_updated_at = now(),
       push_error = CASE
         WHEN NOT (n.role::text = ANY($2)) THEN 'ROLE_PUSH_DISABLED'
         WHEN NOT EXISTS (
           SELECT 1 FROM push_subscriptions s WHERE s.user_id = n.user_id AND s.org_id = n.org_id
         ) THEN 'NO_SUBSCRIPTION'
         ELSE 'PUSH_DISABLED' END
     WHERE n.push_status = 'pending' AND ($1::uuid[] IS NULL OR n.org_id = ANY($1))
       AND (NOT (n.role::text = ANY($2))
            OR NOT EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = n.user_id AND s.org_id = n.org_id)
            OR EXISTS (SELECT 1 FROM notification_preferences np
                       WHERE np.user_id = n.user_id AND np.org_id = n.org_id AND np.role = n.role
                         AND np.kind = n.kind AND NOT np.enabled))`,
    [orgs, PUSH_ENABLED_ROLES],
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
 * 認領（短交易內）：取 `pending` 最舊的幾則，`FOR UPDATE SKIP LOCKED` 讓同時跑的另一個 run 拿不到同一列，
 * 再標成 `claimed` —— 交易一結束鎖就放了，狀態讓下一個 run 也不碰它。
 */
async function claim(
  db: PoolClient,
  batchSize: number,
  orgs: Orgs,
): Promise<{ jobs: Job[]; skipped: number }> {
  const { rows } = await db.query<PendingRow>(
    `SELECT d.id, d.payload, s.id AS sub_id, s.endpoint, s.p256dh, s.auth
     FROM (SELECT id, user_id, org_id, payload, created_at FROM notifications
           WHERE push_status = 'pending' AND ($2::uuid[] IS NULL OR org_id = ANY($2))
             AND role::text = ANY($3)
           ORDER BY created_at, id LIMIT $1
           FOR UPDATE SKIP LOCKED) d
     LEFT JOIN push_subscriptions s ON s.user_id = d.user_id AND s.org_id = d.org_id
     ORDER BY d.created_at, d.id`,
    [batchSize, orgs, PUSH_ENABLED_ROLES],
  );

  // 依佇列順序把整則（含它所有裝置）放進這一批，直到裝置數用完；一則不拆到兩次 run
  const byDelivery = new Map<string, PendingRow[]>();
  for (const r of rows) byDelivery.set(r.id, [...(byDelivery.get(r.id) ?? []), r]);
  const noSubscription: string[] = [];
  const jobs: Job[] = [];
  for (const [id, subs] of byDelivery) {
    const devices = subs.filter((s) => s.sub_id !== null);
    if (devices.length === 0) {
      noSubscription.push(id); // skipUnreachable 之後訂閱才被刪：一樣不推
      continue;
    }
    if (jobs.length > 0 && jobs.length + devices.length > batchSize) break;
    for (const row of devices) jobs.push({ deliveryId: id, row });
  }

  const claimed = [...new Set(jobs.map((j) => j.deliveryId))];
  if (claimed.length > 0) {
    await db.query(
      `UPDATE notifications SET push_status = 'claimed', push_updated_at = now() WHERE id = ANY($1::uuid[])`,
      [claimed],
    );
  }
  if (noSubscription.length > 0) {
    await db.query(
      `UPDATE notifications SET push_status = 'skipped', push_updated_at = now(), push_error = 'NO_SUBSCRIPTION'
       WHERE id = ANY($1::uuid[])`,
      [noSubscription],
    );
  }
  return { jobs, skipped: noSubscription.length };
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

/** 回寫（短交易內）：送達 → `sent`；沒送達 → 回到 `pending`（滿三次 `failed`）並記錯誤 */
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
      `UPDATE notifications
       SET push_status = 'sent', push_updated_at = now(), push_attempts = push_attempts + 1, push_error = NULL
       WHERE id = ANY($1::uuid[])`,
      [[...deliveredIds]],
    );
  }
  if (failed.length > 0) {
    await db.query(
      `UPDATE notifications d
       SET push_status = ${RETRY_OR_FAIL},
           push_attempts = d.push_attempts + 1, push_error = x.err
       FROM unnest($1::uuid[], $2::text[]) AS x(id, err) WHERE d.id = x.id`,
      [failed.map((f) => f.id), failed.map((f) => f.error)],
    );
  }
  return { delivered: deliveredIds.size, removedSubscriptions: goneSubs.length };
}

/**
 * 管理員的每日摘要（#1693）。包在 SAVEPOINT 裡：它出錯只退它自己那段、只記 log，
 * 不能拖垮同一個交易裡家長的繳費提醒。
 */
async function staffDigests(db: PoolClient, today: string, orgs: Orgs): Promise<number> {
  await db.query('SAVEPOINT staff_digests');
  try {
    const n = await enqueueStaffDigests(db, today, orgs);
    await db.query('RELEASE SAVEPOINT staff_digests');
    return n;
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT staff_digests');
    console.error(
      '[notify] 管理員每日摘要失敗（繳費提醒照常）:',
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

/**
 * 三段，**對外 fetch 期間沒有任何交易開著**（計畫席 10-16：推播服務慢的話不能拖住交易與鎖；
 * 正式 DB 的 postgres 角色有沒有 idle_in_transaction／statement_timeout 沒有實查，這個形狀不依賴它）：
 *
 * 1. 短交易：重新開放被砍的 → 排入通知（去重鍵冪等）→ 管理員每日摘要（SAVEPOINT）→ 不推播的標 skipped →
 *    認領（這輪排入了摘要就跳過，留給下一輪）→ 清 90 天前的通知
 * 2. 交易外：送出，每次 fetch 逾時 `SEND_TIMEOUT_MS`；全部並行，所以整段最多約一個逾時長
 * 3. 短交易：回寫
 */
export async function runPush(pool: Pool, opts: PushRunOptions): Promise<PushRunResult> {
  const orgs: Orgs = opts.orgIds ? [...opts.orgIds] : null;
  const first = await withTx(pool, async (db) => {
    await reopenAbandoned(db, orgs);
    const enqueued = await enqueue(db, opts.today, orgs);
    const digests = await staffDigests(db, opts.today, orgs);
    const skippedUpfront = await skipUnreachable(db, orgs);
    // 這個 run 排入了摘要 → 先不認領推播，留給 10 分鐘後的下一輪（計畫席 10-16 裁）：
    // 一天一次的摘要再加上推播（#1657：最大 11ms），會超過免費方案一次 Cron 的 10ms。
    // 看的是「真的寫進去」而不是「有算」—— 沒有財務管理員的 org 每輪都會算一次，用後者推播會永遠送不出去
    const { jobs, skipped } =
      digests > 0 ? { jobs: [], skipped: 0 } : await claim(db, opts.batchSize, orgs);
    const { rowCount } = await db.query(
      `DELETE FROM notifications WHERE created_at < now() - make_interval(days => $1)
       AND ($2::uuid[] IS NULL OR org_id = ANY($2))`,
      [RETENTION_DAYS, orgs],
    );
    return { enqueued, digests, jobs, skipped: skippedUpfront + skipped, purged: rowCount ?? 0 };
  });
  const { enqueued, digests, jobs, skipped, purged } = first;
  if (jobs.length === 0) {
    return {
      enqueued,
      digests,
      skipped,
      attempted: 0,
      delivered: 0,
      removedSubscriptions: 0,
      purged,
    };
  }
  const outcomes = await send(jobs, opts);
  const written = await withTx(pool, (db) => writeBack(db, outcomes));
  return { enqueued, digests, skipped, attempted: jobs.length, ...written, purged };
}
