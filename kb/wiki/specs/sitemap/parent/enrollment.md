---
title: 報名申請（/parent/enrollment）
summary: /parent/enrollment 的實際 UI 地圖：目前是 EmptyState 佔位頁，<main> 內零互動元素。
category: spec
status: developing
tags: [sitemap, parent]
created: 2026-09-12
updated: 2026-09-12
---

# 報名申請

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/parent/enrollment`
**角色**：家長（`parent`）
**選單位置**：行政服務 › 報名申請
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：選單「行政服務 › 報名申請」／ 直接網址

**外框**見 [[specs/sitemap/_shared/shell-layout]]（家長的選單是 2 個不分組項目 + 3 個群組，
右上角色徽章是「家長」）。

> ## ⚠️ 這一頁是佔位頁
>
> 整支元件只有一個 `<app-empty-state>`，**沒有注入任何 service、沒有打任何 API**：
>
> ```ts
> template: `
>   <app-empty-state
>     icon="pi pi-file-edit"
>     [title]="page().label"
>     description="這個功能還在準備中，完成後就會出現在這裡。"
>   />
> `,
> ```
>
> **家長端有六頁長得一模一樣**（見下方「同形的六頁」），差別只有圖示與標題。
>
> 這裡記的是**現在的樣子**，不是應該有什麼。

## 畫面區塊

置中的空狀態，三個部分由上而下：

1. 圖示 `pi pi-file-edit`
2. 標題 **報名申請** —— 來自 `page().label`，也就是 `RoutesCatalog` 的路由標籤
3. 說明 `這個功能還在準備中，完成後就會出現在這裡。`

`EmptyStateComponent` 還有一個 `<ng-content>` 的動作區（`.empty-state__action`），
**這一頁沒有投影任何東西進去**，所以它是空的 —— 這就是互動元素為 0 的原因。

**沒有資料來源。** 這一頁不打任何 API。

## 互動元素

**沒有。** `<main>` 內可見互動元素 0 個（實測）。

| 元素（畫面上的字） | 類型 | 出現條件 | 按了之後 |
| ------------------ | ---- | -------- | -------- |
| （無）             | —    | —        | —        |

> **注意這一頁連孩子切換器都沒有。** 家長端有內容的四頁（儀表板、到班紀錄、成績查閱、
> 繳費紀錄）頂上都有一條橘色 `app-page-band` 帶著
> [[specs/sitemap/_shared/parent-child-switcher|孩子切換器]]，**這六頁沒有** ——
> 它們連「現在在看哪個孩子」都不顯示。

## 狀態

| 狀態               | 畫面                                            |
| ------------------ | ----------------------------------------------- |
| 唯一狀態           | 上面那三行。**沒有其他狀態。**                  |
| 空 / 載入中 / 錯誤 | 不適用 —— 不取資料、沒有非同步                  |
| 無權限             | 這條路由沒有 `permission`；`roleGuard` 擋非家長 |

## 驗證紀錄

- **日期**：2026-09-12 ／ **前端版本**：`9f08061a`（主 checkout 的 dev server，port 4200）
  - `origin/main` 當時已前進到 `2684a1e0`（#691 搜尋管線），但 `git show --stat` 確認
    **它沒有動到 `features/parent` 或 `features/public` 任何檔案**
- **視窗**：1504 × 695
- **角色帳號**：`parent01@demo.clessia.app`（家長 林志明，3 個孩子）

### 兩向比對

|                          | 數量  |
| ------------------------ | ----- |
| `<main>` 內 DOM 互動元素 | 0     |
| 其中不可見               | 0     |
| **可見**                 | **0** |

`<main>` 的全部文字：`報名申請 這個功能還在準備中，完成後就會出現在這裡。`
空狀態圖示的實際 class：`pi pi-file-edit`

| 方向        | 結果                       |
| ----------- | -------------------------- |
| 地圖 ⊆ 畫面 | 地圖沒有列任何元素，恆真 ✓ |
| 畫面 ⊆ 地圖 | 畫面上 0 個可見互動元素 ✓  |

**差異：0 筆。**

### ⚠️ 空狀態的圖示不是從路由來的

圖示 `pi pi-file-edit` 寫死在元件的 `template` 字串裡，**不是** `page().icon`。
這條路由在 `RoutesCatalog` 的圖示是 `pi-user-plus` —— **兩者不同**，
所以**選單上看到的圖示跟進去之後看到的不是同一個**。六頁裡有四頁這樣（見下表）。

## 同形的六頁

這六頁的元件**逐字同構**（只有 `icon` 與投影進去的 `page()` 不同）：

| 路由                 | 標題     | 空狀態圖示（寫死在元件裡） | `RoutesCatalog` 的選單圖示 |
| -------------------- | -------- | -------------------------- | -------------------------- |
| `/parent/schedule`   | 課表查看 | `pi pi-calendar`           | `pi-calendar-plus` ❗      |
| `/parent/trial`      | 試聽申請 | `pi pi-star`               | `pi-headphones` ❗         |
| `/parent/enrollment` | 報名申請 | `pi pi-file-edit`          | `pi-user-plus` ❗          |
| `/parent/add-course` | 加選課程 | `pi pi-plus-circle`        | `pi-plus-circle`           |
| `/parent/renewal`    | 續課資訊 | `pi pi-refresh`            | `pi-refresh`               |
| `/parent/meals`      | 餐費紀錄 | `pi pi-shopping-bag`       | `pi-dollar` ❗             |

**六頁全部實測過，每一頁 `<main>` 內可見互動元素都是 0。**

### 未驗到的

| 項目     | 原因                     |
| -------- | ------------------------ |
| 手機寬度 | 本輪只量 1504px 桌機寬度 |
