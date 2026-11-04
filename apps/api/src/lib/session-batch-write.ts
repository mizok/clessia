import type { Pool } from 'pg';

import { withTx } from './pg-tx';

/**
 * 課堂批次的寫入（#2232）：改課堂＋寫 `schedule_changes` 流水，**同一筆交易**、id 用 `= any($2::uuid[])` 傳，
 * 不放進 URL。六支 `PATCH /sessions/batch-*` 共用。
 *
 * **為什麼走池**（`kb/wiki/architecture/pg-pool-writes.md` 規則 1）：
 * - 原本 `.update().in('id', 勾到的 id)` 把整串 id 放在 URL，~200 堂就 414（#1928）
 * - 勾到的 id 是使用者選的，不是範圍清單，embed 換不掉；分段送 URL 會失去原子性 —— 前幾段改了、
 *   後面失敗，已改的那幾堂沒有流水，重試時又被當成「已經改過」略過，紀錄永遠補不回來
 * - 原本「先改課堂、再寫流水、流水失敗就補償改回」也是兩步非交易；同一筆交易後不用補償
 *
 * 「哪幾堂可以改」照舊在交易外算（REST 查詢分段，`lib/in-chunks.ts`）；這裡只寫。每句帶 `org_id`（c1）。
 * 失敗丟例外（整筆回滾），呼叫端對成 HTTP：`23505`（同班同時段撞堂）→ 409，其他 → 500。
 */

/** 可以改的欄位與型別（白名單：欄名不吃外部字串） */
const CAST = {
  teacher_id: '::uuid',
  assignment_status: '::public.session_assignment_status',
  start_time: '::time',
  end_time: '::time',
  session_date: '::date',
  status: '::text',
} as const;
type SessionColumn = keyof typeof CAST;

export interface SessionUpdate {
  readonly ids: readonly string[];
  readonly set: Partial<Record<SessionColumn, string | null>>;
}

export async function writeSessionBatch(
  pool: Pool,
  orgId: string,
  p: {
    /** 依序執行（改到別天要照順序搬，才不會中途撞到同班同時段的唯一鍵） */
    readonly updates: readonly SessionUpdate[];
    /** `schedule_changes` 的列（欄名同表）；不給就不寫 */
    readonly changes?: readonly Record<string, unknown>[];
  },
): Promise<void> {
  await withTx(pool, async (db) => {
    for (const u of p.updates) {
      if (u.ids.length === 0) continue;
      const cols = Object.keys(u.set) as SessionColumn[];
      if (cols.length === 0 || cols.some((col) => !(col in CAST))) {
        throw new Error(`writeSessionBatch：不能改的欄位 ${cols.join(',')}`);
      }
      const sets = cols.map((col, i) => `${col} = $${i + 3}${CAST[col]}`).join(', ');
      await db.query(
        `update public.sessions set ${sets} where org_id = $1::uuid and id = any($2::uuid[])`,
        [orgId, [...u.ids], ...cols.map((col) => u.set[col] ?? null)],
      );
    }
    const changes = p.changes ?? [];
    if (changes.length > 0) {
      const cols = [...new Set(changes.flatMap((row) => Object.keys(row)))];
      if (cols.some((col) => !/^[a-z_]+$/.test(col))) {
        throw new Error(`writeSessionBatch：流水欄名不合法 ${cols.join(',')}`);
      }
      const list = cols.join(', ');
      // 每列都帶 org_id（流水是每列寫進去的，不是從 $1 推）
      if (changes.some((row) => row['org_id'] !== orgId)) {
        throw new Error('writeSessionBatch：流水的 org_id 跟這次請求不同');
      }
      await db.query(
        `insert into public.schedule_changes (${list})
         select ${list} from json_populate_recordset(null::public.schedule_changes, $1::json)`,
        [JSON.stringify(changes)],
      );
    }
  });
}
