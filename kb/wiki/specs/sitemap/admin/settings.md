---
title: 系統設定（/admin/settings）
summary: /admin/settings 是一個 tab 殼 —— 它自己不畫內容，只提供四個 tab 與 router-outlet，並把裸網址 redirect 到「分校」。
category: spec
status: developing
tags: [sitemap, admin]
created: 2026-09-12
updated: 2026-09-13
---

# 系統設定（tab 殼）

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/admin/settings`
**角色**：管理員（`admin`）
**選單位置**：系統設定 › 系統設定
**額外權限**：無

<!-- generated:route-facts end -->

**權限變體**：任何 admin 角色都進得去（不論 `permissions`），頁內的寫入鈕也不會因為缺權限而消失 —— 按下去由 API 擋。逐權限的量測見 [[specs/sitemap/_shared/permission-matrix]]。

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

### ~~四個 tab 只有「學校」多畫一條麵包屑~~ —— 已修（#728）

修正前：`/admin/settings/schools` 的模板頂端有 `<app-page-breadcrumb [items]="breadcrumbs" />`，
內容是 `系統設定 › 學校管理`，於是同一個殼裡「系統設定」出現兩次，
而切到別的 tab 又不見了。**現在四個 tab 都是純標題。**

### 仍然存在：四個 tab 的標題層級不一致

**殼自己是 `<h1>系統設定</h1>`**，而分校與科目兩個 tab 也用 `<h1>` ——
切到那兩頁時頁面有**兩個 h1**。學校（#728 之後）與一般是 `<h2>`，那是對的那一邊。

字級四者相同，**所以這是語意層級的問題不是視覺問題**，畫面上看不出來。
→ **待計畫席定方向**（#728 把它標成「視覺方向該由計畫席定」而沒有一起改）。
細節見 [[specs/sitemap/admin/settings-schools]]。

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

## 390px

- **量測**：390 × 844 / 768 × 1024 / 1024 × 768 / 1504 × 752 ／ 前端 `3f2197f8`（4200，主 checkout ＝ `origin/main`）／ 身分 `admin@demo.clessia.app`（量測前後各打一次 `GET /api/me`）
- **手段**：同源 iframe 當 viewport；`< 44px` 的「真機」欄是**把 `(pointer: coarse)` 區塊注進去重量一次**得到的，不是推測（方法頁 Phase 2）
- **外框**（頂列、側欄 ↔ 底欄）不屬於這一頁，見 [[specs/sitemap/_shared/shell-layout]]

### 這條路由是分頁殼 + 轉址

實測：390 × 844 下開 `/admin/settings`，`location.pathname` 落在
**`/admin/settings/campuses`**，四個寬度都一樣。

`<main>` 內容是一個**帶四個分頁籤的殼**（`分校 / 學校 / 科目 / 一般`），
底下渲染當前分頁。所以這一頁的窄寬度現況＝**分頁籤 + 當前分頁**，
各分頁自己的現況記在它們自己的地圖裡：

- [[specs/sitemap/admin/settings-campuses]]（預設落點）
- [[specs/sitemap/admin/settings-schools]]
- [[specs/sitemap/admin/settings-subjects]]
- [[specs/sitemap/admin/settings-general]]

### 四個分頁籤在每一個寬度都一樣

`分校 / 學校 / 科目 / 一般` 四顆 `p-tab`，**各 `62 × 53`，四個寬度逐項相同**，
沒有橫向捲、沒有收成下拉。（對照 [[specs/sitemap/admin/courses]] 的分校頁籤：
那裡有 13 顆，390 下只有 4 顆在畫面內。**顆數少的時候不需要捲，這是資料量的差別不是設計的差別。**）

### 未驗與原因

| 項目                   | 原因                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 分頁籤實按切換         | 四個分頁各自用網址直接開過（比點擊多不了資訊，而且省四次往返）。**這是對工單步驟 5 的刻意簡化，理由寫在這裡供推翻。** |
| `Escape` / 真的 Tab 鍵 | 需要前景分頁                                                                                                          |

## 載入中 / 錯誤

- **量測**：390 × 844 ／ 主 checkout 的 dev server（port 4200）`7e9da649` ／
  `admin@demo.clessia.app`（permissions `["*"]`，量測前後各打一次 `/api/me`）
- **手段**：同一個 XHR 包裝 —— 錯誤態改指 `:8799`，載入中把 `send` 延後 3 秒
  （**只影響那一個 iframe，不動 8787**）。方法見[方法頁 Phase 2-D](../README.md)

**這一頁自己不取任何資料。** `SettingsShellPage` 只畫頁標 + 一列 tab + `router-outlet`
（見上面「這一頁自己沒有內容」），`grep` 它的原始碼沒有任何 HTTP service。
四個頁籤各自的載入中與錯誤態在各自的地圖裡。

### 🔴 但是：從 app 內部進不來，會整頁空白

| 進入方式 | 結果 |
| --- | --- |
| **完整載入** `/admin/settings` | ✅ 正常，redirect 到 `/admin/settings/campuses` |
| 側邊選單 `a[href="/admin/settings"]` 的 click | 🔴 網址停在原頁、`<main>` 只剩 76 bytes 空殼 |
| `router.navigateByUrl('/admin/settings')` | 🔴 同上，promise reject |
| SPA 導航直接指 `/admin/settings/campuses` 或 `/general` | 🔴 同上 |
| **已經在 shell 裡再切頁籤** | ✅ 正常 |

console：

```
TypeError: Cannot read properties of undefined (reading 'routeConfig')
    at _SettingsShellPage.currentTab
    at <instance_members_initializer>
    at new _SettingsShellPage
    at _RouterOutlet.activateWith
```

`settings-shell.page.ts:59-61` 的 `this.route.firstChild?.snapshot.routeConfig?.path` ——
`firstChild?.` 與 `routeConfig?.` 都有 optional chaining，**中間的 `snapshot` 沒有**，
而它在 `:45-51` 的 `toSignal(..., { initialValue: this.currentTab() })` 於**元件建構當下**被呼叫。

**負控**：`/admin/grades`（同樣是有 children 的 shell）、`/admin/attendance`、`/admin`
三條 SPA 導航**都正常** —— 所以不是「shell 型路由都這樣」，是這一支讀了還沒備妥的 snapshot。

**已開 issue #804 給計畫席**（P1，不順手修）。

### 未驗與原因

| 項目 | 原因 |
| --- | --- |
| 真滑鼠點側邊選單 | 需要前景分頁（坑 12）。**兩條合成路徑（DOM click 與 Router API）都重現**，而錯誤堆疊落在 app 自己的程式碼裡 |
| 其他寬度 | 390 與 1024 都重現過 |
