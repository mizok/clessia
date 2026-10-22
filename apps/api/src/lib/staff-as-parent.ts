import type { SupabaseClient } from '@supabase/supabase-js';
import type { Pool } from 'pg';

import type { CampusScope } from './campus-scope';
import { resolveDisplayName } from './display-name';
import { checkChildren } from './parent-children';
import { hasPermission, WILDCARD_PERMISSION } from './permissions';
import { withTx } from './pg-tx';

/**
 * 教職員兼家長：由行政在家長頁一次設定（#1844，使用者 10-22 選 A）。
 * 規格與判斷順序在 `kb/wiki/specs/admin/student-affairs/parents.md`
 * 「新增家長：Email／手機已是本機構教職員的帳號」，取代已移除的 `POST /api/me/activate-parent`。
 */

/** 用表單的 Email／手機對到的一個既有帳號（`ba_user` 一列＋它在本機構的身分） */
export interface ExistingAccount {
  readonly userId: string;
  /** `ba_user.orgId` */
  readonly orgId: string | null;
  /** `ba_user.name` */
  readonly accountName: string | null;
  readonly matchedBy: 'email' | 'phone';
  readonly roles: readonly string[];
  /** 本機構的 staff 列 */
  readonly staff: { readonly display_name: string | null; readonly status: string } | null;
  /** 本機構的 parents 列 */
  readonly parent: { readonly id: string; readonly name: string; readonly status: string } | null;
}

export type ExistingAccountVerdict =
  | { readonly kind: 'create' }
  | { readonly kind: 'link'; readonly userId: string; readonly staffName: string }
  | {
      readonly kind: 'reject';
      readonly status: 403 | 409;
      readonly code: string;
      readonly details?: Record<string, unknown>;
    };

const duplicate = (account: ExistingAccount): ExistingAccountVerdict => ({
  kind: 'reject',
  status: 409,
  code: account.matchedBy === 'email' ? 'DUPLICATE_EMAIL' : 'DUPLICATE_PHONE',
});

/**
 * 依規格那張表的順序判斷，第一個成立的就回。純函式，查詢在 `findExistingAccounts`。
 *
 * **別機構排第一**：不能跨機構接人，也不透露對方是誰或「有兩個帳號」。
 * **本人排在停用與確認之前**：沒權限把自己設成家長的人，不會先看到確認框。
 */
export function decideExistingAccount(
  accounts: readonly ExistingAccount[],
  ctx: {
    readonly orgId: string;
    readonly requesterUserId: string;
    readonly permissions: readonly string[];
  },
): ExistingAccountVerdict {
  if (accounts.length === 0) return { kind: 'create' };

  const otherOrg = accounts.find((a) => a.orgId !== ctx.orgId);
  if (otherOrg) return duplicate(otherOrg);

  if (new Set(accounts.map((a) => a.userId)).size > 1) {
    return { kind: 'reject', status: 409, code: 'ACCOUNT_CONFLICT' };
  }

  const account = accounts[0]!;
  if (account.roles.includes('kiosk')) return duplicate(account);

  if (account.parent) {
    return {
      kind: 'reject',
      status: 409,
      code: 'PARENT_ALREADY_EXISTS',
      details: {
        parentId: account.parent.id,
        status: account.parent.status,
        name: account.parent.name,
      },
    };
  }

  // 沒有教職員身分的本機構帳號（孤兒等）：不在 #1844 範圍，維持現狀
  if (!account.staff) return duplicate(account);

  // Q3：比照 #1829 —— 改自己只有持有 `*` 的人可以（hasPermission 對 `*` 只在本身持有時成立）
  if (
    account.userId === ctx.requesterUserId &&
    !hasPermission(ctx.permissions, WILDCARD_PERMISSION)
  ) {
    return { kind: 'reject', status: 403, code: 'SELF_LINK_FORBIDDEN' };
  }

  const staffName =
    resolveDisplayName({ staff: account.staff, baUser: { name: account.accountName } }) || '家長'; // ponytail: 兩處都空才走到，parents.name NOT NULL

  if (account.staff.status !== 'active') {
    return { kind: 'reject', status: 409, code: 'STAFF_NOT_ACTIVE', details: { staffName } };
  }

  return { kind: 'link', userId: account.userId, staffName };
}

/**
 * 用 Email（精確比對、小寫）與手機（`phone` 或 `username`，同 batch-import）找既有帳號。
 * `ba_*` 只讀（c2）。同一個帳號被兩邊都對到時只算一次。
 */
