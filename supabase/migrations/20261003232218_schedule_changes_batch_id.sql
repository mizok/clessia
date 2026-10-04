-- ============================================================
-- 課務異動的批次識別碼（#1195）
--
-- schedule_changes 只有 operation_source（single／batch），沒有「哪幾筆是同一批」——
-- 「停課 14 堂」在 /admin/changes 只能用 created_at＋操作者＋類型猜。批次端點同一次呼叫的每一列
-- 共用一顆 uuid；單堂為 null。
--
-- 純加欄位（可 null），不依賴資料，「套完才部署」或「部署完才套」都安全。
-- 不加 FK、不建批次表 —— 它只是分組鍵，沒有要掛的屬性。
-- **既有資料不補**：舊的批次只能靠時間＋操作者＋類型猜，猜錯會把不相干的兩批併成一批。
-- ============================================================
ALTER TABLE public.schedule_changes ADD COLUMN IF NOT EXISTS batch_id uuid;

CREATE INDEX IF NOT EXISTS schedule_changes_batch_id_idx
  ON public.schedule_changes (batch_id)
  WHERE batch_id IS NOT NULL;

COMMENT ON COLUMN public.schedule_changes.batch_id IS '同一次批次操作共用的識別碼；單堂為 null（#1195）';
