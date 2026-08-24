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

| | 跑在哪 | 誰付錢 |
| --- | --- | --- |
| 資料庫 | Supabase（建議 `ap-northeast-1` 東京，對台灣延遲最低） | **客戶**（見 [[architecture/vendor-relationship]]） |
| API | Cloudflare Workers | 供應商或客戶 |
| Web | Cloudflare Pages | 同上 |

`wrangler.toml` 與 CORS 白名單裡的 `clessia.pages.dev` 都指向 Cloudflare。
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
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put DATABASE_URL --env production
```

本機開發放 `apps/api/.dev.vars`（已 gitignore）。

> 2026-08 之前 `wrangler.toml` 直接寫了這三個值，其中 `DATABASE_URL` 含 `postgres:postgres`
> 明文。那是本機值不是正式值，但格式本身就在教人把正式值也寫進去。

## 每個客戶自己的網域

`ALLOWED_ORIGINS`（逗號分隔）取代了寫死的 `clessia.pages.dev`。每個客戶是自己的部署、
自己的網域（c12），寫死等於只有一個客戶能用。

沒設定時是空的——**只有本機開發來源會被放行**，正式站會全部被 CORS 擋掉。這是刻意的
fail-closed：忘記設定的症狀是「連不上」，不是「誰都連得上」。

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

- **initial bundle 754 kB**（預算 500 kB）。目前只是警告，但那是真的大。
  多數來自 PrimeNG 與 pdfmake / xlsx —— 值得檢查有沒有被不必要地打進 initial chunk
- **Supabase 免費方案閒置 7 天會暫停**。天天用不會碰到；先開著給人看會踩到
