-- ============================================================
-- 分校的教室＋班級時段可指定教室（#1314 SE3，設計稿 kb/wiki/specs/admin/system/campus-classrooms.md §2）
--
-- 1. classrooms：分校底下的教室（名稱分校內唯一、容納人數選填、設備選填）。
--    - org_id 冗餘存一份：API 每句帶 org_id（c1）。值由伺服器從分校列帶，不收前端給的。
--    - 分校刪除 CASCADE 教室：教室本身沒有歷史價值。
--    - 容量只顯示、不擋班級人數上限（使用者 10-21 裁 Q3）；沒有停用狀態，不用就刪（Q5）。
-- 2. schedules.classroom_id：時段指定的教室（計畫席 10-21 裁 Q2：先加欄、UI 另開單）。
--    ON DELETE SET NULL：刪教室時時段改回「不指定」，不連坐刪時段（Q4）。
--    「教室要跟班級同分校」由 API 驗（不同 → 409），不放 DB。
--
-- 純加表＋加可空欄，「套完才部署」或「部署完才套」都安全：舊程式碼不讀這些。
-- RLS 啟用、不加 policy：fail-closed 後盾（AGENTS.md「Supabase / SQL」）。
-- ============================================================
CREATE TABLE public.classrooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campus_id  uuid NOT NULL REFERENCES public.campuses(id) ON DELETE CASCADE,
  name       text NOT NULL,
  capacity   integer NULL,   -- NULL = 沒填
  equipment  text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classrooms_name_not_blank CHECK (btrim(name) <> '' AND char_length(name) <= 50),
  CONSTRAINT classrooms_capacity_positive CHECK (capacity > 0),
  CONSTRAINT classrooms_equipment_len CHECK (char_length(equipment) <= 200),
  CONSTRAINT classrooms_campus_name_uniq UNIQUE (campus_id, name)
);

COMMENT ON TABLE public.classrooms IS '分校的教室（#1314 SE3）';
COMMENT ON COLUMN public.classrooms.capacity IS '容納人數；只顯示，不擋班級人數上限；NULL = 沒填';

-- campus_id 已由 UNIQUE (campus_id, name) 的索引涵蓋
CREATE INDEX classrooms_org_id_idx ON public.classrooms (org_id);

CREATE TRIGGER classrooms_updated_at
  BEFORE UPDATE ON public.classrooms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.schedules
  ADD COLUMN classroom_id uuid NULL REFERENCES public.classrooms(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.schedules.classroom_id IS
  '時段指定的教室；NULL = 不指定。刪教室時改回 NULL（#1314 SE3）';

CREATE INDEX schedules_classroom_id_idx ON public.schedules (classroom_id);
