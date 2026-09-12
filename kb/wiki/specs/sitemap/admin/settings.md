---
title: 系統設定（/admin/settings）
summary: /admin/settings 是一個 tab 殼 —— 它自己不畫內容，只提供四個 tab 與 router-outlet，並把裸網址 redirect 到「分校」。
category: spec
status: developing
tags: [sitemap, admin]
created: 2026-09-12
updated: 2026-09-12
---

# 系統設定（tab 殼）

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/admin/settings`
**角色**：管理員（`admin`）
**選單位置**：系統設定 › 系統設定
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：選單「系統設定」/ 直接網址 / 四個舊網址的 redirect（見下）

**外框**見 [[specs/sitemap/_shared/shell-layout]]。

## 這一頁自己沒有內容

`SettingsShellPage` 只畫**一個頁標 + 一列 tab + `router-outlet`**。四個 tab 是四條獨立路由、
各自 lazy load，內容各有自己的地圖：

| tab  | 路由                       | 地圖                                      |
| ---- | -------------------------- | ----------------------------------------- |
| 分校 | `/admin/settings/campuses` | [[specs/sitemap/admin/settings-campuses]] |
| 學校 | `/admin/settings/schools`  | [[specs/sitemap/admin/settings-schools]]  |
| 科目 | `/admin/settings/subjects` | [[specs/sitemap/admin/settings-subjects]] |
| 一般 | `/admin/settings/general`  | [[specs/sitemap/admin/settings-general]]  |

**`/admin/settings` 本身是 `redirectTo` 到 `campuses`** —— 打裸網址會停在
`/admin/settings/campuses`（實測）。所以「這一頁」在畫面上永遠等於「分校那一頁 + tab 列」。

> **四個子路由 `showInMenu: false`** —— 側欄只留「系統設定」一項，但它們仍是有效路由
> （tab 切換、直接打網址、書籤都到得了）。舊網址 `/admin/campuses` 等在 `app.routes.ts`
> 有 redirect（註解：別人存的書籤與外部連結不該 404，成本三行）。

> **當前 tab 讀的是 URL 不是本地 signal** —— 重整、分享連結、瀏覽器上一頁都停得住。
> 元件註解說明理由：這四頁是「設定完就把網址貼給同事」的那一種。

## 互動元素（殼自己的）

| 元素（畫面上的字）        | 類型 | 出現條件 | 按了之後                                             |
| ------------------------- | ---- | -------- | ---------------------------------------------------- |
| 分校 / 學校 / 科目 / 一般 | tab  | 永遠     | 導向 `/admin/settings/<tab>`，`router-outlet` 換內容 |

**四個 tab 是這一頁全部的互動元素。** 其餘一律屬於當前 tab 的那一頁 ——
**清點子頁面的元素時要記得扣掉這四個**（四頁的兩向比對都是這樣算的）。

## 狀態

殼沒有載入中／錯誤／空狀態 —— 它不取數。無權限也不適用（這條路由沒有 `permission`）。

## 已知的落差（記錄現況，不在這裡修）

**四個 tab 只有「學校」多畫一條麵包屑。** `/admin/settings/schools` 的模板頂端有
`<app-page-breadcrumb [items]="breadcrumbs" />`，內容是 `系統設定 › 學校管理`；
另外三頁（`grep -rln page-breadcrumb` 在 campuses / subjects / settings 底下 **0 筆**）沒有。

於是同一個殼裡：切到「學校」時畫面上會同時有殼的 h1「系統設定」與麵包屑的「系統設定」，
切到別的 tab 又不見了。→ **已開 issue #728**（未順手修），細節見 [[specs/sitemap/admin/settings-schools]]。

## 驗證紀錄

- **日期**：2026-09-12 ／ **帳號**：`admin@demo.clessia.app`
- **前端版本**：自己 worktree 的 dev server **port 4202**，`8c286802`（= 當時的 `origin/main`）
- **視窗寬度**：1504 CSS px
- **實測**：
  - 打 `/admin/settings` → 網址列停在 `/admin/settings/campuses`，畫面是分校那一頁 ✓
  - 四個 tab 都切過，網址與內容同步變化 ✓
  - **tab 切換是用合成 `element.click()` 驗的**，不是真滑鼠 —— 見下

### ⚠️ 這一輪真滑鼠整片失效，tab 的證據等級要打折

照[[specs/sitemap/README|方法頁]]坑 6 掛了 capture 監聽器：**真滑鼠點 tab 連三次，
`__hits` 全空**（一個 click 事件都沒進到頁面），而同一時間 `javascript_tool` 與截圖都正常。
換一個新分頁重試也一樣，連 `Escape` 都收不到（`__keys` 空）。

所以 tab 的驗證用的是 `element.click()`：**它證明了 `(valueChange)` 繫結會導航**，
但**沒有**證明真實指標事件下的行為（hover、focus、鍵盤操作 tab 列）。
這幾項標為未驗，不是「驗過」。

### 未驗到的

| 項目                                      | 原因                                 |
| ----------------------------------------- | ------------------------------------ |
| 真實指標／鍵盤操作 tab 列                 | 本輪真滑鼠與真鍵盤事件都送不進頁面   |
| 舊網址（`/admin/campuses` 等）的 redirect | 沒有逐一打過，只讀了 `app.routes.ts` |
| 手機寬度下 tab 列的樣子                   | 只量 1504px                          |
