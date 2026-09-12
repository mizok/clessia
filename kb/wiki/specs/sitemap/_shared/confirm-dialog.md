---
title: 確認對話框（子頁面，8 頁共用）
summary: ConfirmDialogComponent 的 UI 地圖：訊息 + 取消/確認兩顆鈕，另有一種「必填原因」型態。
category: spec
status: developing
tags: [sitemap, _shared, admin]
created: 2026-09-12
updated: 2026-09-13
---

# 確認對話框（子頁面）

**元件**：`@shared/components/confirm-dialog/confirm-dialog.component`

**開啟點（8 頁）** —— `grep -rl ConfirmDialogComponent apps/web/src/app`（排除元件自己與 `.spec`）：

`admin/campuses`、`admin/courses`、`admin/courses/:courseId/classes/:classId`、
`admin/fee-templates`、`admin/grades/exams`、`admin/parents`、`admin/staff`、`admin/students`

> 新增開啟點時回來補這張表。

## 它不是固定內容 —— 呼叫端把每個字都傳進來

`ConfirmDialogData`（`confirm-dialog.component.ts:7-14`）：

| 欄位               | 預設                 | 作用              |
| ------------------ | -------------------- | ----------------- |
| `message`          | 必填                 | 對話框正文        |
| `acceptLabel`      | `確認`               | 右邊那顆鈕的字    |
| `rejectLabel`      | `取消`               | 左邊那顆鈕的字    |
| `acceptSeverity`   | `danger`             | 右邊那顆鈕的顏色  |
| `requireNotes`     | `false`              | 見下面「型態 B」  |
| `notesPlaceholder` | `請填寫原因（必填）` | 只在型態 B 有意義 |

**標題不在這張表裡** —— 它是開啟時的 dialog header，由呼叫端另外給（例如 courses 給「確認刪除」）。

## 型態 A：純確認（預設）

```
<標題>
<message>
[ 取消 ]  [ 確認 ]
```

**實測到的一個實例**（`/admin/courses` 刪除課程）：

- 標題 `確認刪除`
- 正文 `確定要刪除課程「物理 段考高分實戰班」嗎？此操作無法復原。`
- 按鈕 `取消`、`刪除`（`acceptLabel: '刪除'`、`acceptSeverity: 'danger'`）

## 型態 B：必填原因（`requireNotes: true`）

正文底下多一個 textarea（3 行），**而右邊那顆鈕在原因是空白時 disabled**
（`canAccept` 要求 `notes.trim().length > 0`）。

送出時 `close()` 回傳的東西也不一樣：型態 A 回 `true`，型態 B 回 `{ notes }`。

**目前唯一的使用者是 `admin/courses/:courseId/classes/:classId`**
（`class-detail.page.ts:339` 停權、`:353` 退班）。

**已實測**（停權那一支，見 [[specs/sitemap/admin/courses-courseId-classes-classId]]）：

| 原因欄           | 確認鈕                                      |
| ---------------- | ------------------------------------------- |
| 空白             | **disabled**                                |
| 有內容           | **啟用**                                    |
| **只有空白字元** | **disabled** —— `canAccept` 用的是 `trim()` |

第三列是關鍵：前兩列只證明「有沒有字」，**一對「空 / 非空」涵蓋不到中間那個情況**。

## 互動元素

| 元素                     | 類型         | 出現條件                               | 按了之後                          |
| ------------------------ | ------------ | -------------------------------------- | --------------------------------- |
| 原因 textarea            | 文字區       | **只在 `requireNotes: true`**          | 輸入原因；空白時右鈕維持 disabled |
| 取消（或 `rejectLabel`） | 按鈕         | 永遠                                   | 關閉，回傳 `false`                |
| 確認（或 `acceptLabel`） | 按鈕（主要） | 永遠；**型態 B 在原因空白時 disabled** | 關閉，回傳 `true` 或 `{ notes }`  |

## 驗證紀錄

- **日期**：2026-09-12 ／ 帳號 `admin@demo.clessia.app` ／ 前端 `c1535d04`（port 4201）
- **開啟路徑（型態 A）**：`/admin/courses` → 某個沒有班級的課程 → 垃圾桶
- **開啟路徑（型態 B）**：`/admin/courses/:courseId/classes/:classId` → 學生 ⋮ ›「停權」

### 兩向比對（型態 A）

對話框內 DOM 互動元素 **2** 個（`取消`、`刪除`），地圖列 2 項。**差異：0 筆。**

### 兩向比對（型態 B）

