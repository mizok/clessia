-- ============================================================
-- 開啟 PostgREST 聚合函式（#1595 P3b-B）
--
-- 學生名冊的年級章節計數原本是 12 支 head count（每個年級一支），加上列表與在籍數
-- 一個請求同時 14 支，超過 Workers 每請求 6 條連線上限、排成 3 波。開了聚合之後
-- `select('grade, count()')` 一支 GROUP BY 就數完，而且沿用列表同一個 filter builder
-- （`withChapterFilters`），列表與章節計數仍是同一份條件。
--
-- 影響：這是 PostgREST 的全域設定 —— 任何打得到 PostgREST 的角色都多一種「查法」
-- （count/sum/avg/min/max），**不多看得到任何資料**：業務表 RLS 啟用且無 policy，
-- anon／authenticated 照樣全拒；只有 service role（api）在用。
-- 聚合沒有上限保護，惡意的大表聚合理論上更耗 DB —— 但能下這種查詢的只有 service role。
--
-- 回退：先撤掉 api 的 `count()` 用法（否則 GET /api/students 會 500），再新增一支
--   alter role authenticator reset pgrst.db_aggregates_enabled;
--   notify pgrst, 'reload config';
--
-- 不動任何表。api 用到 → schema 類，**套完才部署**（CI 的 migrate→deploy 順序天然滿足）。
-- ============================================================

alter role authenticator set pgrst.db_aggregates_enabled = 'true';
notify pgrst, 'reload config';
