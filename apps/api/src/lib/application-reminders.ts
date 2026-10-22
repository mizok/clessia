import type { PoolClient } from 'pg';

import { resolveCampusScope, type CampusScope } from './campus-scope';
import { hasPermission } from './permissions';
import { RECIPIENTS_SQL, type Recipient } from './staff-digests';

/**
 * 報名審核時效與試聽跟進提醒（#1821，設計稿 `kb/wiki/specs/admin/enrollment/application-reminders.md`，已裁定）。
 *
 * - **申請放太久**（`application_overdue`）：家長端報名／試聽申請 `pending`、公開表單 `new`，
 *   送出（台北日期）已滿 `application_review_days` 天。候補（`waitlist`）不算（裁定 A）。
 * - **試聽後還沒報名**（`trial_followup`）：家長端試聽 `scheduled`／`completed`，試聽日已過 `trial_followup_days` 天，
 *   而且這個學生在這門課底下沒有在讀／待繳費的報名、也沒有還在走的報名申請。公開表單的試聽沒有試聽日，不做（裁定 B）。
 * - 天數 0＝關（裁定 C）；每張申請每個階段一次（裁定 D），去重鍵帶階段＋來源表＋申請 id（§4）。
 * - 收件人同 `application_received`：申請所在分校、有 `manage_students` 的管理員。不推播、只進通知中心。
 *
 * **日期門檻與「發過了沒」都在第一句 SQL 篩掉**（計畫席 10-22）：鍵不帶日期，沒辦法像每日摘要那樣用今天的鍵整個 org 跳過；
 * 平常每輪回 0 列，只多這一句。
 */

/**
 * 只看最近 30 天送出的申請（試聽跟進看試聽日）—— 上線那一刻不能把幾十則舊申請一次塞進每位管理員的通知中心
 * （計畫席 10-22 裁）。放更久的在收件頁本來就看得到。
 * ponytail: 寫死 30 天；要讓機構自己調就改成 organizations 的設定欄位（migration）
 */
export const LOOKBACK_DAYS = 30;

type Orgs = string[] | null;

export interface ReminderCandidate {
  stage: 'overdue' | 'trial_followup';
  dedupe_key: string;
  org_id: string;
  kind: 'enrollment' | 'trial';
  student_name: string;
  /** 送出日（台北），`YYYY-MM-DD` */
  sent_on: string;
  /** 試聽日；只有試聽跟進有 */
  trial_on: string | null;
  course_name: string | null;
  campus_ids: string[];
}

/**
 * 候選：各來源「沒處理」與「試聽後還沒報名」，已經在門檻內、還沒發過的。
 * `$1` 今天（台北）、`$2` org 範圍（null＝全部）、`$3` 回看天數。
 * ponytail: 沒有收件人的申請（分校沒有 manage_students 的管理員）不會留下鍵，每輪會被重撈一次 —— 只吃一點 CPU；
 * 升級做法同 staff-digests.ts（organizations 記「今天算過了」的日期欄）
 */
const CANDIDATES_SQL = `
WITH o AS (
  SELECT id, application_review_days AS review, trial_followup_days AS followup
  FROM organizations
  WHERE ($2::uuid[] IS NULL OR id = ANY($2)) AND (application_review_days > 0 OR trial_followup_days > 0)
),
c AS (
  SELECT 'overdue' AS stage, 'overdue:parent_request:enrollment:' || er.id AS dedupe_key, er.org_id,
         'enrollment' AS kind, s.name AS student_name, (er.created_at AT TIME ZONE 'Asia/Taipei')::date AS sent_on,
         NULL::date AS trial_on, NULL::text AS course_name, ARRAY[cl.campus_id] AS campus_ids
  FROM enrollment_requests er
  JOIN o ON o.id = er.org_id AND o.review > 0
  JOIN students s ON s.id = er.student_id AND s.org_id = er.org_id
  JOIN classes cl ON cl.id = er.class_id AND cl.org_id = er.org_id
  WHERE er.status = 'pending'
    AND (er.created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN $1::date - $3::int AND $1::date - o.review
  UNION ALL
  SELECT 'overdue', 'overdue:parent_request:trial:' || tr.id, tr.org_id,
         'trial', s.name, (tr.created_at AT TIME ZONE 'Asia/Taipei')::date,
         NULL::date, NULL::text, ARRAY[co.campus_id]
  FROM trial_requests tr
  JOIN o ON o.id = tr.org_id AND o.review > 0
  JOIN students s ON s.id = tr.student_id AND s.org_id = tr.org_id
  JOIN courses co ON co.id = tr.course_id AND co.org_id = tr.org_id
  WHERE tr.status = 'pending'
    AND (tr.created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN $1::date - $3::int AND $1::date - o.review
  UNION ALL
  SELECT 'overdue', 'overdue:application:' || pa.id, pa.org_id,
         pa.kind::text, pa.student_name, (pa.created_at AT TIME ZONE 'Asia/Taipei')::date,
         NULL::date, NULL::text,
         COALESCE((SELECT array_agg(DISTINCT COALESCE(cl.campus_id, co.campus_id))
                   FROM public_application_targets t
                   LEFT JOIN classes cl ON cl.id = t.class_id AND cl.org_id = pa.org_id
                   LEFT JOIN courses co ON co.id = t.course_id AND co.org_id = pa.org_id
                   WHERE t.application_id = pa.id AND COALESCE(cl.campus_id, co.campus_id) IS NOT NULL), '{}')
  FROM public_applications pa
  JOIN o ON o.id = pa.org_id AND o.review > 0
  WHERE pa.status = 'new'
    AND (pa.created_at AT TIME ZONE 'Asia/Taipei')::date BETWEEN $1::date - $3::int AND $1::date - o.review
  UNION ALL
  SELECT 'trial_followup', 'trial_followup:parent_request:' || tr.id, tr.org_id,
         'trial', s.name, (tr.created_at AT TIME ZONE 'Asia/Taipei')::date,
         tr.scheduled_date, co.name, ARRAY[co.campus_id]
  FROM trial_requests tr
  JOIN o ON o.id = tr.org_id AND o.followup > 0
  JOIN students s ON s.id = tr.student_id AND s.org_id = tr.org_id
  JOIN courses co ON co.id = tr.course_id AND co.org_id = tr.org_id
  WHERE tr.status IN ('scheduled', 'completed')
    AND tr.scheduled_date BETWEEN $1::date - $3::int AND $1::date - o.followup
    AND NOT EXISTS (SELECT 1 FROM enrollments e JOIN classes cl ON cl.id = e.class_id
                    WHERE e.org_id = tr.org_id AND e.student_id = tr.student_id AND cl.course_id = tr.course_id
                      AND e.status IN ('active', 'pending_payment'))
    AND NOT EXISTS (SELECT 1 FROM enrollment_requests r JOIN classes cl ON cl.id = r.class_id
                    WHERE r.org_id = tr.org_id AND r.student_id = tr.student_id AND cl.course_id = tr.course_id
                      AND r.status IN ('pending', 'waitlist', 'awaiting_payment'))
)
SELECT c.stage, c.dedupe_key, c.org_id, c.kind, c.student_name, c.sent_on::text AS sent_on,
       c.trial_on::text AS trial_on, c.course_name, c.campus_ids
FROM c
WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.org_id = c.org_id AND n.dedupe_key = c.dedupe_key)`;

