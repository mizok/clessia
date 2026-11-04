/**
 * 課堂批次寫入（`lib/session-batch-write.ts`，#2232）單元測試用的 pg pool 替身。
 *
 * 寫入改成經 pool 的一筆交易（`update … where org_id = $1 and id = any($2)`＋`insert into schedule_changes`）。
 * 這個替身把那兩種語句**翻成同一個 supabase 替身上等價的 REST 呼叫**（`.update(set).eq('org_id').in('id')`、
 * `.insert(rows)`），所以既有 spec 對更新內容、流水內容的斷言照樣有意義；替身回的 error 會變成丟例外（帶 `code`）。
 *
 * **SQL 本身的語意（org 條件、交易回滾、唯一鍵）這裡驗不出來**，由 `contract/session-batch-chunks-2232.contract.ts`
 * 對真 Postgres 驗。認不得的語句直接丟錯，免得新加的 SQL 被靜靜吞掉。
 */

interface SupabaseLike {
  from(table: string): unknown;
}

interface Chain extends PromiseLike<{ error: { message?: string; code?: string } | null }> {
  update(values: unknown): Chain;
  insert(rows: unknown): Chain;
  eq(column: string, value: unknown): Chain;
  in(column: string, values: unknown): Chain;
}

export interface RestBackedSessionBatchPool {
  readonly query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  readonly connect: () => Promise<{
    query: RestBackedSessionBatchPool['query'];
    release: (err?: unknown) => void;
  }>;
  readonly end: () => Promise<void>;
  /** 每一句經過 pool 的 SQL 第一行（含 BEGIN／COMMIT／ROLLBACK） */
  readonly statements: string[];
}

const UPDATE =
  /^update public\.sessions set (.+) where org_id = \$1::uuid and id = any\(\$2::uuid\[\]\)$/s;

export function restBackedSessionBatchPool(supabase: SupabaseLike): RestBackedSessionBatchPool {
  const statements: string[] = [];
  const fail = (error: { message?: string; code?: string }) =>
    Object.assign(new Error(error.message ?? 'db error'), { code: error.code });
  const query = async (sql: string, params: unknown[] = []) => {
    const text = sql.trim();
    statements.push(text.split('\n')[0]!);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) return { rows: [] };
    const update = UPDATE.exec(text);
    if (update) {
      const cols = update[1]!.split(', ').map((part) => part.split(' = ')[0]!);
      const set = Object.fromEntries(cols.map((col, i) => [col, params[i + 2]]));
      const chain = supabase.from('sessions') as Chain;
      const { error } = await chain.update(set).eq('org_id', params[0]).in('id', params[1]);
      if (error) throw fail(error);
      return { rows: [] };
    }
    if (text.startsWith('insert into public.schedule_changes')) {
      const chain = supabase.from('schedule_changes') as Chain;
      const { error } = await chain.insert(JSON.parse(params[0] as string));
      if (error) throw fail(error);
      return { rows: [] };
    }
    throw new Error(`rest-backed session batch pool 認不得這句：${text.split('\n')[0]}`);
  };
  return {
    query,
    connect: async () => ({ query, release: () => undefined }),
    end: async () => undefined,
    statements,
  };
}
