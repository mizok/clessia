-- ============================================================
-- 報名狀態變更的日期與原因（#1314 EN5）
--
-- 報名進出總覽要分四種事件（新報名／退班／暫停／作廢）並顯示原因。原本：
--   - 原因是**覆寫 notes**（行政自己寫的備註被吃掉）
--   - 退班／作廢靠 effective_to 落日期，**暫停沒有任何日期落地**（暫停不寫 effective_to，
--     因為暫停不是離開 —— countEnrolledOn 用它判在籍範圍）
-- 所以另開兩欄，由 PATCH /api/enrollments/:id/status 每次寫入：
--   status_changed_at  最近一次狀態變更的台北日期
--   status_reason      那次變更的原因（暫停／退班／作廢必填；恢復為 NULL）
--
-- 純加欄、皆 nullable。既有列兩欄為 NULL（不回補；舊暫停列顯示無日期）。
-- ⚠️ api 的 select 讀新欄 → schema 類，**套完才部署**（deploying.md「檔頭要自己核」那一列）。
-- ============================================================
ALTER TABLE public.enrollments
  ADD COLUMN status_changed_at date,
  ADD COLUMN status_reason text;