interface ReminderRow {
  org_id: string;
  user_id: string;
  kind: 'application_overdue' | 'trial_followup';
  dedupe_key: string;
  payload: { title: string; body: string; url: string };
}

const monthDay = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * 每個候選 × 收件人一則。收件人＝`manage_students` 而且分校範圍跟申請的分校有交集（`null`＝全分校），
 * 同 `adminsForCampuses` 的判準；申請找不到分校（公開表單沒有指到班或課）就沒有人收，同 `notifyNewApplication`。
 * 文案跟「新申請」分開（設計稿 §4）：標題不用「新的」開頭。
 */
export function reminderNotifications(
  candidates: readonly ReminderCandidate[],
  recipients: ReadonlyArray<{
    org_id: string;
    user_id: string;
    permissions: readonly string[];
    scope: CampusScope;
  }>,
  today: string,
): ReminderRow[] {
  const eligible = recipients.filter((r) => hasPermission(r.permissions, 'manage_students'));
  return candidates.flatMap((c) => {
    const label = c.kind === 'enrollment' ? '報名' : '試聽';
    const payload =
      c.stage === 'overdue'
        ? {
            title: `${label}申請已經 ${daysBetween(c.sent_on, today)} 天沒處理`,
            body: `${c.student_name}・${monthDay(c.sent_on)} 送出，還在待處理`,
            url: `/admin/applications?kind=${c.kind}`,
          }
        : {
            title: '試聽後還沒報名',
            body: `${c.student_name} ${monthDay(c.trial_on!)} 試聽${c.course_name}，還沒報名，記得跟進`,
            url: '/admin/applications?kind=trial',
          };
    const kind =
      c.stage === 'overdue' ? ('application_overdue' as const) : ('trial_followup' as const);
    return eligible
      .filter(
        (r) =>
          r.org_id === c.org_id &&
          c.campus_ids.length > 0 &&
          (r.scope === null || r.scope.some((id) => c.campus_ids.includes(id))),
      )
      .map((r) => ({
        org_id: c.org_id,
        user_id: r.user_id,
        kind,
        dedupe_key: c.dedupe_key,
        payload,
      }));
  });
}

/** 排入申請提醒，回寫進去的筆數。`today` 是台北日期（`getCurrentTaipeiDateString`） */
export async function enqueueApplicationReminders(
  db: PoolClient,
  today: string,
  orgs: Orgs,
): Promise<number> {
  const { rows: candidates } = await db.query<ReminderCandidate>(CANDIDATES_SQL, [
    today,
    orgs,
    LOOKBACK_DAYS,
  ]);
  if (candidates.length === 0) return 0;

  const { rows: staff } = await db.query<Recipient>(RECIPIENTS_SQL, [
    [...new Set(candidates.map((c) => c.org_id))],
  ]);
  const rows = reminderNotifications(
    candidates,
    staff.map((s) => ({
      org_id: s.org_id,
      user_id: s.user_id,
      permissions: s.permissions,
      scope: resolveCampusScope({
        roles: s.roles,
        permissions: s.permissions,
        assignedCampusIds: s.campus_ids,
      }),
    })),
    today,
  );
  if (rows.length === 0) return 0;

  const { rowCount } = await db.query(
    `INSERT INTO notifications (org_id, user_id, role, kind, dedupe_key, payload, push_status, push_error)
     SELECT x.org_id, x.user_id, 'admin', x.kind, x.dedupe_key, x.payload, 'skipped', 'ROLE_PUSH_DISABLED'
     FROM unnest($1::uuid[], $2::text[], $3::notification_kind[], $4::text[], $5::jsonb[])
       AS x(org_id, user_id, kind, dedupe_key, payload)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
    [
      rows.map((r) => r.org_id),
      rows.map((r) => r.user_id),
      rows.map((r) => r.kind),
      rows.map((r) => r.dedupe_key),
      rows.map((r) => JSON.stringify(r.payload)),
    ],
  );
  return rowCount ?? 0;
}
