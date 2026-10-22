import type { Pool, PoolClient } from 'pg';

import type { CampusScope } from './campus-scope';
import { withTx } from './pg-tx';

/**
 * 家長的孩子（`parent_student_relations`）寫入（#1843）。
 *
 * 原本 PUT 是「先刪全部、再插入」兩個 PostgREST 請求：插入失敗時刪除已經生效，
 * 這位家長的親子關聯全部消失。現在走一個交易（規則見 architecture/pg-pool-writes.md），
 * 而且**只動差集**：留著的關聯不刪不插，`is_primary`／`relation` 不會被洗掉。
 *
 * 新加的孩子要屬於本 org；受限管理員還要在自己的分校範圍（判準同 `studentWriteScope`：
 * 任一筆報名的班級在範圍內就算）。**留著的孩子不重驗範圍** —— 跨分校的孩子
 * 在詳情頁看得到，原樣存檔時不能因為它擋住整份表單。
 * **拿掉的孩子要驗範圍**（計畫席 10-22）：刪掉範圍外的關聯等於改到別校的資料。
 * 拿掉的只驗範圍、不驗 org —— 已經掛著的關聯，不受限的管理員要能拿掉，就算它指到別 org（舊的 POST 沒驗過）。
 */

export type ChildrenCheck = 'ok' | 'student-not-found' | 'out-of-scope';

type Queryable = Pick<PoolClient, 'query'>;

/** 這批學生能不能掛到家長名下。`ids` 已去重 */
export async function checkChildren(
  db: Queryable,
  orgId: string,
  scope: CampusScope,
  ids: readonly string[],
): Promise<ChildrenCheck> {
  if (ids.length === 0) return 'ok';
  const { rows: found } = await db.query<{ id: string }>(
    'SELECT id FROM students WHERE id = ANY($1::uuid[]) AND org_id = $2',
    [ids, orgId],
  );
  if (found.length !== ids.length) return 'student-not-found';
  return (await allInScope(db, orgId, scope, ids)) ? 'ok' : 'out-of-scope';
}

/** 這批學生是不是**全部**在受限管理員的範圍內（不受限一律 true）。`ids` 已去重 */
async function allInScope(
  db: Queryable,
  orgId: string,
  scope: CampusScope,
  ids: readonly string[],
): Promise<boolean> {
  if (scope === null || ids.length === 0) return true;
  if (scope.length === 0) return false;

  const { rows: inScope } = await db.query<{ student_id: string }>(
    `SELECT DISTINCT e.student_id FROM enrollments e
       JOIN classes c ON c.id = e.class_id
      WHERE e.student_id = ANY($1::uuid[]) AND e.org_id = $2 AND c.campus_id = ANY($3::uuid[])`,
    [ids, orgId, [...scope]],
  );
  return inScope.length === ids.length;
}

export type ReplaceChildrenOutcome =
  | { status: 'done'; added: string[]; removed: string[] }
  | { status: 'not-found' }
  | { status: 'student-not-found' }
  | { status: 'out-of-scope' };

/** 全量替換這位家長的孩子：一個交易，任何一步失敗整批回滾 */
export async function replaceParentChildren(
  pool: Pool,
  input: {
    readonly orgId: string;
    readonly parentId: string;
    readonly studentIds: readonly string[];
    readonly scope: CampusScope;
  },
): Promise<ReplaceChildrenOutcome> {
  const { orgId, parentId, scope } = input;
  const next = [...new Set(input.studentIds)];

  return withTx(pool, async (db) => {
    // 鎖住家長列：同時兩個人改同一位家長的孩子，後到的等前一個交易結束再算差集
    const { rows: parent } = await db.query(
      'SELECT id FROM parents WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [parentId, orgId],
    );
    if (parent.length === 0) return { status: 'not-found' } as const;

    const { rows: current } = await db.query<{ student_id: string }>(
      `SELECT r.student_id FROM parent_student_relations r
         JOIN parents p ON p.id = r.parent_id
        WHERE r.parent_id = $1 AND p.org_id = $2`,
      [parentId, orgId],
    );
    const had = new Set(current.map((r) => r.student_id));
    const added = next.filter((id) => !had.has(id));
    const removed = [...had].filter((id) => !next.includes(id));

    const check = await checkChildren(db, orgId, scope, added);
    if (check !== 'ok') return { status: check } as const;
    if (!(await allInScope(db, orgId, scope, removed))) return { status: 'out-of-scope' } as const;

    if (removed.length > 0) {
      await db.query(
        `DELETE FROM parent_student_relations r USING parents p
          WHERE r.parent_id = $1 AND p.id = r.parent_id AND p.org_id = $2
            AND r.student_id = ANY($3::uuid[])`,
        [parentId, orgId, removed],
      );
    }
    if (added.length > 0) {
      await db.query(
        `INSERT INTO parent_student_relations (parent_id, student_id, is_primary, relation)
         SELECT $1, s.id, false, NULL FROM students s
          WHERE s.id = ANY($3::uuid[]) AND s.org_id = $2`,
        [parentId, orgId, added],
      );
    }
    return { status: 'done', added, removed } as const;
  });
}
