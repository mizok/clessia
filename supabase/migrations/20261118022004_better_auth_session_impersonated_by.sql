-- #2540 better-auth 1.5.5 → 1.7.25：補 admin plugin 一直要、但 20260222000001／20260223000002 漏掉的欄位。
--
-- 內容是 Better Auth CLI（auth@1.7.25 `generate`）對本機 DB 乾跑的原樣輸出，不是手寫（c2）。
-- 1.5.5 的 CLI 對同一個 DB 產出同一行 —— 既有漂移，不是 1.7 新增的欄位。
--
-- 為什麼現在非補不可：1.7.3 起 Better Auth 預設在初始化時驗 schema（含 production），
-- 不符就拒絕所有認證請求（SchemaMismatchError: Missing columns ba_session.impersonatedBy）。
--
-- 純加 nullable 欄、1.5.5 不讀它：套完才部署、部署前先套都安全（CI migrate→deploy 順序天然滿足）。
alter table "ba_session" add column "impersonatedBy" text;
