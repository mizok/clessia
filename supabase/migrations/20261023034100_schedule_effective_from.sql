-- 班級時段的生效起始日（#1100 #22，使用者 10-23 裁定；設計：#1100 計畫席批准 10-23）
--
-- `schedules` 原本只有 `effective_to`（到哪天止），沒有「從哪天起」。要支援「下個月起改成週三上課」：
-- 舊時段止於 X−1、新時段起於 X —— 兩列同班、同星期、同開始時間，原本的
-- UNIQUE (class_id, weekday, start_time) 會擋掉，所以換成「同一時段的生效區間不重疊」的排除約束。
--
-- **schema 類：套完才部署**（kb/wiki/architecture/deploying.md）。新的 api 會 select `effective_from`。
-- 回填放在同一支檔裡**不是**依賴新程式碼的 backfill：舊程式碼不讀這個欄位，而 NOT NULL 之前必須先有值 ——
-- 拆成兩支反而留下一段可為 NULL 的空窗。
--
-- 既有資料盤點（10-23，本機唯讀）：12 筆時段、班級開課日全有、effective_to 全為 NULL、
-- 沒有會違反 effective_to >= effective_from 的列。正式資料未查（要使用者授權）；若有違反，
-- 這支檔整支在交易裡失敗回滾、不留 history 列，往前修。

-- 1. 欄位 + 回填：裁定「既有時段的起始日＝班級開課日」；班級沒填開課日（可為 NULL）就用時段建立日
ALTER TABLE public.schedules ADD COLUMN effective_from date;

UPDATE public.schedules s
   SET effective_from = COALESCE(c.start_date, s.created_at::date)
  FROM public.classes c
 WHERE c.id = s.class_id;

-- 套完到新程式部署之間，舊程式碼新增的時段沒有帶這個欄位 —— 給今天。新程式碼一律明確帶
ALTER TABLE public.schedules
  ALTER COLUMN effective_from SET DEFAULT CURRENT_DATE,
  ALTER COLUMN effective_from SET NOT NULL,
  ADD CONSTRAINT schedules_effective_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from);

COMMENT ON COLUMN public.schedules.effective_from IS
  '時段從哪天起生效（含）。既有資料＝班級開課日（#1100 #22）';

-- 2. 唯一 → 排除：同班、同星期、同開始時間的時段可以前後接續，生效區間不能重疊。
-- 重疊的話同一天會產生兩堂課。btree_gist 是 Postgres 內建 contrib（自架也有，c12）
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TABLE public.schedules DROP CONSTRAINT schedules_unique_slot;

ALTER TABLE public.schedules
  ADD CONSTRAINT schedules_no_overlap EXCLUDE USING gist (
    class_id WITH =,
    weekday WITH =,
    start_time WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );
