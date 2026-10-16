-- ============================================================
-- Web Push 推播（#1658，設計稿 kb/wiki/architecture/web-push.md §3；#1626 八題 10-16 裁定）
--
-- 三張表＋一個 enum＋organizations 一欄：
--   push_subscriptions        一人多裝置；endpoint UNIQUE，換人登入同一台裝置時改綁現在的人
--   notification_preferences  想收哪些類型，**照角色分**（Q7）。沒有這一列 = 開
--   push_deliveries           發送佇列兼去重；UNIQUE(user_id, dedupe_key) 是冪等的來源
--   organizations.invoice_reminder_offsets  家長繳費提醒的時間點（Q2，機構設定）
--
-- 第一版只開家長（Q7），但 preferences 與 deliveries 帶 `role`，之後開給老師／行政不必改 schema。
-- 訂閱不帶 role：通知權限是一台裝置一個網站給的，跟現在用哪個身分無關。
--
-- 三張表都只**引用** ba_user(id)，不寫它（c2）。
--
-- 純加表加欄，「套完才部署」與「部署完才套」都安全：這支 migration 進 main 時，
-- 沒有任何 api 程式碼讀這些表或這一欄（org-settings 的 SELECT_FIELDS 要到 #1660 才加，
-- 見 deploying.md「檔頭寫『都安全』要自己核」那一條）。
-- ============================================================

-- 一人多裝置；同一台裝置換人登入時 upsert 改綁（登出前前端會先刪自己的那一列）
CREATE TABLE public.push_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          text NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE,
  endpoint         text NOT NULL UNIQUE,
  p256dh           text NOT NULL,
  auth             text NOT NULL,
  vapid_public_key text NOT NULL,          -- 訂閱時用的公鑰；換金鑰時找得出誰要重訂
  user_agent       text,                   -- 設定頁「已開啟通知的裝置」顯示用
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz
);

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions (user_id);

-- 第一版只放用得到的兩個值；之後加 announcement／leave 等是 ALTER TYPE ... ADD VALUE。
-- 先放用不到的值會讓設定頁出現「選得到但永遠不會來」的開關（announcements 的 audience 同型教訓）
CREATE TYPE public.notification_kind AS ENUM (
  'invoice_due',     -- 帳單即將到期（時間點 offset ≤ 0）
  'invoice_overdue'  -- 帳單逾期（offset > 0）
);

CREATE TABLE public.notification_preferences (
  user_id  text NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE,
  org_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role     public.user_role NOT NULL,
  kind     public.notification_kind NOT NULL,
  enabled  boolean NOT NULL,
  PRIMARY KEY (user_id, role, kind)
);

CREATE TABLE public.push_deliveries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE,
  role        public.user_role NOT NULL,   -- 以哪個身分收（點開的網址、套用哪一組偏好）
  kind        public.notification_kind NOT NULL,
  dedupe_key  text NOT NULL,               -- 例：invoice_reminder:<invoice_id>:-3（含時間點，不含日期）
  payload     jsonb NOT NULL,              -- { title, body, url, topic }；不放金額（Q3）
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,                 -- null = 還沒送
  attempts    smallint NOT NULL DEFAULT 0,
  last_error  text,
  UNIQUE (user_id, dedupe_key)
);

-- 每次 run 取「還沒送、最舊的 K 筆」
CREATE INDEX push_deliveries_pending_idx ON public.push_deliveries (created_at) WHERE sent_at IS NULL;
-- ponytail: 90 天清理（created_at < now() - 90d）不另建索引 —— 一天最多幾百列，量大了再加

-- 業務表一律啟用 RLS、不給 policy（fail-closed 後盾，AGENTS.md）
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;

-- 家長繳費提醒時間點（Q2）：相對到期日的天數，負 = 到期前、0 = 當天、正 = 逾期第 N 天。
-- 最多 6 個、範圍 [-30, 60]（計畫席 10-16 同意）；不重複由 API 的 zod 擋。
-- ⚠️ 不是既有的 billing_reminder_days（#1305，行政的「待開單提醒」）—— 兩件事，不要合併
ALTER TABLE public.organizations
  ADD COLUMN invoice_reminder_offsets smallint[] NOT NULL DEFAULT '{-3,0,1,7}',
  ADD CONSTRAINT organizations_invoice_reminder_offsets_check CHECK (
    cardinality(invoice_reminder_offsets) <= 6
    AND -30 <= ALL (invoice_reminder_offsets)
    AND 60 >= ALL (invoice_reminder_offsets)
  );
