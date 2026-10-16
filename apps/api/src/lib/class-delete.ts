import type { Pool } from 'pg';

import type { CampusScope } from './campus-scope';
import { isFkViolation, withTx } from './pg-tx';
import { getCurrentTaipeiDateString } from './taipei-date';

/**
 * 刪班級 —— 單筆與批次**共用**這一支，範圍判斷與守門只有這一份（#1652）。
 *
 * 一個交易裡：
 * 1. `FOR UPDATE` 鎖班級，同時確認在 org 內、在 campusScope 內 —— 任何一個不符整批 not-found
 *    （範圍外跟不存在一樣，c1）。鎖住之後別人插不進新的報名／課堂（FK 檢查要等這把鎖）。
 * 2. 鎖報名：新的 session_pack 一樣插不進來。
 * 3. 守門：
 *    - 報名有帳單明細指著（**含已作廢的單**；`invoice_items.enrollment_id` 是 SET NULL，
 *      不擋就會默默斷鏈）→ **不論模式整批不刪**，回 `has-invoice-items` 標出哪幾班（使用者 10-16 裁定）
 *    - 有過去課堂（台北今天之前，或 completed）、報名有堂數包 → `abort`（單筆）什麼都不刪；
 *      `skip`（批次）略過被擋的，刪其餘。
 * 4. 刪報名（`enrollments.class_id` 是 RESTRICT，非刪不可）再刪班級；sessions／schedules 等
 *    由 CASCADE 帶走。
 *
 * FK 擋下（23503）整筆回滾回 `in-use`；其他錯誤原樣丟出（呼叫端回 500）。
 */
export type ClassDeleteOutcome =
  | { readonly status: 'not-found' }
  | { readonly status: 'in-use' }
  | { readonly status: 'has-invoice-items'; readonly classIds: string[] }
  | {
      readonly status: 'done';
      readonly deletedIds: string[];
      readonly pastSessionIds: string[];
      readonly sessionPackIds: string[];
    };

export async function deleteClasses(
  pool: Pool,
  input: {
    readonly orgId: string;
    readonly ids: readonly string[];
    readonly scope: CampusScope;
    readonly onBlocked: 'abort' | 'skip';
  },
): Promise<ClassDeleteOutcome> {
  const ids = [...new Set(input.ids)];
  const { orgId, scope } = input;
  try {
    return await withTx(pool, async (db) => {
      const { rows: found } = await db.query<{ id: string; campus_id: string }>(
        'SELECT id, campus_id FROM classes WHERE id = ANY($1::uuid[]) AND org_id = $2 FOR UPDATE',
        [ids, orgId],
      );
      const inScope = found.filter((r) => scope === null || scope.includes(r.campus_id));
      if (inScope.length !== ids.length) return { status: 'not-found' } as const;

      await db.query(
        'SELECT id FROM enrollments WHERE class_id = ANY($1::uuid[]) AND org_id = $2 FOR UPDATE',
        [ids, orgId],
      );
      const { rows: billed } = await db.query<{ class_id: string }>(
        `SELECT DISTINCT e.class_id FROM invoice_items ii
         JOIN enrollments e ON e.id = ii.enrollment_id
         JOIN invoices i ON i.id = ii.invoice_id
         WHERE e.class_id = ANY($1::uuid[]) AND e.org_id = $2 AND i.org_id = $2`,
        [ids, orgId],
      );
      if (billed.length > 0) {
        return { status: 'has-invoice-items', classIds: billed.map((r) => r.class_id) } as const;
      }

      const { rows: past } = await db.query<{ class_id: string }>(
        `SELECT DISTINCT class_id FROM sessions
         WHERE class_id = ANY($1::uuid[]) AND org_id = $2
           AND (session_date < $3::date OR status = 'completed')`,
        [ids, orgId, getCurrentTaipeiDateString()],
      );
      const { rows: packs } = await db.query<{ class_id: string }>(
        `SELECT DISTINCT e.class_id FROM session_packs p
         JOIN enrollments e ON e.id = p.enrollment_id
         WHERE e.class_id = ANY($1::uuid[]) AND e.org_id = $2 AND p.org_id = $2`,
        [ids, orgId],
      );
      const pastSessionIds = past.map((r) => r.class_id);
      const sessionPackIds = packs.map((r) => r.class_id);
      const blocked = new Set([...pastSessionIds, ...sessionPackIds]);
      const toDelete =
        input.onBlocked === 'abort' && blocked.size > 0 ? [] : ids.filter((id) => !blocked.has(id));

      if (toDelete.length > 0) {
        await db.query('DELETE FROM enrollments WHERE class_id = ANY($1::uuid[]) AND org_id = $2', [
          toDelete,
          orgId,
        ]);
        await db.query('DELETE FROM classes WHERE id = ANY($1::uuid[]) AND org_id = $2', [
          toDelete,
          orgId,
        ]);
      }
      return { status: 'done', deletedIds: toDelete, pastSessionIds, sessionPackIds } as const;
    });
  } catch (err) {
    if (isFkViolation(err)) return { status: 'in-use' };
    throw err;
  }
}
