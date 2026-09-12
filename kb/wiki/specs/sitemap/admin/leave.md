---
title: 學生請假管理（/admin/leave）
summary: /admin/leave 的實際 UI 地圖：兩個篩選、請假表格、每列一顆取消鈕，三支對話框（含兩套不同的對話框系統）。
category: spec
status: developing
tags: [sitemap, admin]
created: 2026-09-12
updated: 2026-09-12
---

# 學生請假管理

<!-- generated:route-facts start —— 這一段由 tools/sitemap 生成，不要手改 -->

**路由**：`/admin/leave`
**角色**：管理員（`admin`）
**選單位置**：學務管理 › 學生請假管理
**額外權限**：無

<!-- generated:route-facts end -->

**進入方式**：選單「學務管理 › 學生請假管理」／直接網址。

**外框**見 [[specs/sitemap/_shared/shell-layout]]。

## 畫面區塊

### 1. 頁首

`學生請假管理`（h2，取自 `page().label`）。右側 `操作紀錄` 與 `新增請假`。

**這一頁用 h2 不是 h1，也沒有橘帶／錨點** —— 跟同群組的 students／parents 版面不同。

### 2. 篩選列

| 控制項   | 預設       |
| -------- | ---------- |
| 分校下拉 | `全部分校` |
| 日期範圍 | 空（`日期範圍` 佔位字，附一顆 `Choose Date` 日曆鈕） |
| `重置篩選` | —        |

### 3. 請假表格

表頭：`學生姓名`｜`開始日期`｜`結束日期`｜`天數`｜`原因`｜`申請方`｜`操作`

- 開始／結束日期底下**條件式**附時間（`record.startTime` / `record.endTime`）
- `操作`格：每列一顆圖示鈕 → 取消請假確認
- **列本身不可點**

### 4. 分頁 / 空狀態

實測 12 筆單頁。載入中是骨架列。

## 互動元素

| 元素         | 類型   | 出現條件 | 按了之後                                          |
| ------------ | ------ | -------- | ------------------------------------------------- |
| `操作紀錄`   | 按鈕   | 永遠     | 開 [[specs/sitemap/_shared/audit-log-dialog]]（`resourceTypes: ['leave']`） |
| `新增請假`   | 按鈕   | 永遠     | 開「新增請假」對話框                              |
| 分校下拉     | 下拉   | 永遠     | 重查                                              |
| 日期範圍     | 日期   | 永遠     | 重查                                              |
| `重置篩選`   | 按鈕   | 永遠     | `onFilterChange()`                                |
| 每列的圖示鈕 | 圖示鈕 | 每一列   | 開取消請假確認（**三種文案，依請假狀態而異**）    |

## 子頁面

### 新增請假（`LeaveFormDialogComponent`）

| 欄位             | 佔位字             |
| ---------------- | ------------------ |
| `分校`           | `全部分校`         |
| `年級`           | `全部年級`         |
| `學生 *`         | `輸入姓名模糊搜尋` |
| `開始日期時間 *` | `開始日期` / `開始時間` |
| `結束日期時間 *` | `結束日期` / `結束時間` |
| `原因（選填）`   | `請假原因`         |

底部 `取消` ／ `送出請假`。**`送出請假` 剛開啟時是 `disabled`。**

> 這一頁跟 [[specs/sitemap/admin/students]] 的表單是同一種寫法（有驗證閘），
> 跟 [[specs/sitemap/admin/parents]] 的家長表單相反 —— 見那一頁的對照表與 PR #664。

### 取消請假確認（**不是 DynamicDialog**）

走 `confirmationService.confirm({...})`，**依 `leaveState(record)` 分三種**：

| 狀態 | 方法 | 實測到的 |
| --- | --- | --- |
| `future` | `confirmFutureDelete` | ✅「取消請假申請 / 確定要取消 X 的請假申請（YYYY-MM-DD ~ YYYY-MM-DD）？」+ `返回` / `確認取消` |
| `active` | `confirmActiveDelete` | **未驗** |
| `past` | `confirmPastDelete` | **未驗** |

### 操作紀錄

[[specs/sitemap/_shared/audit-log-dialog]]。欄位：`操作者`｜`時間`｜`對象`｜`動作`。
關閉是 header 右上的 icon-only `×`（`.dialog-header-inline__close`）。

## 這一頁同時出現兩套對話框系統

| 系統 | 怎麼開 | header 的 `×` |
| --- | --- | --- |
| **DynamicDialog** | `dialogService.open(...)`（操作紀錄、新增請假） | **只在開啟設定帶 `closable: true` 時才有**；這兩支都沒帶，所以靠元件自己畫的 icon-only `×` |
| **ConfirmDialog** | `confirmationService.confirm(...)`（取消請假） | **一律有**（`p-dialog-close-button`） |

> **`closable` 沒帶不等於用預設值。** `DynamicDialogComponent` 一律把
> `[closable]="ddconfig.closable"` 綁給內層 `p-dialog`，**沒帶就是 `undefined`，
> 蓋掉 `p-dialog` 自己的預設 `true`** —— 那正是 issue #714／#717 的根因。
>
> ⚠️ 我原本在這裡寫的是「DynamicDialog **從不**渲染 `×`」，**那是錯的**：
> 我拿來當正控的那支也沒帶 `closable`，兩個同類互相比較當然一樣。
> 帶了 `closable: true` 的（`SessionAdvancedFiltersDialog`）**× 就有渲染**。

## 驗證紀錄

- **狀態**：已驗
- **前端版本**：`650d257a`，自架 `:4210`
- **取樣器**：方法頁版本 + `[tabindex]:not([tabindex="-1"])`
- **兩向比對**：可見 **19** = 2（操作紀錄／新增請假）+ 2（分校下拉的兩種表示）
  + 2（日期輸入 + 日曆鈕）+ 1（重置篩選）+ 12（每列一顆取消鈕）。**0 差異。**
- **未驗，附原因**：
  - `active` / `past` 兩種請假狀態的確認文案 —— 展示資料取樣到的是 `future`
  - 空狀態、分頁 —— 12 筆單頁
  - 送出／確認取消 —— **會寫入**
- **一個被自己的濾網製造出來的假缺陷**：列「操作紀錄」的按鈕時我用 `.filter(Boolean)`
  濾掉空字串，**而它的關閉鈕是 icon-only、`innerText` 是空的** ——
  於是那支對話框看起來也關不掉。**列按鈕時不要用文字過濾。**
