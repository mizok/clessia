#!/usr/bin/env node
/**
 * 線上 smoke 探測。**部署完的東西真的活著嗎。**
 *
 * 判準與防腐化的理由見 `lib/smoke-probes.mjs` 的檔頭 —— 尤其那條
 * 「**不要探 `/health`**」（它在正式站永遠 200，就算 Worker 死了也一樣）。
 *
 * ## 兩個觸發，一支腳本
 *
 * - `npm run smoke` —— 本機跑，取代手工 curl
 * - 排程 GitHub Action —— **真正的後盾**
 *
 * **重點是排程而不是「部署後」**：部署後探測只在有人記得的時候跑。
 * 這個 repo 現在也沒有 deploy workflow 可以掛（web 走 Cloudflare 的 Git 整合、
 * api 是有人手動 `wrangler deploy`），所以「部署後」根本沒有掛鉤點。
 *
 * ## 成功靜默
 *
 * 排程每 N 分鐘跑一次，成功也叫的話訊號會被自己的噪音淹掉。
 * 失敗才輸出、才 exit 1 —— 由 workflow 去開 issue。
 */

import { extractScriptUrls, summarize } from './lib/smoke-probes.mjs';

const BASE = process.env.SMOKE_BASE_URL ?? process.argv[2] ?? 'https://demo.clessia.cc';
const TIMEOUT_MS = 15_000;

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    return { res, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** 每支探測都要能回答「它會抓到什麼壞掉」—— 答不出來的不要加 */
const probes = [
  {
    name: 'API 活著',
    catches: 'Worker 死了 / 路由掉了 / DB 連線炸了',
    async run() {
      const { res, body } = await get(`${BASE}/api/system-time`);
      if (res.status !== 200) return `HTTP ${res.status}`;
      // **content-type 一定要驗**：正式站的路由若掉了，Pages 會回 SPA 的
      // index.html 而且是 200 —— 只看狀態碼的話這支探測永遠不會失敗。
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('application/json')) {
        return `content-type 是 ${type || '(空)'}，不是 JSON —— 多半是被 Pages 接走了`;
      }
      const data = JSON.parse(body);
      if (typeof data.epochMs !== 'number') return `回應缺 epochMs：${body.slice(0, 120)}`;
      return null;
    },
  },
  {
    name: 'SPA 殼送得出來',
    catches: 'Pages 沒部署 / index.html 壞了',
    async run() {
      const { res, body } = await get(`${BASE}/login`);
      if (res.status !== 200) return `HTTP ${res.status}`;
      // 斷言**結構上非有不可**的標籤，不斷言文案 ——
      // 文案改得勤，而因文案被合理修改而變紅的探測第三次就會被關掉。
      if (!body.includes('<app-root')) return '回應裡沒有 <app-root>，不是這個 SPA 的殼';
      return null;
    },
  },
  {
    name: '前端 chunk 取得到',
    catches: '**index.html 上了但 chunk 沒上** —— Pages 真實的失敗模式',
    async run() {
      const { res, body } = await get(BASE);
      if (res.status !== 200) return `根路徑 HTTP ${res.status}`;
      // 期望值**從剛部署的 index.html 讀出來**，不是維護一份清單。
      // 今天叫 main-A1B2.js、明天叫別的，這支探測都不用改。
      const scripts = extractScriptUrls(body, BASE);
      if (scripts.length === 0) return 'index.html 裡一個 <script src> 都沒有';
      for (const url of scripts) {
        const asset = await get(url);
        if (asset.res.status !== 200) return `${url} → HTTP ${asset.res.status}`;
        const type = asset.res.headers.get('content-type') ?? '';
        if (!/javascript|ecmascript/i.test(type)) {
          return `${url} 的 content-type 是 ${type || '(空)'} —— 多半是 404 被 SPA fallback 接走`;
        }
      }
      return null;
    },
  },
];

const results = [];
for (const probe of probes) {
  try {
    const failure = await probe.run();
    results.push({
      name: probe.name,
      ok: failure === null,
      detail: failure ?? `正常（守的是：${probe.catches}）`,
    });
  } catch (err) {
    // **逾時與 DNS 失敗也是失敗** —— 探測自己爆掉不能算通過
    results.push({
      name: probe.name,
      ok: false,
      detail: `探測本身失敗：${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

const summary = summarize(results);
if (summary.ok) {
  // 成功靜默：只在本機互動時給一行，排程模式什麼都不印
  if (!process.env.CI) console.log(`✓ smoke 全過（${BASE}）`);
  process.exit(0);
}

console.error(`✖ ${summary.title}\n${summary.body}`);
process.exit(1);
