-- ============================================================
-- 出勤模式改分校層級（#1112）
--
-- flows/attendance.md 2「兩種出勤模式（分校層級）」、specs/admin/system/campuses.md
-- 都寫分校層級，而欄位只在 organizations（20260330000006）。
--
-- **nullable、不給預設值**：null = 沿用 `organizations.attendance_mode`（機構預設）。
-- 推算在 API 的 `lib/attendance-mode.ts`（分校值 → 機構預設）。所以既有分校套完之後
-- 行為完全不變 —— 每一列都是 null，照舊吃機構那一欄。
--
-- 純加欄（ADD COLUMN … NULL），「套完才部署」或「部署完才套」都安全：
-- 舊程式碼不讀這欄；新程式碼讀到 null 就退回機構預設。
-- ============================================================
ALTER TABLE public.campuses
  ADD COLUMN attendance_mode public.attendance_mode NULL;

COMMENT ON COLUMN public.campuses.attendance_mode IS
  '分校出勤模式；NULL = 沿用 organizations.attendance_mode（#1112）';
