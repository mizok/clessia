-- clessia:apply after-deploy
-- ============================================================
-- 既有學校的學制：用校名推（#1314 SE4 ②；使用者 10-22 裁「用校名自動推」）
--
-- schema 在 20261022025737_school_level.sql（已套正式）。這支只補資料，部署完由使用者 dispatch。
-- - 國小／國民小學 → elementary；國中／國民中學 → junior；高中／高級中學／高職 → senior。
-- - **只動還是 NULL 的列**：行政在部署後、這支套用前已經自己選過的學制不蓋掉。
-- - **校名同時符合兩種的不猜**（例如「XX 高中附設國中部」、完全中學）：留 NULL，畫面放「未分類」讓行政自己選。
-- - 一個都不符合的也留 NULL（補校、實驗學校、外縣市簡稱等）。
-- 重跑安全：第二次跑時已補的列不是 NULL，不會再動。
-- ============================================================
WITH guess AS (
  SELECT
    id,
    name ~ '(國小|國民小學)'          AS is_elementary,
    name ~ '(國中|國民中學)'          AS is_junior,
    name ~ '(高中|高級中學|高職)'     AS is_senior
  FROM public.schools
  WHERE level IS NULL
)
UPDATE public.schools AS s
SET level = CASE
  WHEN g.is_elementary THEN 'elementary'
  WHEN g.is_junior THEN 'junior'
  ELSE 'senior'
END::public.school_level
FROM guess AS g
WHERE s.id = g.id
  AND (g.is_elementary::int + g.is_junior::int + g.is_senior::int) = 1;
