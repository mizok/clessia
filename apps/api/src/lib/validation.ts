import { z } from '@hono/zod-openapi';

/**
 * **這是驗證 id 的唯一定義，`z.uuid()` 不要再直接用在 params/body 上。**
 *
 * `z.uuid()` 檢查 RFC4122 的 version（第三段第一碼要 `1-8`）與 variant
 * （第四段第一碼要 `8/9/a/b`）nibble，而 Postgres 的 `uuid` 型別**不檢查**
 * 這兩件事——32 個 hex 字元照標準分組就合法。這支 schema 跟 Postgres 的認定
 * 一致，`z.uuid()` 比我們自己的資料庫還嚴格。
 *
 * 2026-09-06 P0-1：`supabase/seed.sql` 的示範資料用可讀 id（例如
 * `61000000-0000-0000-0000-000000000001`，方便 debug 時一眼看出是第幾個
 * 學生），version/variant nibble 都是 `0`——DB 收，但 30 支 route 檔案直接
 * 寫 `z.uuid()` 的地方會整批拒絕，餐費管理在 demo 上因此 100% 不能用（`POST
 * /api/meals/batch` 一律 400）。改 seed 用真正的 v4 UUID 治標不治本：demo
 * 上已經存在的資料改不動（要 `db:reset`，會清掉使用者自己建的資料），而且
 * 那個嚴格檢查本來就沒有任何安全意義——格式合法但不存在的 id 本來就會在
 * 查詢時 404，version/variant nibble 擋不住任何真的有害的輸入，只會擋自己
 * 的資料。所以收斂成這一支，不是把 32 處各自的 regex 對齊。
 */
const DB_UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const DbUuidSchema = z.string().regex(DB_UUID_PATTERN, 'Invalid UUID').openapi({
  format: 'uuid',
});

export const NullableDbUuidSchema = DbUuidSchema.nullable();
