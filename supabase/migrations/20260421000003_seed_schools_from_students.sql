-- ============================================================
-- 從 students.school 自由文字建立 schools 種子，並回填 school_id
-- 完成後把原本的 school text 欄位移除
-- （專案尚未上線，此為一次性資料遷移）
-- ============================================================

-- 1. 每個 (org_id, TRIM(school)) 建一筆 schools（已存在則跳過）
INSERT INTO public.schools (org_id, name)
SELECT DISTINCT org_id, TRIM(school)
FROM public.students
WHERE school IS NOT NULL AND TRIM(school) <> ''
ON CONFLICT (org_id, name) DO NOTHING;

-- 2. 把 students.school_id 回填為對應 schools.id
UPDATE public.students AS s
SET school_id = sc.id
FROM public.schools sc
WHERE sc.org_id = s.org_id
  AND sc.name = TRIM(s.school);

-- 3. 確認沒有漏掉的 students（允許 school_id 為 NULL，因此不強制 100%）
DO $$
DECLARE
  missing integer;
BEGIN
  SELECT COUNT(*) INTO missing
  FROM public.students
  WHERE school_id IS NULL
    AND school IS NOT NULL
    AND TRIM(school) <> '';
  IF missing > 0 THEN
    RAISE EXCEPTION 'Seed failed: % students have non-empty school but no school_id', missing;
  END IF;
END$$;

-- 4. 移除 students.school 文字欄位
ALTER TABLE public.students DROP COLUMN school;
