---
title: QR 到班打卡
summary: 學生掃碼完成當日到班登記。#1127 起搬到登入後：門口機台用 kiosk 帳號開 /kiosk/checkin，行政開 /admin/checkin；/qr-checkin 轉登入。
category: spec
status: active
updated: 2026-10-28
tags: [specs, public, qr-checkin]
---

# QR 到班打卡

**路徑**: `/kiosk/checkin`（門口機台，`kiosk` 角色，不走 ShellLayout）、`/admin/checkin`（行政，`basic_operations`）
**角色**: 需要登入（#1127 使用者裁定：不做免登入端點）。舊的 `/qr-checkin` 轉 `/login`，公開外框不再有連結。

> 兩頁共用 `shared/components/checkin-station`。機台帳號怎麼建、能做什麼見
> [[architecture/kiosk-checkin]]。

## 核心目的

學生掃碼完成當日到班登記。

## MVP 功能

- QR Code 掃描器（✅ #1127：相機、掃碼槍、手打卡號三種輸入走同一條）
- 到班卡（✅ #1100 #42）：卡上是可作廢的代碼 `CK1-XXXX-XXXX-XXXX-XXXX`（QR＋可手打的分組文字）。
  `CK1-` 開頭送 `cardCode`；舊卡（QR＝學生 id）過渡期仍收，但該生一印過新卡就不收（`LEGACY_CARD`）。
  作廢的卡 `CARD_REVOKED`。兩種都提示學生找櫃台，不給「再掃一次」。補發／作廢在學生詳情頁的「⋯」
  （`manage_students`），細節見 [[architecture/kiosk-checkin]]
- 顯示打卡成功/失敗訊息（✅）
- 顯示學生姓名確認（✅，POST 回應的 `student.name`）
- 顯示今日課堂列表（打卡成功後）（✅，`todaySessions`）

## 資料依賴

| 操作 | 資料表                                                 |
| ---- | ------------------------------------------------------ |
| 讀取 | `students`, `sessions`, `enrollments`, `checkin_cards` |
| 寫入 | `daily_checkins`, `attendance_records`                 |

## PRD 參考

- 4.7 日到班
- 6.4 日常到班流程

## 實作註記

- 需處理相機權限請求
- 需處理離線情境（顯示錯誤訊息）
- 同一分校一天最多打卡一次
- 打卡後系統自動推算當天各課堂的出席狀態
