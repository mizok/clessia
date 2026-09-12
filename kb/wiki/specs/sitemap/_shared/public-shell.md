---
title: 公開頁外框（PublicShell，login / trial / enrollment / qr-checkin / link-line / select-role 共用）
summary: 六個公開頁共用的外框：橘色品牌面（字標、標語、流場動畫、四條輕量連結、版權）+ 白色主面。
category: spec
status: developing
tags: [sitemap, _shared, public]
created: 2026-09-12
updated: 2026-09-12
---

# 公開頁外框（PublicShell）

**元件**：`@features/public/public-shell.component`

`/login`、`/trial`、`/enrollment`、`/qr-checkin`、`/link-line`、`/select-role`
**全部走這一個外框**（`app.routes.ts` 最上層那個 `path: ''` 的 children）。

> **這一頁跟 [[specs/sitemap/_shared/shell-layout]] 是兩個不同的外框。**
> ShellLayout 是登入後的 admin / teacher / parent 用的（左側選單 + 頂列角色徽章），
> PublicShell 是公開頁用的（橘色品牌面 + 白面）。六頁的地圖**只寫 `<main>` 裡面的東西**。

## 畫面區塊

### 1. 品牌面（`<aside>`，桌機在左、手機在上）

橘色底，上面疊一層 `app-flow-field` 的流場動畫（`density=0.8`、`speed=1`，純裝飾）。
由上而下：

- **字標** `Clessia` —— 是一條連結，指向 `/login`
- 標語 `學程管家`
- 副標 `讓學習旅程更輕鬆`
- （貼底）**四條輕量連結**
- 版權 `© 2025 Clessia Academy`

### 2. 主面（`<main>`，白底）

只有 `<router-outlet>`。各頁的內容都落在這裡。

## 互動元素

**整個外框只有 5 個，而且是靜態的 —— 不依賴登入狀態、不依賴資料。**

| 元素（畫面上的字） | 類型 | 出現條件 | 按了之後           |
| ------------------ | ---- | -------- | ------------------ |
| `Clessia`（字標）  | 連結 | 永遠     | 導向 `/login`      |
| 登入               | 連結 | 永遠     | 導向 `/login`      |
| 試聽申請           | 連結 | 永遠     | 導向 `/trial`      |
| 我要報名           | 連結 | 永遠     | 導向 `/enrollment` |
| QR 到班打卡        | 連結 | 永遠     | 導向 `/qr-checkin` |

目前所在的那一條會加上 `public-shell__link--active`
（`/login` 是 `exact: true`，其餘 `exact: false`）。

### ⚠️ 這四條連結是生成的，不是手寫的

`publicRoutes = RoutesCatalog.values.filter((r) => !r.role && r.showInMenu)` ——
**沒有角色 且 `showInMenu`** 的路由。所以：

- `/link-line` 與 `/select-role` 的 `showInMenu` 是 `false`，**不在這排連結裡**
- 往 `RoutesCatalog` 加一條沒有 `role` 的路由，這排會自己多一條

## 狀態

外框沒有狀態 —— 它不取資料、不看登入狀態。**登入著看到的外框跟登出時一模一樣**
（實測：帶著 admin session 開 `/trial`，外框 5 個元素與登出時逐項相同）。

## 驗證紀錄

- **日期**：2026-09-12 ／ **前端版本**：`9f08061a`（主 checkout 的 dev server，port 4200）
- **視窗**：1504 × 695（桌機寬度）

### 兩向比對（以 `/qr-checkin` 量，外框與頁面無關）

`document` 全域可見互動元素 5 個，`<main>` 內 0 個 —— **5 個全部屬於外框**：

| tag | class                                           | 文字        | href          |
| --- | ----------------------------------------------- | ----------- | ------------- |
| a   | `public-shell__logo`                            | Clessia     | `/login`      |
| a   | `public-shell__link`                            | 登入        | `/login`      |
| a   | `public-shell__link`                            | 試聽申請    | `/trial`      |
| a   | `public-shell__link`                            | 我要報名    | `/enrollment` |
| a   | `public-shell__link public-shell__link--active` | QR 到班打卡 | `/qr-checkin` |

| 方向        | 結果                   |
| ----------- | ---------------------- |
| 地圖 ⊆ 畫面 | 5 項全部找到 ✓         |
| 畫面 ⊆ 地圖 | 5 個可見元素全部有列 ✓ |

**差異：0 筆。**

### 未驗到的

| 項目                         | 原因                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| 手機寬度下的外框（上下堆疊） | 本輪只量 1504px 桌機寬度                                           |
| 五條連結實按                 | 目標由 `routerLink` 直接宣告，且四個目標本輪都另外開過網址驗過內容 |
| 流場動畫的實際行為           | 純裝飾，無互動                                                     |
