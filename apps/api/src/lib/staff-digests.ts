import type { PoolClient } from 'pg';

import { resolveCampusScope, type CampusScope } from './campus-scope';
import { invoiceInScope } from './invoice-campus-scope';
import { isOverdueOn } from './invoice-overdue';
import { deriveInvoiceStatus, isOpenInvoice, type PaymentRow } from './invoice-status';
import { promotionReminderDue } from './grade-promotion';
import { hasPermission } from './permissions';

/**
 * 管理員的兩則每日摘要（#1693）：逾期帳單、待開單。**只給有 `manage_finance` 的管理員**，
 * 張數照各人的分校範圍算；0 就不發。由通知排程（`runPush`）每個 run 呼叫，**一天只算一次**：
 * 今天已經排入過的 org 在第一句就跳過（計畫席 10-16：免費方案一次 Cron 只有 10ms CPU）。
 *
 * **判準不在 SQL 另寫一套**：SQL 只撈候選列，撈回來的形狀跟 PostgREST 的
 * `INVOICE_SCOPE_EMBED` 一樣，範圍、狀態、權限都交給既有的 `invoiceInScope`、
 * `deriveInvoiceStatus`、`resolveCampusScope`、`hasPermission`。待開單的判準同
 * `GET /api/billing-periods/upcoming-unbilled`。兩者對真 DB 的一致性由 `contract/staff-digests.contract.ts` 對照。
 *
 * 走 pg 而不是 supabase-js：逐人逐期數的話，subrequest 是「管理員 × 期 × 2」，一次 Cron 只有 50 個。
 */

type Orgs = string[] | null;

/** 讀不到設定時的天數，同 `billing-periods.ts` */
const DEFAULT_REMINDER_DAYS = 14;

interface Recipient {
  org_id: string;
  user_id: string;
  roles: string[];
  permissions: string[];
  campus_ids: string[];
}

export interface OverdueCandidate {
  org_id: string;
  due_date: string;
  items: Array<{ amount: number | string }>;
  payments: Array<{ kind: PaymentRow['kind']; amount: number | string }>;
  scope_student: unknown;
  scope_items: unknown;
}

export interface UpcomingPeriod {
  org_id: string;
  name: string;
  start_date: string;
  pending_all: number;
  pending_campus_ids: string[];
  billed_all: number;
  billed_campus_ids: string[];
}

/**
 * 今天兩則都已排入過的 org 不再算；回傳還要算的 org 與各自缺哪一則。
 * 鍵帶 org：唯一鍵是 (user_id, dedupe_key)，同一人在兩個 org 當管理員時不能互相擋掉
 */
const PENDING_ORGS_SQL = `
SELECT o.id AS org_id,
       NOT EXISTS (SELECT 1 FROM notifications n WHERE n.org_id = o.id AND n.dedupe_key = 'overdue_digest:' || o.id || ':' || $1) AS overdue,
       NOT EXISTS (SELECT 1 FROM notifications n WHERE n.org_id = o.id AND n.dedupe_key = 'unbilled_reminder:' || o.id || ':' || $1) AS unbilled
FROM organizations o
WHERE ($2::uuid[] IS NULL OR o.id = ANY($2))`;

/** 本 org、active、有 admin 角色的教職員；角色與權限是 user_roles 各列的聯集（同 middleware/auth.ts） */
const RECIPIENTS_SQL = `
SELECT st.org_id, st.user_id,
       array_agg(DISTINCT ur.role::text) AS roles,
       COALESCE((SELECT array_agg(p) FROM user_roles u2
                 CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(u2.permissions, '[]'::jsonb)) AS p
                 WHERE u2.user_id = st.user_id), '{}') AS permissions,
       COALESCE((SELECT array_agg(sc.campus_id) FROM staff_campuses sc WHERE sc.staff_id = st.id), '{}') AS campus_ids
FROM staff st
JOIN user_roles ur ON ur.user_id = st.user_id
WHERE st.status = 'active' AND st.org_id = ANY($1)
GROUP BY st.org_id, st.id, st.user_id
HAVING bool_or(ur.role = 'admin')`;

/**
 * 逾期候選：未作廢、過了到期日（`isOverdueOn`）。未繳清在 JS 判（`deriveInvoiceStatus`）。
 * `scope_student`／`scope_items` 的形狀同 `INVOICE_SCOPE_EMBED`（沒有報名的明細，enrollments 是 null）
 */