對話框內 DOM 互動元素 **3** 個（原因 textarea、`取消`、`停權`），地圖列 3 項。**差異：0 筆。**

**兩種型態都只開啟與取消，沒有刪除或停權任何東西。**

### 未驗到的

| 項目                                      | 原因                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| 型態 B 的第二個實例（班級詳情的「退班」） | 未觸發；型態 B 本身已由「停權」驗過                                                     |
| 按下確認之後的結果                        | 會寫入                                                                                  |
| 其餘 7 個開啟點傳的文案                   | 只實地開過 courses 那一個；其餘可從呼叫端讀，但**文案是呼叫端給的，不是這支元件的性質** |

## 390px


> ⚠️ **2026-09-13 訂正：上面的對話框尺寸是在 ResizeObserver 失效的環境下量的。**
> `--shell-layout-body-height` 靠 `InheritSizeDirective` 的 ResizeObserver 寫入，
> 而**它在 MCP 的背景分頁 iframe 裡不觸發** —— 於是 `styles.scss:721-722` 的
> `max-height: calc(var(--shell-layout-body-height) - …)` 的 `calc()` 無效，
> **computed 值是 `none`，對話框不受限**。
>
> **真實瀏覽器裡對話框會被限制在 `shell body 高 − 24px`（本輪環境是 `700px`），
> 超出的部分由 `.p-dialog-content` 捲動。** 上面的高度數字要照這個重新讀：
> **矮於 700 的那些是真的，高於 700 的只會出現在這個量測環境裡。**
> 全文與正控見[方法頁](../README.md)的「ResizeObserver 在這個環境完全不觸發」。
- **量測**：390 × 844 與 1504 × 752（對話框只記「版面怎麼變」，不重抄元素表）
- **前端**：主 checkout 的 dev server（port 4200），`543e5eda`
- **手段**：同源 iframe 當 viewport；**開啟一律用 `element.click()`（合成事件，坑 6 的等級標記）**，
  關閉後用輪詢斷言消失（坑 9），疊層時比對**數量**不是 `=== null`

### 版面怎麼變：390 滿寬、垂直置中（不貼底）

| | 390 × 844 | 1504 × 752 |
| --- | --- | --- |
| `.p-dialog` | `390 × 212 @0,316` | `420 × 199 @542,277` |
| 佔寬比 | `1.00` | `0.28` |
| **header** | **有**（`確認刪除`） | 有 |
| 按鈕 | `取消` / `刪除` 各 `58 × 41` | **同尺寸** |

**這是本輪唯一有 header 的一支**（`showHeader: true`，`courses.page.ts:408`）——
但 **header 裡沒有 `×`**（`.p-dialog-close-button` 查無此元素），符合 #714 確立的規則。

**兩個寬度的按鈕尺寸完全相同**（`58 × 41`）——它不隨容器縮放。

### 差集（1504 ↔ 390）

**零差異**（兩顆按鈕，尺寸相同）。

### 水平溢出

**無**（內容區 `scrollWidth === clientWidth`）。

### 觸控目標 < 44px

| 元素 | 量到 | coarse |
| --- | --- | --- |
| `取消` / `刪除` | `58 × 41` | **無** |

**差 3px**，兩個寬度都一樣。**而這一支的兩顆按鈕之一是破壞性動作**，記現況。

### 關閉方式

**只有「取消」**（header 無 `×`）。實測按「取消」→ **1781ms** 後消失、殘留遮罩 0、
**課程還在**（零寫入確認）。

### 開啟點與資料狀態

本輪從 `/admin/courses` 的垃圾桶開（Phase 1 驗過的那一條）。
那一頁 **20 顆垃圾桶、13 顆可按**（有班級的課程 `disabled`）——跟 Phase 1 記的一致。

### 未驗與原因

| 項目 | 原因 |
| --- | --- |
| **按「刪除」** | **寫入類動作，一律不按** |
| 其餘 7 個開啟點的文案 | **文案是呼叫端給的，不是這支元件的性質**（Phase 1 已記） |
| `Escape` / 點遮罩 | 需要真鍵盤／真滑鼠（坑 12） |
| 768 / 1024 | 本輪沒補量 |

> **本輪四支對話框的共同形狀**：390 下**滿寬**（佔寬比 1.00）、**沒有一支是全螢幕**、
> 內容區**都沒有橫向溢出**、**都沒有 header 的 `×`**（`showHeader: false`，#714 確立的規則）。
> 差別在**高度**，而那是 #784 的成因。