export async function findExistingAccounts(
  supabase: SupabaseClient,
  orgId: string,
  contact: { readonly email?: string; readonly phone?: string },
): Promise<ExistingAccount[]> {
  const email = contact.email?.trim().toLowerCase();
  const phone = contact.phone?.trim();
  const ors: string[] = [];
  if (email) ors.push(`email.eq.${quote(email)}`);
  if (phone) ors.push(`phone.eq.${quote(phone)}`, `username.eq.${quote(phone)}`);
  if (ors.length === 0) return [];

  const { data, error } = await supabase
    .from('ba_user')
    .select('id, orgId, name, email, phone, username')
    .or(ors.join(','));
  if (error) throw new Error(`findExistingAccounts failed: ${error.message}`);
  const users = (data ?? []) as Array<{
    id: string;
    orgId: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    username: string | null;
  }>;
  if (users.length === 0) return [];

  const ids = users.map((u) => u.id);
  const [roles, staff, parents] = await Promise.all([
    supabase.from('user_roles').select('user_id, role').in('user_id', ids),
    supabase
      .from('staff')
      .select('user_id, display_name, status')
      .eq('org_id', orgId)
      .in('user_id', ids),
    supabase
      .from('parents')
      .select('id, user_id, name, status')
      .eq('org_id', orgId)
      .in('user_id', ids),
  ]);
  for (const r of [roles, staff, parents]) {
    if (r.error) throw new Error(`findExistingAccounts failed: ${r.error.message}`);
  }
  const byUser = <T extends { user_id: string }>(rows: unknown) =>
    new Map(((rows ?? []) as T[]).map((row) => [row.user_id, row]));
  const staffBy = byUser<{ user_id: string; display_name: string | null; status: string }>(
    staff.data,
  );
  const parentBy = byUser<{ user_id: string; id: string; name: string; status: string }>(
    parents.data,
  );
  const rolesOf = (id: string) =>
    ((roles.data ?? []) as Array<{ user_id: string; role: string }>)
      .filter((r) => r.user_id === id)
      .map((r) => r.role);

  return users.map((u) => {
    const s = staffBy.get(u.id);
    const p = parentBy.get(u.id);
    return {
      userId: u.id,
      orgId: u.orgId,
      accountName: u.name,
      matchedBy: email && u.email?.toLowerCase() === email ? 'email' : 'phone',
      roles: rolesOf(u.id),
      staff: s ? { display_name: s.display_name, status: s.status } : null,
      parent: p ? { id: p.id, name: p.name, status: p.status } : null,
    };
  });
}

const quote = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

export type LinkOutcome =
  | { readonly status: 'done'; readonly parent: Record<string, unknown> }
  | { readonly status: 'already-parent' }
  | { readonly status: 'student-not-found' }
  | { readonly status: 'out-of-scope' };

/**
 * 一個交易：驗孩子（#1843 的 `checkChildren`）→ 建 parents 列 → 加 parent 角色 → 建關聯。
 * 任一步失敗整筆 ROLLBACK。同時兩個人設同一個帳號：後到的撞 (user_id, org_id) 唯一鍵 → `already-parent`。
 */
export async function linkStaffAsParent(
  pool: Pool,
  input: {
    readonly orgId: string;
    readonly userId: string;
    readonly name: string;
    readonly notes: string | null;
    readonly studentIds: readonly string[];
    readonly scope: CampusScope;
  },
): Promise<LinkOutcome> {
  const studentIds = [...new Set(input.studentIds)];
  try {
    return await withTx<LinkOutcome>(pool, async (db) => {
      const check = await checkChildren(db, input.orgId, input.scope, studentIds);
      if (check !== 'ok') return { status: check };

      const { rows } = await db.query<Record<string, unknown>>(
        `INSERT INTO parents (user_id, org_id, name, notes, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
        [input.userId, input.orgId, input.name, input.notes],
      );
      await db.query(
        `INSERT INTO user_roles (user_id, role, permissions) VALUES ($1, 'parent', '[]'::jsonb)
         ON CONFLICT (user_id, role) DO NOTHING`,
        [input.userId],
      );
      if (studentIds.length > 0) {
        await db.query(
          `INSERT INTO parent_student_relations (parent_id, student_id, is_primary, relation)
           SELECT $1, unnest($2::uuid[]), false, NULL`,
          [rows[0]!['id'], studentIds],
        );
      }
      return { status: 'done', parent: rows[0]! };
    });
  } catch (err) {
    // 23505 = 唯一鍵衝突：parents (user_id, org_id) 已經被另一個請求建了
    if ((err as { code?: unknown } | null)?.code === '23505') return { status: 'already-parent' };
    throw err;
  }
}
