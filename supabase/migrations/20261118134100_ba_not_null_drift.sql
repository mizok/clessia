-- #2548：Better Auth（auth@1.7.25）CLI 的三條 schema 警告 ——
--   Column "email" on table "ba_user" stays nullable while the schema declares the field required …
--   Column "createdAt"／"updatedAt" on table "ba_verification" stays nullable …
--   「Backfill every row for this column and enforce NOT NULL to remove the drift.」
-- CLI 對這三條不產生 migration（generate 回「schema is already up to date」），所以照警告的指示手寫 DDL。
-- 這是 DDL、不寫任何 ba_* 資料列（c2 管的是應用程式寫資料）。
--
-- ba_user.email：建表時是 NOT NULL，20260317000002 為「沒有 email 的系統帳號（username-only）」放寬過。
-- 那個理由已失效（username plugin 已拿掉；admin.createUser 的 email 必填；手機家長、LINE、Google
-- 都合成 email），計畫席 11-18 確認收回。
--
-- 失敗是安全的：若套用時仍有 NULL 列，SET NOT NULL 直接報錯、整支回滾（一支檔一個交易），
-- migrate 紅 → 不部署。正式站先跑過只讀查詢確認三欄都沒有 NULL（見 #2548）。
alter table public.ba_user alter column email set not null;
alter table public.ba_verification alter column "createdAt" set not null;
alter table public.ba_verification alter column "updatedAt" set not null;
