---
title: 管理端儀表板 v1 的設計
summary: 把四張死卡片接上真資料並補行政待辦卡：零後端改動（六種資料既有 API 全有）、未點名卡回溯 7 天且只在逐堂點名模式顯示、報名卡只取 meta.total 以免分頁截斷、經營區用 permission 蓋住、卡片是索引不是工作場。
category: architecture
status: active
updated: 2026-08-29
tags: [architecture, dashboard, admin]
---

# 管理端儀表板 v1 的設計

> 2026-08-29 設計。現況：`admin/dashboard` 的四張卡片值全是寫死的 `'—'`，
> 從未接過資料；老師端儀表板（真實作）是本設計的直接先例。

## 設計原則

1. **儀表板是索引，不是工作場。** 每張卡回答一個問題、可點、跳到功能的家
   （帶好篩選），動作在那裡做 —— 延續 [[architecture/teacher-students-view]] 的
   「一個功能一個家」。
2. **按「打開 app 時心裡的問題」分區**：行政問「今天要處理什麼」，老闆問
   「生意好不好」。同一頁，經營區用 `view_reports` permission 蓋住 ——
   不另做老闆儀表板（角色架構就是 admin + permissions）。

## 卡片與資料來源（v1，零後端改動）

| 卡片           | 問題               | 資料                                                                       | 點擊跳轉               |
| -------------- | ------------------ | -------------------------------------------------------------------------- | ---------------------- |
| 今日課堂       | 今天有哪些課       | `GET /api/attendance/sessions?date=今天`（含代課老師名、時間）             | `/admin/sessions`      |
| 未點名課堂     | 哪些課沒有點名證據 | 同上 API，`dateFrom=7天前`，前端篩 `!takenAt && 已結束`                    | `/admin/attendance`    |
| 今日請假       | 今天誰請假         | `GET /api/leaves?coverDate=今天`                                           | `/admin/leave`         |
| 成績待登錄     | 哪些考試沒登完     | 兩支既有的 `todo-count`（校內考+段考）相加                                 | `/admin/grades/exams`  |
| 在籍學生       | 現在有多少學生     | `GET /api/students` 的 `summary.activeCount`                               | `/admin/students`      |
| 本月報名異動   | 這個月動了幾筆報名 | `GET /api/enrollments` 既有的 `from`/`to` filter，取 `meta.total`（`pageSize=1`） | `/admin/enrollments`   |

前端用 `forkJoin` 併發取數（老師端儀表板的既有先例），部分失敗不擋整頁 ——
每張卡自己顯示載入失敗。

## 關鍵決策

### 1. 零後端：組合既有 API，不做 aggregate endpoint

六種資料的 API 全部存在。新開 `/api/dashboard/summary` 要把六個查詢塞進同一個
request —— 在 Cloudflare Workers 的 per-request CPU 上限下反而集中風險，
而且多一支要測要授權宣告的路由。六個併發請求各自便宜。
**拒絕的替代方案**：aggregate endpoint。等真的量測到儀表板載入太慢再說。

### 2. 未點名卡回溯 7 天，且只在 `per_session` 模式顯示

- **7 天**：昨天忘點的今天要追得到（點名證據影響出勤，之後堂數制還影響錢）；
  超過 7 天的漏點名是報表該查的異常，不是儀表板的日常。
- **模式判斷**：`daily-checkins.ts` 建立 attendance_records 但**從不蓋
  `events.attendance_taken_at`** —— 日到班模式下每堂推算出席的課都會被誤判成
  「未點名」。所以這張卡只在 org `attendance_mode = 'per_session'` 時渲染
  （設定從既有 org-settings API 取）。`daily_checkin` 模式的對應警示
  （「今天還沒打卡的學生」）留給之後，不硬塞進 v1。
- **讀不到設定時同樣不渲染**（fail-closed）：org-settings 那支查詢失敗就無從判斷這個數字
  有沒有意義，寧可少一張卡，也不要顯示一個可能整欄都是誤報的數。

### 3. 經營區 v1 只做兩張（在籍、本月進出）

營收/欠繳/分校比較的資料要等 P1 金流 schema —— 版面留插槽，不做假卡片。
寫死的 `'—'` 佔位卡就是這次要清掉的東西，不再製造新的。

### 4. 報名卡顯示「異動筆數」，不顯示進出人次

實作時才發現的落差：`GET /api/enrollments` 有期間 filter，但**不回傳任何進/出分項聚合**，
回應只有明細加 `meta.total`；「進 N 退 M」是進出總覽頁自己用
`enrollment-event.util.ts` 的 `toEnrollmentEvent` 在前端分類算的，而 `pageSize` 上限 100。

抓單頁明細自己分類，會在異動破百的月份（開學月、續報月）**悄悄少算，而且錯得沒有徵兆**
—— 儀表板會很有自信地顯示一個偏小的數。所以只取 `meta.total`，卡片講「本月報名異動 N 筆」。

**單位是「筆」不是「人次」**：`meta.total` 數的是「期間內有異動的報名記錄數」，
一筆當月插班又當月退班的報名在這裡是 1，在總覽頁的事件分類裡是 `joined` + `left` 兩筆。
卡片數字和點進去的分項加總對不上是語意差異，不是 bug；卡片 sub 文字引導使用者過去看分項。

**拒絕的替代方案**：前端翻頁抓完再分類 —— 一個月破百筆就要打好幾個請求，違反決策 1 的
「六個併發請求各自便宜」。後端加聚合欄位 —— 破壞零後端前提；它屬於 P2 的營收報表切片，
那時 enrollments 聚合會跟營收聚合一起設計，比現在塞一個孤兒欄位好。

## 明確不做（v1）

- **分校 filter** —— 等 `CampusFilterService` 切片（多分校 UI 決策）一起來，
  這裡先全機構視角
- 出勤率趨勢圖、訂餐狀態卡（P1 後）、營收卡（P1 後）
- 自訂卡片排序／隱藏

## 影響的既有元件

- `admin/pages/dashboard/`（重寫 component 的取數邏輯，模板結構大致沿用）
- `@core/attendance.service`、`leave.service`、`students.service`、
  `enrollments.service`、`academy-exams/school-exams service`（只是呼叫，不改）
- 不動任何 API、不動 schema