const OVERDUE_SQL = `
SELECT i.org_id, i.due_date::text AS due_date,
       COALESCE((SELECT json_agg(json_build_object('amount', ii.amount)) FROM invoice_items ii WHERE ii.invoice_id = i.id), '[]') AS items,
       COALESCE((SELECT json_agg(json_build_object('kind', pr.kind, 'amount', pr.amount))
                   FROM payment_records pr WHERE pr.invoice_id = i.id AND pr.org_id = i.org_id), '[]') AS payments,
       json_build_object('enrollments', COALESCE((
         SELECT json_agg(json_build_object('classes', json_build_object('campus_id', c.campus_id)))
         FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.student_id = i.student_id), '[]')) AS scope_student,
       COALESCE((
         SELECT json_agg(json_build_object('enrollments',
                  CASE WHEN e.id IS NULL THEN NULL
                       ELSE json_build_object('classes', json_build_object('campus_id', c.campus_id)) END))
         FROM invoice_items ii
         LEFT JOIN enrollments e ON e.id = ii.enrollment_id
         LEFT JOIN classes c ON c.id = e.class_id
         WHERE ii.invoice_id = i.id), '[]') AS scope_items
FROM invoices i
WHERE i.org_id = ANY($1) AND i.voided_at IS NULL AND i.due_date < $2::date`;

/**
 * 待開單的期（同 upcoming-unbilled）：今天 < 開始日 ≤ 今天＋N 天。
 * 該開的＝在讀的期繳報名與這期重疊；已開的＝這期未作廢帳單的學費明細。
 * 不分校的數字（`*_all`）給全分校的人；分校清單（經班）給受限的人在 JS 數 —— 同路由的 inner join
 */
const UNBILLED_SQL = `
SELECT bp.org_id, bp.name, bp.start_date::text AS start_date,
       (SELECT count(*)::int FROM enrollments e
         WHERE e.org_id = bp.org_id AND e.status = 'active' AND e.billing_mode = 'period'
           AND e.effective_from <= bp.end_date AND (e.effective_to IS NULL OR e.effective_to >= bp.start_date)) AS pending_all,
       COALESCE((SELECT array_agg(c.campus_id) FROM enrollments e JOIN classes c ON c.id = e.class_id
         WHERE e.org_id = bp.org_id AND e.status = 'active' AND e.billing_mode = 'period'
           AND e.effective_from <= bp.end_date AND (e.effective_to IS NULL OR e.effective_to >= bp.start_date)), '{}') AS pending_campus_ids,
       (SELECT count(*)::int FROM invoice_items ii
          JOIN invoices i ON i.id = ii.invoice_id AND i.org_id = bp.org_id AND i.voided_at IS NULL
         WHERE ii.billing_period_id = bp.id) AS billed_all,
       COALESCE((SELECT array_agg(c.campus_id) FROM invoice_items ii
          JOIN invoices i ON i.id = ii.invoice_id AND i.org_id = bp.org_id AND i.voided_at IS NULL
          JOIN enrollments e ON e.id = ii.enrollment_id JOIN classes c ON c.id = e.class_id
         WHERE ii.billing_period_id = bp.id), '{}') AS billed_campus_ids
FROM billing_periods bp
JOIN organizations o ON o.id = bp.org_id
WHERE bp.org_id = ANY($1) AND bp.start_date > $2::date
  AND bp.start_date <= $2::date + COALESCE(NULLIF(o.billing_reminder_days, 0), ${DEFAULT_REMINDER_DAYS})
ORDER BY bp.org_id, bp.start_date`;

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const countIn = (campusIds: readonly string[], scope: readonly string[]) =>
  campusIds.filter((c) => scope.includes(c)).length;

interface Digest {
  org_id: string;
  user_id: string;
  kind: 'overdue_digest' | 'unbilled_reminder';
  payload: { title: string; body: string; url: string };
}

/** 各管理員的逾期張數（範圍內、未繳清、過了到期日）；同一個範圍只算一次 */
export function overdueDigests(
  candidates: readonly OverdueCandidate[],
  recipients: ReadonlyArray<{ org_id: string; user_id: string; scope: CampusScope }>,
  today: string,
): Digest[] {
  const open = candidates.filter(
    (c) =>
      isOverdueOn(c.due_date, today) &&
      isOpenInvoice(
        deriveInvoiceStatus(
          c.items.map((a) => ({ amount: Number(a.amount) })),
          c.payments.map((p) => ({ kind: p.kind, amount: Number(p.amount) })),
          false, // 作廢的在 SQL 就濾掉了
        ),
      ),
  );
  const byScope = new Map<string, number>();
  return recipients.flatMap((r) => {
    const key = `${r.org_id}|${r.scope === null ? '*' : [...r.scope].sort().join(',')}`;
    let n = byScope.get(key);
    if (n === undefined) {
      n = open.filter(
        (c) =>
          c.org_id === r.org_id && invoiceInScope(c as unknown as Record<string, unknown>, r.scope),
      ).length;
      byScope.set(key, n);
    }
    if (n === 0) return [];
    return [
      {
        org_id: r.org_id,
        user_id: r.user_id,
        kind: 'overdue_digest' as const,
        payload: {
          title: '逾期帳單',
          body: `今天有 ${n} 張帳單逾期未繳清`,
          url: '/admin/payments?due=overdue',
        },
      },
    ];
  });
}

