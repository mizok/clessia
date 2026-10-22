import { defineConfig } from 'vitest/config';

// 測試一律在 UTC 跑，跟 CI 一致（#1558）。本機時區＝台北時，拿掉 '+0800'／'Asia/Taipei' 這類突變
// 全綠、只有 CI 紅；那些「台北日界線 ±1 分鐘」的 fixture 也只在 UTC 下才有作用。
// 設在 config 而不是 npm script：config 在主行程、worker 起來之前就跑，worker 繼承環境變數，
// 所以 nx、直接 `npx vitest`、突變腳本都吃得到。
// 只在沒設時給 UTC：要用別的時區驗（例：`TZ=America/Los_Angeles` 驗負時區）照帶就生效（review3 二讀）
process.env['TZ'] ??= 'UTC';

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
