/**
 * Node 入口點 —— 讓 API 能在任何機器上跑，不只是 Cloudflare Workers。
 *
 *   node --import tsx apps/api/src/server.ts
 *
 * **這是憲法 c12 的實作證明**：「客戶必須能夠在自己的基礎設施上運行整套系統」。
 * 沒有這個檔案的話，那條原則在程式碼層面只是理論 —— `wrangler dev` 是唯一的跑法，
 * 而 wrangler 不能自架。
 *
 * Workers 從 `c.env` 拿設定，Node 從 `process.env` —— 這裡把後者包成前者的形狀，
 * 讓兩邊共用同一個 `app`。
 */
import { serve } from '@hono/node-server';
import app from './index';

const PORT = Number(process.env['PORT'] ?? 8787);

// Hono 在 Node 下不會自動注入 env，靠這層 middleware 補上（Workers 由 runtime 提供）
app.use('*', async (c, next) => {
  (c as unknown as { env: NodeJS.ProcessEnv }).env = process.env;
  await next();
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Clessia API 在 http://localhost:${info.port} 執行中（Node）`);
});
