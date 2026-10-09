import { defineConfig } from 'vitest/config';

// 契約測試（#1435）：對**真的**本機 PostgREST 打路由，抓替身看不出來的 select／order／embed 錯誤。
// 跟一般 spec 分開跑 —— 它要本機 Supabase 起著，`npm test` 不該依賴這個。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.contract.ts'],
    testTimeout: 30_000,
  },
});
