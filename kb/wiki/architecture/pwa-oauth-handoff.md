---
title: iOS 主畫面 PWA 的外部登入交接（交接碼）
summary: iOS 主畫面 PWA 與 Safari 不共用 cookie，LINE／Google 授權完會落在 Safari，PWA 仍未登入。使用者 10-23 選交接碼：PWA 持 secret（不進 URL），Safari 完成登入後標記 handoff 並自動登出，PWA 回前景用 secret 換一次性登入連結。已實作。
category: architecture
tags: [architecture, auth, pwa, line, oauth]
status: active
sources: [https://github.com/mizok/clessia/issues/2027]
updated: 2026-10-28
---

# iOS 主畫面 PWA 的外部登入交接（#2027）

> **狀態：使用者 10-23 裁定方案 A＋Safari 自動登出；10-28 實機確認會跳 Safari；已實作（#2041 schema＋程式 PR）。**

## 原因

`AuthService.signInWithLine()` 用 `authClient.signIn.social()` 整頁導到 LINE，callback 在我們的 API 設 session cookie 再導回 `/select-role`。
iOS 主畫面 PWA（`display: standalone`）是獨立 WebView，**cookie／storage 不跟 Safari 共用**；導到 scope 外（LINE）會跳出 PWA，
LINE App 授權完交回預設瀏覽器 Safari —— session 寫進 Safari，PWA 仍未登入。**改 callbackURL 解不了。**
Android（Chrome 的 PWA／WebAPK）與 Chrome 共用 cookie，預期沒事，要實機確認。綁定 LINE（`linkSocial`）也會跳出，但綁定已寫進伺服器、PWA 原本就登入著，影響小。

## 裁定的做法：交接碼

1. PWA（`display-mode: standalone`）按「用 LINE 登入」→ `POST /api/auth-handoff/start` → 伺服器存 `{ handoffId, secretHash, status: pending, expiresAt: +10 分 }`，回 `handoffId`＋`secret`。**secret 只留在 PWA，不進任何 URL**。
2. 外部流程的 `callbackURL` 是 `/login/handoff?h=<handoffId>`（只有 id）。
3. Safari 登入完成 → `/login/handoff` 頁呼叫 `POST /api/me/auth-handoff/{id}/complete { handoffId }`（要已登入；只能完成 pending、未過期的）→ 標 `{ status: done, userId }` → **登出 Safari 這邊的 session**（使用者裁定）→ 顯示「已登入，請回到 App」。
4. PWA 回前景（`visibilitychange`）→ `POST /api/auth-handoff/{id}/redeem { handoffId, secret }` → 比對 hash、一次性（用過即刪）、未過期 → 用既有的 `mintLoginLink`（magic link）替 `userId` 鑄連結 → PWA 在**自己的視窗**打開，session 寫進 PWA。

**安全性**：拿到 `handoffId` 的人（LINE、瀏覽紀錄）沒有 secret 換不到；10 分鐘＋一次性；`complete` 只能由已登入的本人標；`redeem` 失敗一律同一個錯誤；`start`／`redeem` 都限流。
**通用**：只認「外部流程後 Safari 有 session」，跟 provider 無關 —— Google 登入（#1842）同一套。

## 防交接劫持（10-28 計畫席讀 diff 擋，已加）

第一版 `complete` 只要已登入就能標任何 handoffId，Safari 頁又一打開就自動 complete —— 攻擊者自己 `start`，
把 `/login/handoff?h=<他的 id>` 傳給受害者，受害者一點，攻擊者用自己的 secret 就換到受害者的帳號。現在：

1. **session 必須晚於交接建立**（`authMiddleware` 把 `session.createdAt` 放進 context）：早就登入著、點別人傳來的連結不算。
2. **配對碼**（OAuth device flow 的防釣魚做法）：`start` 回 4 位數（DB 存綁 id 的雜湊），PWA **先顯示號碼**、
   按鈕變「記下號碼，前往 LINE」，再按一次才去 LINE；Safari 頁**不自動完成**，問「把這次登入交給 App？」、
   要輸入相同的號碼並按確認。錯 5 次失效 —— **每次猜都先用 CAS 把次數 +1 佔到名額才比對**（審核席二讀：先比對、錯了才 +1 的話，並發的錯誤猜測只有一個算到次數，平行送就繞過上限）。號碼打錯不登出 Safari（還能再試），完成或失效才登出。
3. **每個來源的上限**：`start` 存發起 IP 的 HMAC（同招生表單的 `hashClientIp`，表裡沒有可還原的 IP），
   同一來源同時未過期最多 5 筆，防有人灌滿全域上限讓所有人 10 分鐘登不了。

## 拒絕的替代方案

- PWA 內 `window.open` 彈窗＋`postMessage`：iOS standalone 的彈窗也是外部瀏覽器、沒有 `opener`、不共用 cookie。
- 引導家長改用 Safari、不裝 PWA：iOS 推播只在主畫面 PWA 才有。
- LINE LIFF：解決不了 PWA 本身的登入，範圍大。

## 實作（10-28）

- **API**（`routes/auth-handoff.ts`）：`start`、`redeem` 掛在 `/api/auth-handoff`、`authMiddleware` **之前**（PWA 還沒登入；自己建 service client，同 `publicOrgMiddleware`）。
  不放 `/api/public/*`：那會被 `PUBLIC_ORG_SLUG` 綁住，登入不能依賴招生頁的開關 —— 所以在 harness 的 app.route 例外與 `mount-authz.spec` 的 `UNMOUNTED` 明列。
  要登入的 `complete` 掛在已經是 `ANY_ROLE` 的 `/api/me/auth-handoff`（不跟公開的兩支共用 mount 前綴：mount 前綴底下第一個註冊的必須是守衛）。
- `start`：全域同時未過期上限 500（公開端點防灌爆），順手清過期的。`redeem`：`id＋secret 雜湊＋未過期` 一起查 —— secret 不對跟不存在分不出來，**還沒完成時 secret 不對也是 404**（不洩漏「還在等」）；換的時候 `delete … returning` 一次性，再 `mintLoginLinkForRequest` 鑄連結。
- **web**：`AuthHandoffService`（standalone 偵測、localStorage 存 id＋secret、redeem、complete＋登出 Safari）；`AuthService.signInWithLine` 在 standalone 時 callbackURL 換成 `/login/handoff?h=<id>`；登入頁進頁與 `visibilitychange` 時換；落地頁 `/login/handoff` 是 `access: 'public'`（不能 guest-only —— 落地時 Safari 是登入狀態）。

## 影響

一張短效表（migration，schema 與程式分開）、`routes` 三支端點、web 的登入頁與 `/login/handoff` 頁、`AuthService` 依 standalone 分流。保留類：認證。

相關：[[architecture/line-oauth-login]]
