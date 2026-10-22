-- ============================================================
-- 學校的學制（#1314 SE4；計畫席／使用者 10-22 裁）
--
-- A6 settings#schools 依國小／國中／高中分章，表單有「學制」。
-- - enum school_level：elementary（國小）／junior（國中）／senior（高中、高職）。
-- - schools.level 可空：NULL＝未分類，畫面排最後一章「未分類」，不猜。
-- - 既有學校的學制由另一支 backfill 用校名推（`-- clessia:apply after-deploy`，獨立 PR）。
--
-- 純加型別＋加可空欄，「套完才部署」或「部署完才套」都安全：舊程式碼不讀這欄。
-- ============================================================
CREATE TYPE public.school_level AS ENUM ('elementary', 'junior', 'senior');

ALTER TABLE public.schools
  ADD COLUMN level public.school_level NULL;
