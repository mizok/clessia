---
title: 管理員根路由（/admin）
summary: /admin 沒有自己的畫面 —— 它是一條明式 redirect 到儀表板，而那條 redirect 是 children 的最後一筆。
category: spec
status: developing
tags: [sitemap, admin]
created: 2026-09-12
updated: 2026-09-12
---

# 管理員根路由

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/admin`
**角色**：管理員（`admin`）
**選單位置**：**選單不露出**（只能從別頁導過來或直接打網址）
**額外權限**：無

<!-- generated:route-facts end -->

## 這一條沒有畫面

**`/admin` 不渲染任何東西，它 redirect 到 `/admin/dashboard`。**

實測：開 `http://localhost:4210/admin` → 網址列變成 `/admin/dashboard`，
畫面是 [[specs/sitemap/admin/dashboard]]。

**選單上也沒有它**（`showInMenu: false`），所以正常操作不會走到 —— 
會走到它的是**手打網址**或**存了舊書籤**。

## 那條 redirect 在哪

`app.routes.ts:333-336`，**ADMIN_ROOT 的 `children` 陣列最後一筆**：

```ts
{ path: '', redirectTo: RoutesCatalog.ADMIN_DASHBOARD.relativePath, pathMatch: 'full' }
```

⚠️ **它不是全域 wildcard 兜到的。** 全域那條是
`{ path: '**', redirectTo: 'login' }`（`:509`）—— 如果 admin 底下**沒有**這一筆，
`/admin` 會被丟去登入頁，而使用者當時是登入著的。

> 📌 我第一次查的時候用 `awk 'NR>=s && NR<=s+250'` 掃 ADMIN_ROOT 區段，
> **窗口剛好切在第 333 行前面**，於是結論是「admin 底下沒有預設子路由」。
> 那是本 repo 記過的「你為了讓輸出好讀所做的每一件事都可能把答案一起清掉」。
> 是實測結果（真的導到 dashboard）跟那個結論對不上，才回去把窗口拉大。

## 守衛

`canActivate: [roleGuard('admin')]` 掛在 ADMIN_ROOT 上，
所以**非 admin 角色連 redirect 都走不到**，會先被 roleGuard 攔下。
外層另有 shell 的 `authGuard`（`:81`）。

## 互動元素

**無。** 這條路由不渲染內容。

## 驗證紀錄

- **狀態**：已驗
- **前端版本**：最新 main，自架 `:4210`
- **做法**：以 admin 身分開 `/admin`，讀 `location.pathname` 與 `<main>` 內容
- **未驗**：非 admin 角色開 `/admin` 會被導去哪（需要切角色，而切角色會踢掉別席的瀏覽器 session）
