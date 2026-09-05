import { z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';

import { DbUuidSchema } from './validation';

/**
 * P0-1（2026-09-06）：`supabase/seed.sql` 用可讀 id（例如這裡測的
 * `61000000-0000-0000-0000-000000000001`）方便 debug 時一眼看出是第幾個
 * 學生。它的 version/variant nibble 都是 `0`，Postgres 的 `uuid` 型別收，
 * 但 `z.uuid()`（檢查 RFC4122 version/variant）不收——30 支 route 檔案
 * 直接用 `z.uuid()` 驗證 id 的地方整批拒絕，餐費管理在 demo 上因此
 * 100% 不能用。
 *
 * **這裡刻意用 seed 格式的 id 當測試資料，不是隨手選的值。** 這套測試
 * 套件裡幾乎所有其他地方的佔位 UUID 都是 `xxxx-4xxx-8xxx-...`
 * （RFC4122 合法），所以「測試資料的形狀」本身看不到這一類 bug——
 * 拿掉這條測試、把 id 換成看起來更「正常」的 v4 格式，這個洞會在
 * 察覺不到的情況下回來。
 */
describe('DbUuidSchema', () => {
  it('accepts canonical Postgres UUID strings used by seed data', () => {
    const result = DbUuidSchema.safeParse('61000000-0000-0000-0000-000000000001');

    expect(result.success).toBe(true);
  });

  it('rejects malformed UUID strings', () => {
    const result = DbUuidSchema.safeParse('not-a-uuid');

    expect(result.success).toBe(false);
  });

  it('對照組：z.uuid() 會拒絕同一個 seed id —— 這正是 P0-1 的根因，不是假設', () => {
    expect(z.uuid().safeParse('61000000-0000-0000-0000-000000000001').success).toBe(false);
  });

  it('真正的 v4 UUID（gen_random_uuid() 產生的那種）也接受', () => {
    const result = DbUuidSchema.safeParse('5627c510-47fe-4c69-b139-91c1b63d71e1');

    expect(result.success).toBe(true);
  });
});
