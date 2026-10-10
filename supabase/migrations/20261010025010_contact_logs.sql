-- ============================================================
-- 聯絡紀錄 contact_logs（#1314 D2）
--
-- 儀表板「該到沒到」列的「打電話」、學生檔案的「打電話／傳 LINE」都要「記一筆聯絡」，
-- 列變「已聯絡 17:42」；學生檔案的紀錄時間軸（SD6）也吃它。
--
-- 設計（計畫席 10-10 gate 過）：
--   - 只增不改不刪（v1）：記錯就再記一筆更正
--   - student_id ON DELETE CASCADE：學生只有「無報名」時能刪（#1394），刪了紀錄失去主體
--   - parent_id  ON DELETE SET NULL：家長被刪，「打過電話」這件事仍成立
--   - created_by 同 invoices.created_by 的慣例（ba_user.id，text）
--   - 業務表慣例：啟用 RLS、不給 policy（fail-closed；api 走 service role）
--
-- 純新增（新 enum、新表），不動既有表。api 讀寫新表 → schema 類，**套完才部署**。
-- ============================================================

CREATE TYPE public.contact_channel AS ENUM ('phone', 'line', 'other');

CREATE TABLE public.contact_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students (id) ON DELETE CASCADE,
  -- 打給誰；可空（打給學生本人、或沒記）
  parent_id uuid REFERENCES public.parents (id) ON DELETE SET NULL,
  channel public.contact_channel NOT NULL,
  note text CHECK (char_length(note) <= 500),
  created_by text REFERENCES public.ba_user (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 學生檔案（依學生、新到舊）與儀表板（今天、一批學生）都走這支
CREATE INDEX contact_logs_student_idx ON public.contact_logs (org_id, student_id, created_at DESC);

ALTER TABLE public.contact_logs ENABLE ROW LEVEL SECURITY;
