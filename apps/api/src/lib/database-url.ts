/**
 * 這個請求要連哪個資料庫。
 *
 * **優先 Hyperdrive**：Workers 每請求建池，對新加坡的 Supabase 做 TCP + TLS + 認證
 * 握手是每個受保護請求都要繳的稅（實測碰 DB 的請求 1.7–2.9 秒）。Hyperdrive 在邊緣
 * 維持到 origin 的長連線，Worker 連的是本地的它，握手成本掉到近乎零。
 *
 * **沒有 binding 就退回 `DATABASE_URL`，而且這條路必須永遠留著**（憲法 c12）：
 * 本機 `wrangler dev` 沒設 `localConnectionString` 時沒有 binding，`server.ts` 的
 * Node 自架路徑更是連 Cloudflare 都沒有。客戶要能脫離我們的架構自己 host。
 */
export function resolveDatabaseUrl(env: {
  HYPERDRIVE?: { connectionString?: string } | null;
  DATABASE_URL?: string;
}): string {
  const viaHyperdrive = env.HYPERDRIVE?.connectionString?.trim();
  if (viaHyperdrive) return viaHyperdrive;

  const direct = env.DATABASE_URL?.trim();
  if (direct) return direct;

  // 不丟的話 pg 會拿預設值去連本機 —— 症狀是 ECONNREFUSED 或更糟的「連到別的庫」，
  // 兩者都比「你沒設連線來源」難查。
  throw new Error(
    '沒有資料庫連線來源：Workers 請綁 Hyperdrive（見 wrangler.toml），自架請設 DATABASE_URL',
  );
}
