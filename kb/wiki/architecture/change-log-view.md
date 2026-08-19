---
title: 課務異動紀錄的設計
summary: M1 第二個畫面。填掉 admin/changes 空殼，把一直在寫卻沒人看得到的 schedule_changes 呈現出來。唯讀。
category: architecture
status: active
updated: 2026-08-12
tags: [architecture, change-log-view]
---

# 課務異動紀錄的設計

## 要解決什麼

`schedule_changes` 從 2026-02 起就一直在寫（12 處寫入點），記錄調課、代課、停課、
取消停課、改時間。**但 `admin/changes` 是空殼，沒有任何畫面看得到這些紀錄。**

資料一直在累積，沒有人看得到 —— 這是 M1「讓上課紀錄看得見」的另一半。

## 資料現況（已驗證）

`schedule_changes` 欄位齊全，不需要新 schema：

| 欄位 | 用途 |
| --- | --- |
| `change_type` | `reschedule` / `substitute` / `cancellation` / `uncancel` / `time_change` |
| `original_session_date` / `original_start_time` / `original_end_time` | 調課前的原值 |
| `new_session_date` / `new_start_time` / `new_end_time` | 調課後的新值 |
| `original_teacher_id` / `original_teacher_name` | 代課前的原任老師（姓名是快照） |
| `substitute_teacher_id` | 代課老師 |
| `operation_source` | `single` 或 `batch` |
| `reason` / `created_by_name` / `created_at` | 為什麼、誰做的、什麼時候 |

`original_teacher_name` 是**快照**而非關聯 —— 老師改名或離職後，歷史紀錄仍看得到當時的名字。
這是刻意的設計，不要「修正」成 join。

## 設計決策

### 排序用 `created_at` 由新到舊

這是 log 檢視，關心的是「最近發生了什麼」。

**與授課紀錄相反**：那個畫面用課堂日期排序，因為它問的是「這個月上了哪些課」。
同一份資料在不同問題下有不同的自然順序，不要為了一致而統一。

### 預設當月

跟授課紀錄用同一個月份選擇器，兩個畫面的心智模型一致。

不用「最近 30 天」：那會讓使用者不確定邊界在哪，也無法回答「七月的異動有哪些」。

### 篩選：期間、異動類型、分校

類型篩選讓人能只看代課或只看停課 —— 這兩種的用途完全不同（一個看人力調度，一個看課程損失）。

### 批次操作要標記

一次批次停課會產生多筆 `schedule_changes`。不標 `operation_source = batch` 的話，
畫面上會看起來像有人重複操作了 20 次。

### 唯讀

不從這個畫面編輯或撤銷異動。要改課去課堂管理 —— 讓異動紀錄同時是修改入口，
會讓「紀錄」本身變成可竄改的東西。

## 需要的改動

| 層 | 改動 |
| --- | --- |
| DB | **無** |
| API | 新增 `GET /api/sessions/changes`（跨課堂列表）。既有的 `/{id}/changes` 只查單一課堂 |
| Web service | 新增 `listChanges()` |
| Web UI | 填掉 `admin/changes` 空殼 |

## 刻意不做

- 從這裡編輯或撤銷異動
- 匯出
- 「誰最常調課」之類的統計 —— 那是報表（M6）的範疇
