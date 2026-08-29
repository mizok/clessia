---
title: 部署
summary: 三個元件（Supabase / Workers / Pages）、哪些步驟只有人能做、以及為什麼 API 必須能在 Node 底下跑。
category: architecture
tags: [architecture, deployment, cloudflare, supabase]
status: active
updated: 2026-08-29
---

# 部署

## 三個元件

|        | 跑在哪                                                 | 誰付錢                                              |
| ------ | ------------------------------------------------------ | --------------------------------------------------- |
| 資料庫 | Supabase（建議 `ap-northeast-1` 東京，對台灣延遲最低） | **客戶**（見 [[architecture/vendor-relationship]]） |
| API    | Cloudflare Workers                                     | 供應商或客戶                                        |
| Web    | Cloudflare Pages                                       | 同上                                                |

部署目標寫在 `apps/api/wrangler.toml`。**允許的來源不寫死在任何檔案裡** —— 見下方「每個客戶自己的網域」。
`AGENTS.md` 曾寫「Deploy: Vercel」，那是文件漂移，已修。

## API 必須能在 Node 底下跑

`apps/api/src/server.ts` 是 Node 入口點：

```bash
node --import tsx apps/api/src/server.ts
```

**這是憲法 [[architecture/constitution|c12]] 的實作證明**。沒有它，「客戶能自架」在程式碼層面
只是理論——`wrangler dev` 是唯一跑法，而 wrangler 不能自架。

已實測：根路徑回 200、未登入的 `/api/me` 回 401（middleware 有作用）。

## 機密不進版控，但非機密**必須**進版控

`wrangler.toml` 會進版控，**只放非機密設定** —— 而且非機密設定**只能放這裡**。
用 `--var` 跟著部署指令給的值只活在那一次部署：下一個人裸跑 `wrangler deploy`
就會把它們全部丟掉。2026-08-29 正式站的 LINE 登入就是這樣斷的
（`PROVIDER_NOT_FOUND` —— LINE_CLIENT_ID 隨著一次乾淨的重新部署蒸發）。
`[env.production.vars]` 必須列出全部非機密設定；secrets 有跨部署保留機制，不受影響。

四個機密走 `wrangler secret`：

```bash
npx wrangler secret put SUPABASE_SECRET_KEY --env production
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put DATABASE_URL --env production
npx wrangler secret put LINE_CLIENT_SECRET --env production
```

非機密的部署值用 `--var` 在部署時傳（不寫進 `wrangler.toml`，每個客戶不同）：

```bash
npx wrangler deploy --env production \
  --var SUPABASE_URL:https://<ref>.supabase.co \
  --var BETTER_AUTH_URL:https://<你的網域> \
  --var WEB_URL:https://<你的網域> \
  --var ALLOWED_ORIGINS: \
  --var LINE_CLIENT_ID:<Channel ID>
```

> ⚠️ **忘記帶 `LINE_CLIENT_ID` 就沒有人能登入。** `socialProvidersFromEnv` 少一個變數
> 就整個不設定 provider，登入頁的 LINE 按鈕會**靜默失效**，而且沒有任何錯誤指向設定缺失。
> 唯一的退路是 `npm run login-link`。

本機開發放 `apps/api/.dev.vars`（已 gitignore）。

> 2026-08 之前 `wrangler.toml` 直接寫了這三個值，其中 `DATABASE_URL` 含 `postgres:postgres`
> 明文。那是本機值不是正式值，但格式本身就在教人把正式值也寫進去。

## 每個客戶自己的網域

允許的來源不寫死。每個客戶是自己的部署、自己的網域（c12），寫死等於只有一個客戶能用。
三個來源合併（`apps/api/src/lib/origins.ts` 的 `allowedOrigins()`）：

| 來源                  | 說明                                                         |
| --------------------- | ------------------------------------------------------------ |
| `WEB_URL`             | 這個部署的前端。**依定義可信，不必再列進 `ALLOWED_ORIGINS`** |
| `ALLOWED_ORIGINS`     | 逗號分隔的額外來源（自訂網域、第二個前端）                   |
| localhost / 127.0.0.1 | 本機開發，任意 port                                          |

都沒設定時只剩本機來源，正式站會全部被 CORS 擋掉。這是刻意的 fail-closed：忘記設定的
症狀是「連不上」，不是「誰都連得上」。

