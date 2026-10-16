import type { Pool, PoolClient } from 'pg';

/**
 * 在一個 Postgres 交易裡跑 `fn`：成功 COMMIT，丟例外 ROLLBACK 後原樣丟出（#1652）。
 *
 * 經過連線池寫入的規則見 `kb/wiki/architecture/pg-pool-writes.md` —— 何時可以走這條、
 * SQL 一律參數化且帶 `org_id`、錯誤怎麼對成 HTTP。PostgREST 一次請求一個交易，
 * 要「全有或全無」的多步寫入只能走這裡（repo 刻意不引入 RPC，見 `sessions.ts` 的 09-06 裁定）。
 */
export async function withTx<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  let broken: Error | undefined;
  try {
    await db.query('BEGIN');
    const out = await fn(db);
    await db.query('COMMIT');
    return out;
  } catch (err) {
    // ROLLBACK 也失敗 = 連線壞了，release(err) 讓池丟掉它而不是把半個交易還回去
    await db.query('ROLLBACK').catch((e: unknown) => {
      broken = e instanceof Error ? e : new Error(String(e));
    });
    throw err;
  } finally {
    db.release(broken);
  }
}

/** 23503 = FK 違反：有別的資料還指著要刪的那一列 */
export function isFkViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === '23503';
}