/** 各管理員範圍內「快開始、有該開的、還沒開」的期（同 upcoming-unbilled） */
export function unbilledDigests(
  periods: readonly UpcomingPeriod[],
  recipients: ReadonlyArray<{ org_id: string; user_id: string; scope: CampusScope }>,
  today: string,
): Digest[] {
  return recipients.flatMap((r) => {
    const due = periods.filter((p) => {
      if (p.org_id !== r.org_id) return false;
      const billed = r.scope === null ? p.billed_all : countIn(p.billed_campus_ids, r.scope);
      const pending = r.scope === null ? p.pending_all : countIn(p.pending_campus_ids, r.scope);
      return billed === 0 && pending > 0;
    });
    if (due.length === 0) return [];
    const first = due[0]!;
    const more = due.length > 1 ? `（另有 ${due.length - 1} 期）` : '';
    return [
      {
        org_id: r.org_id,
        user_id: r.user_id,
        kind: 'unbilled_reminder' as const,
        payload: {
          title: '待開單',
          body: `「${first.name}」${daysBetween(today, first.start_date)} 天後開始，還沒開單${more}`,
          url: '/admin/dashboard',
        },
      },
    ];
  });
}

/** 逾期候選（未作廢、過了到期日），形狀同 `INVOICE_SCOPE_EMBED` */
export async function fetchOverdueCandidates(
  db: PoolClient,
  orgIds: readonly string[],
  today: string,
): Promise<OverdueCandidate[]> {
  return (await db.query<OverdueCandidate>(OVERDUE_SQL, [orgIds, today])).rows;
}

/** 機構設定天數內開始的期，帶該開／已開的分校清單 */
export async function fetchUpcomingPeriods(
  db: PoolClient,
  orgIds: readonly string[],
  today: string,
): Promise<UpcomingPeriod[]> {
  return (await db.query<UpcomingPeriod>(UNBILLED_SQL, [orgIds, today])).rows;
}

