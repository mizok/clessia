-- ============================================================
-- 公開表單的速率限制（#1126）：public_applications.client_ip_hash
--
-- 計數**存在自己的 Postgres**：c12 禁止依賴 Workers KV／Durable Objects／Cloudflare Rate Limiting
-- 這類供應商專屬服務。也不另開計數表 —— 要擋的就是「寫進來的申請太多」，既有的申請列就是紀錄
-- （被 honeypot／CAPTCHA 擋掉的請求本來就沒寫進來，不必計）。
--
-- 只存 HMAC-SHA256(ip, BETTER_AUTH_SECRET)：數得出「同一個來源」，表裡沒有可還原的 IP（個資）。
-- 沒取得 IP 的請求是 NULL（只剩「同一聯絡方式」那條限制）。
--
-- 純加欄＋索引，「套完才部署」：新程式碼會寫這欄、依它計數。
-- ============================================================
ALTER TABLE public.public_applications
  ADD COLUMN client_ip_hash text;

-- 「同一來源一小時內幾筆」：org × 來源 × 時間
CREATE INDEX public_applications_rate_idx
  ON public.public_applications (org_id, client_ip_hash, created_at);