> ⚠️ **允許清單一定要從 `c.env` 讀，不能在模組層級算好。** Cloudflare Workers 的環境變數
> 在 request-scoped 的 `c.env` 上，不在 `process.env`（`compatibility_date` 早於 Cloudflare
> 開始填 `process.env` 的版本）。2026-08 第一次上線時就是這樣：模組層級的常數在載入時
> 讀 `process.env` 拿到空字串，正式站前端整個被 CORS 擋，而本機測試全綠 —— 因為測試呼叫
> `app.request(url, init)` 時沒帶第三個參數 `env`，走的是同一條 localhost 路徑。
> `process.env` 的退路只服務 Node 自架（`server.ts`）。

## 前端與 API 必須同源

**部署方式是兩者掛在同一個 hostname 上**：

```text
demo.clessia.cc/         → Cloudflare Pages（前端）
demo.clessia.cc/api/*    → Cloudflare Worker（API，用 route 不是 custom domain）
```

Worker route 的優先權高於 Pages，所以 `/api/*` 會被 Worker 接走，其餘走 SPA。
⚠️ **一定要選 Route 不是 Custom domain** —— Custom domain 會接管整個 hostname，把前端也吃掉。

`environment.production.ts` 的 `apiUrl` 因此是**空字串**（相對路徑）。

### 為什麼不是子網域

`app.example.com` + `api.example.com` 是**同站但不同源**，cookie 仍受 SameSite 規則管。
同源則完全不適用那些規則，而且連 CORS 都不需要。

### 這裡踩過的坑（別再回去）

2026-08 曾經是跨站部署（`clessia.pages.dev` 對 `*.workers.dev`），為此加了
`SameSite=None; Secure; Partitioned`。兩個後果：

1. **iOS 18.3 以下的 Safari 完全登不進去** —— 它封鎖所有非分區的第三方 cookie，
   而 `Partitioned`（CHIPS）要 Safari 18.4 才支援
2. **`Partitioned` 打斷了 OAuth** —— state cookie 在「前端發的 XHR」時被設定
   （分區鍵是前端），但 callback 是「LINE 導回來的頂層導航」（分區鍵不同），
   cookie 送不出去，每次登入都 `state_mismatch`

同源之後這兩個問題都消失，`crossSiteCookieAttributes()` 整段已刪除。

> `.cc` 不在 HSTS 預載清單裡（`.app` / `.dev` 才有），所以強制 HTTPS 要在
> Cloudflare 的 SSL/TLS → Edge Certificates → HSTS 手動開。**開之前先確認網站
> 能正常用 HTTPS** —— HSTS 生效後瀏覽器會記住一段時間，設錯很難救。

## SPA fallback

`apps/web/public/_redirects`：

```
/*    /index.html   200
```

沒有它，任何非根路徑重新整理都會 404——Angular 的路由在瀏覽器端，
`/admin/students` 在伺服器上沒有對應檔案。`200` 是 rewrite 不是 302。

## 只有人能做的步驟

1. **建 Supabase 專案**、拿 service role key 與 connection string
2. **`npx supabase link --project-ref <ref>`** 然後 `supabase db push` 套用 migration
3. **`npx wrangler login`**、`wrangler secret put`（上面四個）
4. **決定網域**與 Cloudflare 帳號歸屬。在 Dashboard 掛上：
   Pages 的 custom domain（`<網域>`）與 Worker 的 **route**（`<網域>/api/*`，
   **不是 custom domain** —— 那會接管整個 hostname 把前端吃掉）
5. **申請 LINE Developers channel**，把 Callback URL 設成
   `https://<網域>/api/auth/callback/line`
6. **`npm run bootstrap`** 建組織與第一個管理員（見 [[architecture/bootstrapping-a-deployment]]）
7. 用它印出的**一次性登入連結**登入，在畫面上綁定 LINE

## 已知待處理

- **initial bundle 超出 500 kB 的預算**（`apps/web/project.json` 的 `maximumWarning`）。目前只是警告，但那是真的大。跑 `npx nx build web --configuration=production` 看現值 —— **不在這裡抄數字**（c11）。
  多數來自 PrimeNG 與 xlsx —— 值得檢查有沒有被不必要地打進 initial chunk（`pdfmake` 已於 2026-08 移除）
- **Supabase 免費方案閒置 7 天會暫停**。天天用不會碰到；先開著給人看會踩到
