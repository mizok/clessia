---
title: 部署
summary: 三個元件（Supabase / Workers / Pages）、哪些步驟只有人能做、以及為什麼 API 必須能在 Node 底下跑。
category: architecture
tags: [architecture, deployment, cloudflare, supabase]
status: active
updated: 2026-08-24
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

## 機密不進版控

`wrangler.toml` 會進版控，**只放非機密設定**。三個機密走 `wrangler secret`：

```bash
npx wrangler secret put SUPABASE_SECRET_KEY --env production
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put DATABASE_URL --env production
```

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

## 跨站 session cookie（目前是權宜之計）

前端與 API 在**不同的 eTLD+1** 時 —— 例如 `clessia.pages.dev` 對 `*.workers.dev`，
兩者都在 Public Suffix List 上 —— 瀏覽器不會把預設 `SameSite=Lax` 的 session cookie
帶到跨站請求上。

**症狀極具誤導性**：`POST /api/login` 回 200（登入其實成功了），但緊接著的 `/api/me`
回 401，前端的 `catch` 把它當成「沒有角色」，畫面顯示**「此帳號尚未被指派角色」**。
第一次上線時就是這樣，排查方向一度指向 bootstrap 沒寫 `user_roles`。

`apps/api/src/auth.ts` 的 `crossSiteCookieAttributes()` 在 https 時改發
`SameSite=None; Secure; Partitioned`。

| 瀏覽器                        | 可用                                     |
| ----------------------------- | ---------------------------------------- |
| Chrome / Edge / Firefox       | ✅                                       |
| Safari 18.4 以上（iOS 18.4+） | ✅ `Partitioned` 是 CHIPS，18.4 才支援   |
| **Safari 18.3 以下**          | ❌ 完全封鎖第三方 cookie，這個設定救不了 |

硬體斷點是 2017 年的 iPhone X / 8（最高只能升到 iOS 16）。但**更大的風險是沒更新
系統的人** —— 而且他們看到的錯誤訊息完全不會指向「請更新 iOS」。

### 根治：同一個 eTLD+1

把前端與 API 放到同一個註冊網域底下：

```text
app.example.com   → Cloudflare Pages
api.example.com   → Cloudflare Worker
```

兩者的 eTLD+1 都是 `example.com`，瀏覽器視為同站，預設的 `SameSite=Lax` 就會被帶出去。
**這時 `crossSiteCookieAttributes()` 整段可以刪掉**，而且所有瀏覽器都能用，包含舊 Safari。

賣給客戶時本來就需要自己的網域（不會把 `pages.dev` 交出去），所以這不是額外成本。

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
3. **`npx wrangler login`**、`wrangler secret put`（上面三個）
4. **決定網域**與 Cloudflare 帳號歸屬
5. **`npm run bootstrap`** 建組織與第一個管理員（見 [[architecture/bootstrapping-a-deployment]]）

## 已知待處理

- **initial bundle 超出 500 kB 的預算**（`apps/web/project.json` 的 `maximumWarning`）。目前只是警告，但那是真的大。跑 `npx nx build web --configuration=production` 看現值 —— **不在這裡抄數字**（c11）。
  多數來自 PrimeNG 與 pdfmake / xlsx —— 值得檢查有沒有被不必要地打進 initial chunk
- **Supabase 免費方案閒置 7 天會暫停**。天天用不會碰到；先開著給人看會踩到
