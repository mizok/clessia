/**
 * `authMiddleware` 身分三查（user_roles、staff＋分校、parents＋關聯學生）的 per-isolate 快取（#1595 P1b）。
 *
 * **撤銷的最長延遲 = `IDENTITY_TTL_MS`**：撤銷角色、拔權限、停用帳號、改分校指派、改家長關聯，
 * 最遲這麼久之後的下一個請求生效。寫入點**刻意不主動清除**（計畫席 10-15 裁定）——
 * 多一套要每支寫入路由記得呼叫的機制，換來的只是把 30 秒縮成 0。
 * 見 kb/wiki/architecture/authorization-scope.md 的「撤銷多久生效」。
 *
 * 為什麼值得：Worker → Supabase REST 每次查詢約 100–150ms，而 PostgREST＋DB 只占 1–15ms
 * （#1595 P0）—— 慢在往返本身，所以省往返是唯一有效的方向。
 *
 * **不用 KV**：KV 是最終一致，延遲上限反而說不清。isolate 之間不共享，所以命中率看 isolate 重用。
 *
 * 獨立成檔、不 import 任何東西：`test-setup.ts` 要在每支測試後清它，
 * 而從 setup 載入 `middleware/auth.ts` 會搶在各 spec 的 `vi.mock` 之前把真模組載進來。
 */
export const IDENTITY_TTL_MS = 30_000;

// ponytail: 不設上限 —— 一個 isolate 只會看到一個機構的少數使用者，過期條目在下次讀時刪。
// 真的出現大量使用者打同一個 isolate 再換 LRU。
const cache = new Map<string, { value: unknown; expiresAt: number }>();

export function getCachedIdentity<T>(userId: string): T | undefined {
  const entry = cache.get(userId);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(userId);
    return undefined;
  }
  return entry.value as T;
}

/** 只存查詢成功的結果 —— 失敗要每次重查，不能被快取成 30 秒的 500。 */
export function setCachedIdentity(userId: string, value: unknown): void {
  cache.set(userId, { value, expiresAt: Date.now() + IDENTITY_TTL_MS });
}

/** 測試用：`test-setup.ts` 每支測試後清掉，避免同一個 userId 的結果跨測試殘留。 */
export function clearIdentityCache(): void {
  cache.clear();
}
