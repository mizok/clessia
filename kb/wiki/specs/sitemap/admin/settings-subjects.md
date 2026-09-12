---
title: 科目設定（/admin/settings/subjects）
summary: 系統設定的「科目」tab：整頁只有一個標題和一個共用的科目管理元件。
category: spec
status: developing
tags: [sitemap, admin]
created: 2026-09-12
updated: 2026-09-13
---

# 科目設定

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/admin/settings/subjects`
**角色**：管理員（`admin`）
**選單位置**：**選單不露出**（只能從別頁導過來或直接打網址）
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：[[specs/sitemap/admin/settings]] 的「科目」tab / 直接網址 / 舊網址 redirect

**外框**見 [[specs/sitemap/_shared/shell-layout]]；**tab 列屬於** [[specs/sitemap/admin/settings]]。

## 畫面區塊

**這一頁只有兩樣東西**：

1. 頁首 `科目管理` + 副標「管理課程科目分類，供課程設定與老師資格篩選使用」
2. 一張卡片，裡面**整個是共用元件** → [[specs/sitemap/_shared/subject-manager]]

`subjects.page.html` 全長 12 行，沒有自己的狀態、資料或動作 ——
**清單、行內改名、刪除限制、新增全部在那支共用元件裡**，不在這裡重寫。

## 互動元素

| 元素     | 說明                                         |
| -------- | -------------------------------------------- |
| （全部） | 見 [[specs/sitemap/_shared/subject-manager]] |

**這一頁自己 0 個互動元素。**

## 狀態

全部由共用元件決定，見那一頁。這條路由沒有 `permission`，無權限不適用。

## 驗證紀錄

- **日期**：2026-09-12 ／ **帳號**：`admin@demo.clessia.app`
- **前端版本**：port 4202（本 worktree），`8c286802` ／ **寬度**：1504 CSS px
- **資料狀態**：8 個科目，全部被引用（8 顆刪除鍵都是 disabled）

### 兩向比對

| 方向        | 結果                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| 地圖 ⊆ 畫面 | 這一頁自己沒有元素；共用元件那一頁列的都找得到                                    |
| 畫面 ⊆ 地圖 | 22 個可見元素 = tab 4（屬殼）+ 8 列 × 2（✏️ 與 disabled 的 🗑）+ 新增輸入 + 新增鍵 |

**差異：0 筆。** DOM 22、可見 22 —— 沒有隱藏元素。

**8 顆 🗑 全部 `disabled: true`** —— 依 #709 的要求記在元素清單裡；
它們不是壞掉，是每個科目都被課程引用（理由常駐顯示在名稱底下）。

### 未驗到的

全部承接 [[specs/sitemap/_shared/subject-manager]] 的「未驗到的」。
這一頁沒有自己的未驗項。

## 390px

- **量測**：390 × 844 / 768 × 1024 / 1024 × 768 / 1504 × 752 ／ 前端 `3f2197f8`（4200，主 checkout ＝ `origin/main`）／ 身分 `admin@demo.clessia.app`（量測前後各打一次 `GET /api/me`）
- **手段**：同源 iframe 當 viewport；`< 44px` 的「真機」欄是**把 `(pointer: coarse)` 區塊注進去重量一次**得到的，不是推測（方法頁 Phase 2）
- **外框**（頂列、側欄 ↔ 底欄）不屬於這一頁，見 [[specs/sitemap/_shared/shell-layout]]

### 版面怎麼變

**沒有變。** 四個寬度掃描全部可見容器的版面訊號，**沒有任何一個容器改變**，
互動元素也完全相同（24 個）。這一頁是一份九列的科目清單 + 一個新增欄位。

### 差集

**零差異。** 四個寬度都是同樣 24 個：分頁籤 ×4、新增輸入框 ×1、
`p-button-sm`（新增）×1、編輯鍵 ×9、刪除鍵 ×9。

### ⚠️ 九顆刪除鍵裡有八顆是 disabled

實測 390：`<main>` 內 18 顆列動作鍵，**8 顆 `disabled`，全部是 `p-button-danger`（刪除）**。

跟 [[specs/sitemap/admin/courses]] 的垃圾桶是同一個慣例 ——
**已被使用的科目不能刪**。方法頁的判準在這裡再次成立：
**清單沒有記 `disabled` 的時候，「按了沒反應」讀起來跟「壞掉」一模一樣。**

（`disabled` 的元素不是 Tab 站，所以 390 下 Tab 站 11 個 < 可見互動元素 24 個。）

### 水平溢出

**無**（四個寬度皆然）。

### 四個分頁籤在每一個寬度都一樣

`分校 / 學校 / 科目 / 一般` 四顆 `p-tab`，**各 `62 × 53`，四個寬度逐項相同**，
沒有橫向捲、沒有收成下拉。（對照 [[specs/sitemap/admin/courses]] 的分校頁籤：
那裡有 13 顆，390 下只有 4 顆在畫面內。**顆數少的時候不需要捲，這是資料量的差別不是設計的差別。**）

### 觸控目標 < 44px（390）

**全部被 coarse 抬起來了**：

| 元素                     | 390 實測   | 真機        |
| ------------------------ | ---------- | ----------- |
| 編輯鍵 ×9                | `32 × 32`  | `44 × 44` ✓ |
| 刪除鍵 ×9                | `32 × 32`  | `44 × 44` ✓ |
| `p-button-sm`（新增）    | `72 × 34`  | `72 × 44` ✓ |
| `subject-manager__input` | `204 × 36` | `204 × 40`  |

只有輸入框抬完仍差 4px。

### 鍵盤可達性

- 全頁**沒有正數 `tabindex`**；390 下 Tab 站 11 / 可見互動元素 24
  （差的 13 個是 8 顆 disabled 刪除鍵 + 下拉觸發區等）
- **`cursor: pointer` 但 Tab 不到的元素：0 個**

### 未驗與原因

| 項目                                 | 原因                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| 那一顆可按的刪除鍵按下去的確認對話框 | **會通往寫入**，零寫入邊界；對話框也不在 `<main>` 裡 |
| 編輯科目的就地編輯狀態               | 需要點進去，這一輪沒做                               |
| `Escape` / 真的 Tab 鍵               | 需要前景分頁                                         |

## 載入中 / 錯誤

- **量測**：390 × 844 ／ 主 checkout 的 dev server（port 4200）`7e9da649` ／
  `admin@demo.clessia.app`（permissions `["*"]`，量測前後各打一次 `/api/me`）
- **手段**：同一個 XHR 包裝 —— 錯誤態改指 `:8799`，載入中把 `send` 延後 3 秒
  （**只影響那一個 iframe，不動 8787**）。方法見[方法頁 Phase 2-D](../README.md)
- ⚠️ **導航方式跟其他頁不同，見下** —— 這四個頁籤**進不去**，只能「完整載入進 shell、再切頁籤」

> 🔴 **怎麼進來，決定你量不量得到這一頁。**
>
> `/admin/settings/*` **用 SPA 導航進不去 —— 會整頁空白**（issue #804）：
> 側邊選單的連結、`router.navigateByUrl()`、直接指子路由，三條路都一樣，
> `SettingsShellPage` 建構時炸在 `Cannot read properties of undefined (reading 'routeConfig')`。
>
> **所以本輪的量法是**：先**完整載入** `/admin/settings/<某個頁籤>`（這條路正常），
> shell 建好之後**在 shell 內切頁籤**（`/admin/settings/schools` ↔ `campuses` …，這條路也正常）。
> 兩段都實測過。
>
> 先前 #760 把這四頁記成「頁籤不是 `<a href>`，SPA 導航進不去，沒有硬鑽」——
> **前半是對的，但真正擋住的是那個 crash**，而 crash 的樣子（畫面空白、網址不動）
> 跟「導航沒有發生」一模一樣。

> 這一頁的內容是共用元件 [[specs/sitemap/_shared/subject-manager]]，
> **所以這一節量到的就是那支元件的狀態。**

### 載入中（3 秒延遲）

| skeleton | spinner | `<main>` 互動元素 | 判定 |
| --- | --- | --- | --- |
| **6**（`div.subject-manager__row--skeleton 284×32`） | 0 | 1 → 21 | ✅ 誠實 |

骨架用的是**科目列自己的形狀**（一列一條），不是全站的 `skeleton-list`。

⚠️ `animation-name: skeleton-wave` —— 看得見，波紋不動（坑 12）。

### 錯誤（所有 API 都失敗）

| 判定 | 重試鈕 | toast | 攔到的請求數 |
| --- | --- | --- | --- |
| 🔴 **謊稱沒資料，而且零訊號** | 否 | **0** | 1 |

主體逐字「**尚無科目，請新增**」，**沒有 toast、沒有任何失敗字樣**。

機制（`subject-manager.component.ts:80-86`）：

```ts
error: () => {
  this.loading.set(false);     // ← 只做這一件事
},
```

**沒有 failed 旗標、沒有 toast**，所以模板從「載入中」直接落到「空」。

> 本機實際有 **9 個科目**（`select count(*) from subjects` = 9），而且畫面正常時每一列
> 都寫著「已被 N 個課程、M 場校內考使用中，無法刪除」——
> **同一頁在失敗時說「尚無科目，請新增」。**
>
> **這是本輪最乾淨的一個實例**：`_shared/audit-log-dialog` 的錯誤分支**一字不差**
> （見 [[specs/sitemap/_shared/subject-manager]] 與 [[specs/sitemap/_shared/audit-log-dialog]]）——
> **同一個寫法在兩支共用元件裡各長了一次**，所以它是 pattern 不是個案。

### 未驗與原因

| 項目 | 原因 |
| --- | --- |
| 重試 | **沒有重試鈕、沒有任何失敗訊號** |
| 其他寬度 | 只量 390 |
