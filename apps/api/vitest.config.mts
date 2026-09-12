import { defineConfig } from 'vitest/config';

// apps/api 的 spec 全部用假的 Supabase builder，不需要 Workers runtime 也不需要資料庫，
// 所以 node 環境就夠。specs 明確 import { describe, expect, it }，不需要 globals。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // 把 logAudit 的靜默失敗變成紅燈 —— 見 src/test-setup.ts
    //
    // `TT_MONTHS` 有值時多掛一支把時鐘推到未來的 setup（`npm run test:timetravel`，
    // 見 src/timetravel.setup.ts）。用環境變數開關而不是另開一份 config：
    // 兩份 config 會漂，而漂掉的那份跑的是別的東西。
    setupFiles: [
      'src/test-setup.ts',
      ...(process.env['TT_MONTHS'] ? ['src/timetravel.setup.ts'] : []),
    ],
  },
});