/** 排入今天的兩則摘要，回寫進去的筆數。`today` 是台北日期（`getCurrentTaipeiDateString`） */
export async function enqueueStaffDigests(
  db: PoolClient,
  today: string,
  orgs: Orgs,
): Promise<number> {
  const { rows: pending } = await db.query<{ org_id: string; overdue: boolean; unbilled: boolean }>(
    PENDING_ORGS_SQL,
    [today, orgs],
  );
  const overdueOrgs = pending.filter((p) => p.overdue).map((p) => p.org_id);
  const unbilledOrgs = pending.filter((p) => p.unbilled).map((p) => p.org_id);
  if (overdueOrgs.length === 0 && unbilledOrgs.length === 0) return 0;

  const { rows: staff } = await db.query<Recipient>(RECIPIENTS_SQL, [
    [...new Set([...overdueOrgs, ...unbilledOrgs])],
  ]);
  const recipients = staff
    .filter((s) => hasPermission(s.permissions, 'manage_finance'))
    .map((s) => ({
      org_id: s.org_id,
      user_id: s.user_id,
      scope: resolveCampusScope({
        roles: s.roles,
        permissions: s.permissions,
        assignedCampusIds: s.campus_ids,
      }),
    }));
  // ponytail: 今天沒寫進任何一則的 org 不會留下鍵，所以每輪都重算：沒有財務管理員的 org 每輪多兩句
  // （排過沒＋收件人）；逾期單全在每個人範圍外的 org 還會再撈一次候選。升級做法：organizations 加
  // `staff_digest_checked_on date`（migration），算完不論有沒有寫都記今天，第一句改看它
  const overdueTo = recipients.filter((r) => overdueOrgs.includes(r.org_id));
  const unbilledTo = recipients.filter((r) => unbilledOrgs.includes(r.org_id));

  const digests: Digest[] = [];
  if (overdueTo.length > 0) {
    const rows = await fetchOverdueCandidates(
      db,
      [...new Set(overdueTo.map((r) => r.org_id))],
      today,
    );
    digests.push(...overdueDigests(rows, overdueTo, today));
  }
  if (unbilledTo.length > 0) {
    const rows = await fetchUpcomingPeriods(
      db,
      [...new Set(unbilledTo.map((r) => r.org_id))],
      today,
    );
    digests.push(...unbilledDigests(rows, unbilledTo, today));
  }
  if (digests.length === 0) return 0;

  const { rowCount } = await db.query(
    `INSERT INTO notifications (org_id, user_id, role, kind, dedupe_key, payload, push_status, push_error)
     SELECT x.org_id, x.user_id, 'admin', x.kind, x.kind::text || ':' || x.org_id || ':' || $5, x.payload,
            'skipped', 'ROLE_PUSH_DISABLED'
     FROM unnest($1::uuid[], $2::text[], $3::notification_kind[], $4::jsonb[])
       AS x(org_id, user_id, kind, payload)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
    [
      digests.map((d) => d.org_id),
      digests.map((d) => d.user_id),
      digests.map((d) => d.kind),
      digests.map((d) => JSON.stringify(d.payload)),
      today,
    ],
  );
  return rowCount ?? 0;
}

/** 開了升級前提醒的 org（天數 0＝關） */
const PROMOTION_ORGS_SQL = `
SELECT o.id AS org_id, o.grade_promotion_month_day AS month_day, o.grade_promotion_reminder_days AS days
FROM organizations o
WHERE o.grade_promotion_reminder_days > 0 AND ($1::uuid[] IS NULL OR o.id = ANY($1))`;

/** 進了提醒窗的 org 裡，這個升級日還沒排過、那一學年也還沒升（未復原）的 */
const PROMOTION_OPEN_SQL = `
SELECT x.org_id
FROM unnest($1::uuid[], $2::text[], $3::int[]) AS x(org_id, date, year)
WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.org_id = x.org_id
                    AND n.dedupe_key = 'grade_promotion_reminder:' || x.org_id || ':' || x.date)
  AND NOT EXISTS (SELECT 1 FROM grade_promotions g WHERE g.org_id = x.org_id
                    AND g.academic_year = x.year AND g.reverted_at IS NULL)`;

/**
 * 學年升級前提醒（#1820 設計稿 §2）：升級日前 `grade_promotion_reminder_days` 天內，提醒能執行升級的管理員
 * （`manage_students`＋`all_campuses`，同 `/api/grade-promotions` 的門檻，裁定 E）到設定預覽並執行。
 * **每個升級日一次**（鍵帶升級日，不帶今天）；那一學年已經升過就不提醒。跟摘要同一個管道：不推播、只進通知中心。
 *
 * 平常日子（沒有 org 在提醒窗裡）只多一句 `PROMOTION_ORGS_SQL`。
 */
export async function enqueueGradePromotionReminders(
  db: PoolClient,
  today: string,
  orgs: Orgs,
): Promise<number> {
  const { rows } = await db.query<{ org_id: string; month_day: string; days: number }>(
    PROMOTION_ORGS_SQL,
    [orgs],
  );
  const due = rows.flatMap((r) => {
    const hit = promotionReminderDue(r.month_day, r.days, today);
    return hit ? [{ org_id: r.org_id, ...hit }] : [];
  });
  if (due.length === 0) return 0;

  const { rows: open } = await db.query<{ org_id: string }>(PROMOTION_OPEN_SQL, [
    due.map((d) => d.org_id),
    due.map((d) => d.date),
    due.map((d) => d.academicYear),
  ]);
  const openIds = new Set(open.map((o) => o.org_id));
  const targets = due.filter((d) => openIds.has(d.org_id));
  if (targets.length === 0) return 0;

  const { rows: staff } = await db.query<Recipient>(RECIPIENTS_SQL, [targets.map((t) => t.org_id)]);
  const rowsToInsert = staff.flatMap((s) => {
    const scope = resolveCampusScope({
      roles: s.roles,
      permissions: s.permissions,
      assignedCampusIds: s.campus_ids,
    });
    if (!hasPermission(s.permissions, 'manage_students') || scope !== null) return [];
    const t = targets.find((x) => x.org_id === s.org_id)!;
    const day = `${Number(t.date.slice(5, 7))}/${Number(t.date.slice(8, 10))}`;
    return [
      {
        org_id: s.org_id,
        user_id: s.user_id,
        dedupe_key: `grade_promotion_reminder:${s.org_id}:${t.date}`,
        payload: {
          title: '學年升級',
          body:
            t.daysUntil === 0
              ? `今天是學年升級日（${day}），到設定預覽並執行`
              : `學年升級日（${day}）還有 ${t.daysUntil} 天，到設定預覽並執行`,
          url: '/admin/settings/general',
        },
      },
    ];
  });
  if (rowsToInsert.length === 0) return 0;

  const { rowCount } = await db.query(
    `INSERT INTO notifications (org_id, user_id, role, kind, dedupe_key, payload, push_status, push_error)
     SELECT x.org_id, x.user_id, 'admin', 'grade_promotion_reminder', x.dedupe_key, x.payload,
            'skipped', 'ROLE_PUSH_DISABLED'
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::jsonb[]) AS x(org_id, user_id, dedupe_key, payload)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
    [
      rowsToInsert.map((r) => r.org_id),
      rowsToInsert.map((r) => r.user_id),
      rowsToInsert.map((r) => r.dedupe_key),
      rowsToInsert.map((r) => JSON.stringify(r.payload)),
    ],
  );
  return rowCount ?? 0;
}
