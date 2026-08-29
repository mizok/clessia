---
title: 認證連線池的生命週期
summary: createAuth() 每請求開 1–2 個 pg Pool 且從不關閉（批次匯入的迴圈裡一次開 50 個）；Workers 凍結 timer 使 pg 的 idle 自救失效。修法：getAuth(c) 讓同請求共用單一池，收尾交給掛在最前面的 cleanup middleware 在 await next() 之後做。singleton 在 Workers 是錯的，而在 getAuth 裡 waitUntil(pool.end()) 也是錯的。
category: architecture
status: active
updated: 2026-08-29
tags: [architecture, auth, workers, database]
---

# 認證連線池的生命週期

> 2026-08-29 設計。修的是 [[architecture/line-oauth-login]] 已知風險表裡
> 「連線池從未關閉」那一條 —— P4 家長端流量進來之前要治好。

## 問題

`createAuth()`（`apps/api/src/auth.ts`）每次呼叫 `new Pool()`，全 API 沒有任何
一處 `.end()`。呼叫點 **API 7 處 + CLI 2 處**：

- `middleware/auth.ts` —— **每支已認證的 `/api/*` 請求都跑**
- `index.ts` 的 `/api/auth/*` handler
- `routes/parents.ts` ×3、`routes/staff.ts`、`routes/login-links/mint.ts`
  —— 這些在 authMiddleware 之後又各自 `createAuth`，**同一請求開第二個池**
- CLI：`scripts/login-link.ts`、`scripts/bootstrap-org.ts`（不在本設計範圍）。
  這兩支各自為查詢開了一個池並有 `.end()`，但 `createAuth` 內部那個池同樣沒關 ——
  process 結束就收乾淨，不構成問題

最嚴重的一處是 `routes/parents.ts` 的批次匯入：`createAuth` 在**逐列建立家長帳號的
迴圈裡面**，一次匯入 50 列就是 50 個連線池。

為什麼還沒炸：pg Pool 的 `idleTimeoutMillis`（預設 10s）平常會自己收 idle 連線，
但 **Workers 在回應送出後凍結 isolate 的 timer**，自救機制不可靠 —— 目前是靠
Supabase 端超時收屍。流量上來就是連線風暴。

## 為什麼不是 singleton

教科書解法（模組層共用一個 Pool）在 Workers 是**錯的**：I/O 物件不能跨請求使用
（`Cannot perform I/O on behalf of a different request`）。per-request 建池的方向
沒錯，錯的是（a）沒收尾、（b）同請求重複開。

## 為什麼收尾不能寫在 `getAuth` 裡

本設計原本寫的是「`getAuth` 建完池就 `c.executionCtx.waitUntil(pool.end())` 註冊收尾」。
**那樣會當場把池關掉**，第一個 auth 查詢就炸：

- `pool.end()` 是**呼叫當下**同步把 pool 標成 ending（`pg-pool` 的 `end()` 第一件事
  就是 `this.ending = true`），之後任何 `connect()` 直接丟
  `Cannot use a pool after calling end on the pool`
- `waitUntil(p)` 收的是**一個已經在跑的 promise**。它只延長 isolate 的壽命，
  不會延後 promise 的執行

而 `getAuth` 身處請求中段，本身無從得知請求何時結束。所以收尾必須由一支知道
「請求已經跑完」的 middleware 來做。

## 修法：`getAuth(c)` + `authPoolCleanup`

`apps/api/src/lib/get-auth.ts`（新檔）兩個 export：

**`getAuth(c)`** —— 只負責建一次 + 快取：

1. `c.get('auth')` 有就直接還 —— 同請求 7 個呼叫點共用一個池
2. 沒有：`createAuth(c.env, capture)` → `c.set('auth', ...)` → 回傳
3. `createAuth` 用 `Object.assign(auth, { pool })` 把 pool 掛在回傳物件上讓收尾拿得到 ——
   對外介面不變，CLI script 照舊

**`authPoolCleanup`** —— 掛在 `index.ts` 的全域 middleware 區、**所有會用到 auth 的
東西之前**（掛太後面的話 `/api/auth/*` 那條路開的池收不到）：

```ts
await next(); // handler 跑完、response 已成形
const auth = c.get('auth');
if (!auth) return; // 這個請求沒用到 auth，沒有池要收
const closing = auth.pool.end().catch(() => undefined);
try {
  c.executionCtx.waitUntil(closing);
} catch {
  /* 見下 */
}
```

`c.executionCtx` 在沒有 ExecutionContext 時**會丟例外**（測試的 `app.request()`、
部分本機情境），所以是 try/catch 不是 optional chaining。catch 分支什麼都不用做：
`end()` 上一行已經開始跑了，而那些環境沒有 isolate 凍結的問題，關掉就夠了。

### magic-link 的 capture 槽

`mintLoginLink` 原本走 `createAuth(env, capture)` —— 那個 callback 是**建立實例時
綁死的**，用來把 magic-link 的 url 攔下來。共用實例之後就不能這樣綁：
`POST /api/login-links` 先過 authMiddleware（已經建好一個沒有 capture 的實例），
mint 拿到快取實例就永遠攔不到 url、回 null。

所以 capture 改成**每請求的可變槽**：`getAuth` 固定傳
`(payload) => c.get('magicLinkCapture')?.(payload)`，由呼叫端在呼叫前 `c.set`、
**用完立刻清成 `undefined`**（留著的話同一個請求後續任何 magic-link 流程都會被那個
閉包攔走）。

`mint.ts` 因此拆成兩個 export，共用內層：

- `mintLoginLinkForRequest(c, email)` —— API 的 3 個呼叫端用，共用請求的池
- `mintLoginLink(env, email)` —— CLI 用，簽名不變，自己建實例

## 拒絕的替代方案

- **模組層 singleton** —— Workers 跨請求 I/O 限制，直接不可行
- **Hyperdrive** —— 多一個 Cloudflare 專屬依賴與設定面，客戶自架的故事（c12）
  變複雜；免費額度未查證。連線多工的需求等量測到再說
- **換 HTTP-based driver** —— 動到 better-auth 的 database 介面，改動半徑大十倍

## 驗證

- 單元測試 `src/lib/get-auth.spec.ts`：同 context 兩次呼叫回同一實例；不同請求不共用；
  收尾把 promise 交給 waitUntil 且 pool 進入 ending；無 executionCtx 時不炸且照樣關池；
  沒用到 auth 的請求不註冊收尾
- 既有 auth 相關測試全綠（`auth.spec.ts`、`index.spec.ts`、`middleware/auth.spec.ts`）
- 手動：本機 `wrangler dev` 打幾個請求後
  `select count(*) from pg_stat_activity` 觀察連線數回落

## 範圍外（記錄，不處理）

- 正式站 `DATABASE_URL` 是 pooler（6543）還是直連（5432）—— 使用者確認中；
  若是直連，改用 pooler 是免費加成，屬部署設定不屬程式碼
- `createServiceClientFromEnv`（supabase-js）是 HTTP client，無連線生命週期問題
