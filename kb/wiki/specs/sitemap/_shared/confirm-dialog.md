---
title: 確認對話框（子頁面，8 頁共用）
summary: ConfirmDialogComponent 的 UI 地圖：訊息 + 取消/確認兩顆鈕，另有一種「必填原因」型態。
category: spec
status: developing
tags: [sitemap, _shared, admin]
created: 2026-09-12
updated: 2026-09-12
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
（`class-detail.page.ts:339`、`:353` 兩處）。

## 互動元素

| 元素                     | 類型         | 出現條件                               | 按了之後                          |
| ------------------------ | ------------ | -------------------------------------- | --------------------------------- |
| 原因 textarea            | 文字區       | **只在 `requireNotes: true`**          | 輸入原因；空白時右鈕維持 disabled |
| 取消（或 `rejectLabel`） | 按鈕         | 永遠                                   | 關閉，回傳 `false`                |
| 確認（或 `acceptLabel`） | 按鈕（主要） | 永遠；**型態 B 在原因空白時 disabled** | 關閉，回傳 `true` 或 `{ notes }`  |

## 驗證紀錄

- **日期**：2026-09-12 ／ 帳號 `admin@demo.clessia.app` ／ 前端 `c1535d04`（port 4201）
- **開啟路徑**：`/admin/courses` → 某個沒有班級的課程 → 垃圾桶

### 兩向比對（型態 A）

對話框內 DOM 互動元素 **2** 個（`取消`、`刪除`），地圖列 2 項。**差異：0 筆。**

**只開啟與取消，沒有刪除任何資料。**

### 未驗到的

| 項目                               | 原因                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| 型態 B（`requireNotes`）的實際畫面 | 它只在班級詳情頁用得到，那一頁尚未繪製 —— **做那一頁時回來補這一段**                    |
| 按下確認之後的結果                 | 會寫入                                                                                  |
| 其餘 7 個開啟點傳的文案            | 只實地開過 courses 那一個；其餘可從呼叫端讀，但**文案是呼叫端給的，不是這支元件的性質** |
