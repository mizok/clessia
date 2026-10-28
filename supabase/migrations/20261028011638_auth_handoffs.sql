-- ============================================================
-- auth_handoffs：iOS 主畫面 PWA 的外部登入交接（#2027，設計 kb/wiki/architecture/pwa-oauth-handoff.md）
--
-- iOS 主畫面 PWA 與 Safari 不共用 cookie：LINE／Google 授權完落在 Safari，PWA 仍未登入。
-- PWA 發起時先建一列（只存 secret 的雜湊，secret 本身只留在 PWA、不進任何 URL），
-- Safari 登入完成後把這列標成「是誰」，PWA 回前景用 secret 換一次性登入連結。
--
-- - **沒有 org_id**：發起時還沒登入、不知道是哪個 org。org 在換連結時由 ba_user 決定（c1）
-- - **短效＋一次性**：expires_at（10 分鐘，程式決定）；換過就刪；過期的由發起端點順手清
-- - user_id ON DELETE CASCADE：帳號刪了，交接也沒有意義
-- - **配對碼**（計畫席讀 diff 擋：防交接劫持）：PWA 顯示 4 位數，Safari 頁要輸入相同的碼才完成；
--   只存雜湊；錯太多次（failed_attempts，上限由程式決定）就失效
-- - ip_hash：發起端的 IP HMAC（同招生表單，表裡沒有可還原的 IP），每個來源同時進行的交接有上限
-- - 業務表慣例：啟用 RLS、不給 policy（fail-closed；api 走 service role）
--
-- 純新增表，不動既有表 —— 套完才部署或部署完才套都安全（舊程式碼不讀它）。
-- ============================================================

CREATE TABLE public.auth_handoffs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 hex；secret 本身不落地
  secret_hash  text NOT NULL,
  -- SHA-256(id || ':' || 配對碼) hex
  pair_code_hash  text NOT NULL,
  failed_attempts smallint NOT NULL DEFAULT 0,
  -- 發起端 IP 的 HMAC；取不到 IP 時 NULL
  ip_hash      text,
  -- Safari 那邊登入完成後才填；NULL＝還在等
  user_id      text REFERENCES public.ba_user (id) ON DELETE CASCADE,
  completed_at timestamptz,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_handoffs_completed_check CHECK ((user_id IS NULL) = (completed_at IS NULL))
);

-- 清過期的、數未過期的（全域上限）都看 expires_at
CREATE INDEX auth_handoffs_expires_idx ON public.auth_handoffs (expires_at);
-- 每個來源同時進行的交接上限
CREATE INDEX auth_handoffs_ip_idx ON public.auth_handoffs (ip_hash, expires_at);

ALTER TABLE public.auth_handoffs ENABLE ROW LEVEL SECURITY;
