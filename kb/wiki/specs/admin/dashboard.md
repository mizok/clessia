---
title: 管理員儀表板
summary: 管理員首頁，六張卡各回答一個問題並跳到功能的家；經營區用 view_reports 蓋住。
category: spec
status: active
updated: 2026-08-29
tags: [specs, admin, dashboard]
---

# 管理員儀表板

**路徑**: `/admin/dashboard`
**角色**: Admin

## 核心目的

管理員首頁，快速掌握今日概況與待辦事項。**儀表板是索引不是工作場** —— 每張卡回答一個問題、
可點，動作到功能的家去做。設計理由與拒絕過的替代方案見
[[architecture/admin-dashboard-v1]]。

## v1 已交付

行政區（所有 admin 可見）：今日課堂、未點名課堂、今日請假、成績待登錄。
經營區（需 `view_reports` permission）：在籍學生、本月報名異動。
另有今日課表與今日請假兩份明細清單，資料與對應卡片同一支查詢，不另外請求。

兩個行為上的例外：

- **未點名課堂只在 `attendance_mode = 'per_session'` 時渲染**。日到班模式下
  `daily-checkins` 從不蓋 `events.attendance_taken_at`，整張卡會全部誤報。
  讀不到機構設定時同樣不渲染。
- **本月報名異動的單位是「筆」不是人次**。數字來自 `GET /api/enrollments` 的
  `meta.total`（期間內有異動的報名記錄數），一筆當月插班又退班的報名在這裡是 1，
  在進出總覽頁的事件分類裡是 joined + left 兩筆 —— 兩邊對不上是語意差異，不是 bug。

每支查詢各自吞掉錯誤，一張卡讀取失敗只讓那張卡顯示失敗態，不擋整頁。

## 尚未做

分校 filter（等 `CampusFilterService`）、出勤率與人數趨勢圖、訂餐與營收卡（等 P1 金流 schema）、
自訂卡片排序。**不放假佔位卡** —— v1 清掉的就是那些寫死的 `'—'`。

## 資料依賴

零後端改動，全部組合既有 API：`attendance/sessions`、`leaves`、`academy-exams` 與
`school-exams` 的 `todo-count`、`students`、`enrollments`、`org/settings`。

## PRD 參考

- 7.4 管理員常用頁面
