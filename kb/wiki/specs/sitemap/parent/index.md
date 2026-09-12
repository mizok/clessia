---
title: 家長根路由（/parent）
summary: /parent 本身沒有畫面，它是一條轉址：直接打開會落在 /parent/dashboard。
category: spec
status: developing
tags: [sitemap, parent]
created: 2026-09-12
updated: 2026-09-13
---

# 家長根路由

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/parent`
**角色**：家長（`parent`）
**選單位置**：**選單不露出**（只能從別頁導過來或直接打網址）
**額外權限**：無

<!-- generated:route-facts end -->

## 這一頁沒有畫面

`/parent` **是一條轉址，不是一個頁面** —— 它沒有自己的元件、沒有自己的 `<main>` 內容。

`RoutesCatalog.PARENT_ROOT` 的 `showInMenu` 是 `false`，所以選單上不會出現它。
它存在的理由是當作 `/parent/**` 這棵子樹的根（`roleGuard` 掛在這一層），
以及讓「登入後導去家長端」這件事有一個可以指的位址 ——
`AuthService.navigateToRoleShell()` 與 `/select-role` 都指向這裡。

**進入方式**：登入後的自動導向（單一角色的家長）／ `/select-role` 選了家長 ／ 直接網址。

## 畫面區塊

**無。** 進來就被轉走。

## 互動元素

| 元素（畫面上的字） | 類型 | 出現條件 | 按了之後 |
| ------------------ | ---- | -------- | -------- |
| （無）             | —    | —        | —        |

## 狀態

| 狀態   | 畫面                         |
| ------ | ---------------------------- |
| 唯一   | 立刻轉到 `/parent/dashboard` |
| 未登入 | `authGuard` 擋下（**未驗**） |
| 非家長 | `roleGuard` 擋下（**未驗**） |

## 驗證紀錄

- **日期**：2026-09-12 ／ **前端版本**：`9f08061a`（主 checkout 的 dev server，port 4200）
- **視窗**：1504 × 695
- **角色帳號**：`parent01@demo.clessia.app`（家長 林志明）

開 `http://localhost:4200/parent`，等 3 秒後
`location.href` 是 `http://localhost:4200/parent/dashboard`。

### 兩向比對

不適用 —— 這條路由不會渲染任何自己的內容，量到的一切都屬於
[[specs/sitemap/parent/dashboard]]。**地圖與畫面都是空的，差異 0 筆。**

### 未驗到的

| 項目                             | 原因                                                            |
| -------------------------------- | --------------------------------------------------------------- |
| 未登入 / 非家長被擋下的行為      | 本輪全程帶著家長 session                                        |
| 轉址是 `redirectTo` 還是程式導向 | 只量了結果（網址列），沒有讀 `app.routes.ts` 對應那一段確認機制 |

## 390px

- **量測**：390 × 844 ／ 768 × 1024 ／ 1024 × 768 ／ 1504 × 752
- **前端**：主 checkout 的 dev server（port 4200），`fce2aefd`
- **身分**：`parent03@demo.clessia.app`（張建國，`roles:["parent"]`，3 個孩子）——
  量測前後各打一次 `GET /api/me`，兩次相同
- **取樣器**：#768 的四道濾網版，**外加 ④a 的修正**與 ④b 的 `visibleFast`（兩者本輪查出，已回寫方法頁）
- **手段**：同源 iframe 當 viewport

### 版面怎麼變

**不適用 —— 這條路由沒有畫面。** 390 與 1504 打進去，`location.pathname` 都停在
`/parent/dashboard`，`<main>` 的內容是儀表板的。

差別完全來自落地的那一頁（可見互動元素四個寬度都是 1），
見 [[specs/sitemap/parent/dashboard]] 的 `## 390px`。

### 差集 / 水平溢出 / 觸控目標 / 鍵盤可達性

**全部歸落地頁**，這裡不重抄（c11）。

### 未驗與原因

| 項目                   | 原因                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `roleGuard` 擋下非家長 | 同 Phase 1 —— 本輪的家長帳號只有 `parent` 角色                         |
| 768 / 1024             | 導向行為與寬度無關（`app.routes.ts` 的 `redirectTo`），沒有量           |
