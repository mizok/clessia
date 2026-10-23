---
title: iOS 主畫面 PWA 的外部登入交接（交接碼）
summary: iOS 主畫面 PWA 與 Safari 不共用 cookie，LINE／Google 授權完會落在 Safari，PWA 仍未登入。使用者 10-23 選交接碼：PWA 持 secret（不進 URL），Safari 完成登入後標記 handoff 並自動登出，PWA 回前景用 secret 換一次性登入連結。尚未實作。
category: architecture
tags: [architecture, auth, pwa, line, oauth]
status: draft
sources: [https://github.com/mizok/clessia/issues/2027]
updated: 2026-10-23
---

# iOS 主畫面 PWA 的外部登入交接（#2027）

> **狀態：設計已裁定（使用者 10-23：方案 A＋Safari 自動登出），尚未實作。** 原因是推論、還沒在 iPhone 實機驗證 —— 實作前先驗。

## 原因

`AuthService.signInWithLine()` 用 `authClient.signIn.social()` 整頁導到 LINE，callback 在我們的 API 設 session cookie 再導回 `/select-role`。
iOS 主畫面 PWA（`display: standalone`）是獨立 WebView，**cookie／storage 不跟 Safari 共用**；導到 scope 外（LINE）會跳出 PWA，
LINE App 授權完交回預設瀏覽器 Safari —— session 寫進 Safari，PWA 仍未登入。**改 callbackURL 解不了。**
Android（Chrome 的 PWA／WebAPK）與 Chrome 共用 cookie，預期沒事，要實機確認。綁定 LINE（`linkSocial`）也會跳出，但綁定已寫進伺服器、PWA 原本就登入著，影響小。

## 裁定的做法：交接碼

1. PWA（`display-mode: standalone`）按「用 LINE 登入」→ `POST /api/auth/handoff/start` → 伺服器存 `{ handoffId, secretHash, status: pending, expiresAt: +10 分 }`，回 `handoffId`＋`secret`。**secret 只留在 PWA，不進任何 URL**。
2. 外部流程的 `callbackURL` 是 `/login/handoff?h=<handoffId>`（只有 id）。
3. Safari 登入完成 → `/login/handoff` 頁呼叫 `POST /api/auth/handoff/complete { handoffId }`（要已登入；只能完成 pending、未過期的）→ 標 `{ status: done, userId }` → **登出 Safari 這邊的 session**（使用者裁定）→ 顯示「已登入，請回到 App」。
4. PWA 回前景（`visibilitychange`）→ `POST /api/auth/handoff/redeem { handoffId, secret }` → 比對 hash、一次性（用過即刪）、未過期 → 用既有的 `mintLoginLink`（magic link）替 `userId` 鑄連結 → PWA 在**自己的視窗**打開，session 寫進 PWA。

**安全性**：拿到 `handoffId` 的人（LINE、瀏覽紀錄）沒有 secret 換不到；10 分鐘＋一次性；`complete` 只能由已登入的本人標；`redeem` 失敗一律同一個錯誤；`start`／`redeem` 都限流。
**通用**：只認「外部流程後 Safari 有 session」，跟 provider 無關 —— Google 登入（#1842）同一套。

## 拒絕的替代方案

- PWA 內 `window.open` 彈窗＋`postMessage`：iOS standalone 的彈窗也是外部瀏覽器、沒有 `opener`、不共用 cookie。
- 引導家長改用 Safari、不裝 PWA：iOS 推播只在主畫面 PWA 才有。
- LINE LIFF：解決不了 PWA 本身的登入，範圍大。

## 影響（實作時）

一張短效表（migration，schema 與程式分開）、`routes` 三支端點、web 的登入頁與 `/login/handoff` 頁、`AuthService` 依 standalone 分流。保留類：認證。

相關：[[architecture/line-oauth-login]]
