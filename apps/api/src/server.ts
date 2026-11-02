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

// Workers 由 runtime 把 env 當 fetch 的第二個參數傳進來；Node 這裡照樣傳 process.env。
// **不能用 `app.use` 補**：那會排在 index 已經掛好的 auth 與路由之後，auth 先跑就拿不到 env，
// 每支 API 都 500「沒有資料庫連線來源」（#2100）。server.spec.ts 守
serve({ fetch: (req) => app.fetch(req, process.env), port: PORT }, (info) => {
  console.log(`Clessia API 在 http://localhost:${info.port} 執行中（Node）`);
});
