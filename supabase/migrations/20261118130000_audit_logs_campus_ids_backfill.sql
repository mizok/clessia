-- clessia:apply after-deploy
-- ============================================================
-- 回填 audit_logs.campus_ids（#2496 第 3 張）—— #2521 已套進正式並部署，這支才套（deploying.md）。
--
-- 舊列在 #2521 之前寫入，campus_ids 全是 NULL ＝ 受限（單分校）管理員看不到。
-- 判準跟 BEFORE INSERT trigger 共用同一支 audit_campus_ids()，不另寫一份。
--
-- - 只碰 campus_ids IS NULL 的列；函式對推不出的（資源已刪、id 對不到）仍回 NULL，
--   所以可重跑、不會蓋掉既有值。
-- - 只會有 90 天內的列（cron 會清更舊的）。資源已刪的舊列維持 NULL ＝ fail-closed，這是預期。
-- ============================================================

UPDATE public.audit_logs
   SET campus_ids = public.audit_campus_ids(resource_type, resource_id)
 WHERE campus_ids IS NULL;
