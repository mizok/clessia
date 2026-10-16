-- ============================================================
-- 推播發送佇列 → 通知紀錄（#1687，#1626 改版；使用者 10-16 17:04 裁定，計畫席 gate 17:06 過）
--
-- 「通知」是一筆紀錄，推播只是其中一種送達管道：沒開推播的家長，也要在通知中心（#1683）
-- 看得到，而且算未讀。所以 push_deliveries 改名成 notifications，加 read_at；推播的狀態
-- 改成明確的 push_status 狀態機，取代原本 sent_at／last_error 兼當記號的做法。
--
-- 為什麼改名而不是另開一張表：通知與推播狀態一對一（沒有「一則通知、每台裝置各一列」的需求），
-- 分兩張表多一個 join、多一個 FK；只加 read_at 不改名，則「沒開推播的家長的通知」會躺在一張叫
-- push_deliveries 的表裡，之後每個讀到的人都會誤會。
--
-- 20261016073848 已提交（c3），所以用新的一支往前改。正式 DB 上這張表**應該是空的** ——
-- 寫入它的排程（#1678）還沒合；main 上除了 org-scope.ts 的型別清單，沒有任何程式碼讀寫它（已查）。
-- 不空就中止：改名搭配欄位語意的改變（sent_at → push_updated_at），舊資料不會自己對上新語意。
--
-- 套用順序：這支沒有任何 api 程式碼在用（#1678、#1688 才開始讀寫），「套完才部署」與
-- 「部署完才套」都安全。
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.push_deliveries) THEN
    RAISE EXCEPTION 'push_deliveries 有資料：改名會改變欄位語意，請先確認這些列從哪來再處理';
  END IF;
END $$;

ALTER TABLE public.push_deliveries RENAME TO notifications;

-- 推播管道的欄位都加 push_ 前綴：這張表現在主要是通知紀錄，這幾欄只屬於推播那條管道
ALTER TABLE public.notifications RENAME COLUMN sent_at TO push_updated_at; -- 認領／送達的時間
ALTER TABLE public.notifications RENAME COLUMN attempts TO push_attempts;
ALTER TABLE public.notifications RENAME COLUMN last_error TO push_error;

-- pending → claimed → sent；送失敗回到 pending（push_attempts + 1，三次後 failed）；
-- 沒有訂閱或偏好關掉 → skipped（不算失敗、不重試）；claimed 超過 10 分鐘＝那個 run 被砍了，回到 pending
CREATE TYPE public.push_status AS ENUM ('pending', 'claimed', 'sent', 'skipped', 'failed');

ALTER TABLE public.notifications
  ADD COLUMN push_status public.push_status NOT NULL DEFAULT 'pending',
  ADD COLUMN read_at timestamptz; -- 通知中心的已讀；偏好只管推播，跟這欄無關（#1626 Q-a）

-- 限制條件與索引跟著改名（pkey／unique 改名時，它們底下的索引會一起改）
ALTER TABLE public.notifications RENAME CONSTRAINT push_deliveries_pkey TO notifications_pkey;
ALTER TABLE public.notifications
  RENAME CONSTRAINT push_deliveries_user_id_dedupe_key_key TO notifications_user_id_dedupe_key_key;
ALTER TABLE public.notifications RENAME CONSTRAINT push_deliveries_org_id_fkey TO notifications_org_id_fkey;
ALTER TABLE public.notifications RENAME CONSTRAINT push_deliveries_user_id_fkey TO notifications_user_id_fkey;

-- 舊的認領索引看的是 sent_at IS NULL，改名後語意不對了 —— 換成看 push_status
DROP INDEX public.push_deliveries_pending_idx;
CREATE INDEX notifications_push_pending_idx
  ON public.notifications (created_at) WHERE push_status = 'pending';

-- 通知中心：這個人、這個身分的未讀
CREATE INDEX notifications_unread_idx
  ON public.notifications (user_id, role) WHERE read_at IS NULL;

-- RLS 是表的屬性，改名後照舊啟用、沒有 policy（fail-closed，AGENTS.md）
