---
title: 老師儀表板
summary: 老師首頁：今日課堂與待處理事項。待處理提醒的聯絡簿那半可用 /api/contact-book/missing，成績那半等老師端成績 API。
category: spec
status: active
updated: 2026-08-30
tags: [specs, teacher, dashboard]
---

# 老師儀表板

**路徑**: `/teacher/dashboard`
**角色**: Teacher

## 核心目的

老師首頁，快速掌握今日課程與待處理事項。

## MVP 功能

- 今日課堂列表
- 待處理提醒（未填聯絡簿、未登錄成績）
- 近期課務異動通知
- 快速入口（課表、點名）

> **現況（2026-08-30）**：已實作的只有本週／今日課堂與學生數三塊。待處理提醒尚未實作。

### 待處理提醒的定義

- **未填聯絡簿** —— 直接用 `GET /api/contact-book/missing?date=`（已實作）。
  那支已經處理好三件事：只算 `uses_contact_book = true` 的班、只算**當天有課**的班
  （停課不算）、**每生一列不是每班一列**（一則聯絡簿屬於學生那一天，不屬於某一班）。
- **未登錄成績** —— 需要老師端的成績 API（見 [[specs/teacher/assessments]]），
  在那之前這一半做不出來。

## 資料依賴

| 操作 | 資料表                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 讀取 | `sessions`, `contact_book_entries`, `class_logs`, `academy_scores`, `school_scores`, `academy_exams`, `school_exams`, `schedule_changes` |

> **~~`teacher_logs`~~ 這張表從來不存在**（2026-08-30 訂正）。教務日誌實際是
> `class_logs`（`20260829100000`），命名時就刻意避開既有 teaching-log 的撞名；
> 個人聯絡簿是另一張 `contact_book_entries`。原版把兩個不同的東西寫成一個不存在的表。

## PRD 參考

- 7.3 老師頁面
