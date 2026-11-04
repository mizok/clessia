import type { Pool } from 'pg';

import { withTx } from './pg-tx';

export type BatchSetActiveResult =
  | { readonly status: 'done'; readonly updatedIds: string[] }
  | { readonly status: 'not-found' }
  | { readonly status: 'forbidden' };

/**
 * 批次啟用／停用班級（`PATCH /api/classes/batch-set-active`），一筆交易（#2230 ①）。
 *
 * 照 `kb/wiki/architecture/pg-pool-writes.md`：交易一開始 `FOR UPDATE` 鎖住要動的班，**在交易裡**
 * 重做範圍判斷 —— 有一個不在本 org（含不存在）整批 not-found，有一個不在分校範圍整批 forbidden，
 * 什麼都不寫（語意同原本 #966 B2、#1797）。原本三支 PostgREST 的 `.in('id', ids)`（body 一大就 414），
 * 而且更新失敗回 `{ updated: 0 }` 200 —— 前端以為成功、其實沒動。失敗丟例外（路由回 500）。
 *
 * `campusScope` null＝不受分校限制；分校是 null 的班對受限管理員算範圍外（同原本）。
 */
export function batchSetClassesActive(
  pool: Pool,
  input: {
    readonly orgId: string;
    readonly ids: readonly string[];
    readonly isActive: boolean;
    readonly userId: string;
    readonly campusScope: readonly string[] | null;
  },
): Promise<BatchSetActiveResult> {
  const ids = [...new Set(input.ids)];
  return withTx(pool, async (db) => {
    const { rows } = await db.query(
      'select id, campus_id from public.classes where org_id = $1::uuid and id = any($2::uuid[]) for update',
      [input.orgId, ids],
    );
    const found = rows as Array<{ id: string; campus_id: string | null }>;
    if (found.length !== ids.length) return { status: 'not-found' };
    const scope = input.campusScope;
    if (scope && found.some((row) => !row.campus_id || !scope.includes(row.campus_id))) {
      return { status: 'forbidden' };
    }
    const updated = await db.query(
      `update public.classes set is_active = $3, updated_by = $4
        where org_id = $1::uuid and id = any($2::uuid[])
       returning id`,
      [input.orgId, ids, input.isActive, input.userId],
    );
    return {
      status: 'done',
      updatedIds: (updated.rows as Array<{ id: string }>).map((row) => row.id),
    };
  });
}
