-- clessia:apply after-deploy
-- ============================================================
-- 回填 sessions.status = 'completed'（#2546 PR-B）—— 部署完（#2552）才套，由使用者 dispatch migrate（deploying.md）
--
-- 沒有 schema 變更；#2552 起程式在點名提交時把課堂設為 completed，這支只補「部署前就點過名」的舊資料：
-- 已有 events.attendance_taken_at、status 還是 scheduled 的課堂 → completed。
--
-- 與程式（lib/session-completion.ts）同一組判準：
--   - 只動 scheduled：cancelled 不被改回、completed 不重寫
--   - 有效出勤模式 = 分校 attendance_mode，null 沿用機構的；兩邊都讀不到時跟 DB 預設一致（日到班）。
--     **只補 per_session**，日到班的課堂沒有「點名提交」動作，維持日期判斷（計畫席 11-18 裁定）
-- 重跑零列變動（只動 scheduled）。
--
-- ⚠️ sessions_updated_at 會把 updated_at 推到回填當下，讓每一堂看起來「剛被修改」。
-- 這是資料補寫不是編輯，所以只在這一句前後關掉它、同一交易內再開回來
-- （同 20261102142216_contact_book_teacher_edited_at_backfill.sql；一支檔＝一個交易，失敗整支回滾）。
-- ============================================================

ALTER TABLE public.sessions DISABLE TRIGGER sessions_updated_at;

UPDATE public.sessions s
SET status = 'completed'
FROM public.events e
LEFT JOIN public.campuses c ON c.id = e.campus_id
JOIN public.organizations o ON o.id = e.org_id
WHERE s.event_id = e.id
  AND s.org_id = e.org_id
  AND s.status = 'scheduled'
  AND e.attendance_taken_at IS NOT NULL
  AND COALESCE(c.attendance_mode, o.attendance_mode, 'daily_checkin') = 'per_session';

ALTER TABLE public.sessions ENABLE TRIGGER sessions_updated_at;
