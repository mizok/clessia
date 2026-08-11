import { defineConfig } from 'vitest/config';

// apps/api 的 spec 全部用假的 Supabase builder，不需要 Workers runtime 也不需要資料庫，
// 所以 node 環境就夠。specs 明確 import { describe, expect, it }，不需要 globals。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
