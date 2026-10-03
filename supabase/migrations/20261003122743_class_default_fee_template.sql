-- ============================================================
-- 班級的目錄參考價（#1175）：classes.default_fee_template_id
--
-- 家長目錄（/api/me/catalog）與公開目錄要顯示費用，而班級原本跟價目表沒有任何關聯 ——
-- 價錢只存在報名上（enrollments.fee_template_id／agreed_amount）。使用者裁 A：
-- 班級掛一張「預設範本」，目錄顯示它的金額＋計費模式並標「參考」；
-- **實際報名價仍以報名時選的範本為準**，這一欄不進任何帳。
--
-- ON DELETE SET NULL 而不是 enrollments 那邊的 RESTRICT：報名的範本是帳的依據、刪不得；
-- 班級預設只是目錄上的參考價，範本被刪時目錄退回「不顯示費用」，
-- 不該因為某個班掛著它當預設就讓價目表刪不掉。
--
-- 跨 org 不在這裡擋（FK 只看 id）：API 寫入時驗範本屬於本 org 且仍在使用（c1）。
--
-- 純加欄（NULL），照預設「套完才部署」：新程式碼的家長目錄 select 會 embed 這條 FK。
-- ============================================================
ALTER TABLE public.classes
  ADD COLUMN default_fee_template_id uuid NULL
    REFERENCES public.fee_templates(id) ON DELETE SET NULL;

-- FK 欄位的索引：刪範本時 SET NULL 要找掛著它的班，沒有索引就是全表掃
CREATE INDEX classes_default_fee_template_id_idx
  ON public.classes (default_fee_template_id);

COMMENT ON COLUMN public.classes.default_fee_template_id IS
  '目錄參考價的範本（#1175）。只用於顯示，實際報名價以 enrollments.fee_template_id 為準';
