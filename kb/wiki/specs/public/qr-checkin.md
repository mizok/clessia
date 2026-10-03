---
title: QR 到班打卡
summary: 學生掃碼完成當日到班登記。#1127 起搬到登入後：門口機台用 kiosk 帳號開 /kiosk/checkin，行政開 /admin/checkin；/qr-checkin 轉登入。
category: spec
status: active
updated: 2026-10-03
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

- QR Code 掃描器（**未做**：學生 QR 卡＋相機掃描器另開一單；目前是卡號欄位，掃碼器的鍵盤輸入也打進這裡）
- 顯示打卡成功/失敗訊息（✅）
- 顯示學生姓名確認（✅，POST 回應的 `student.name`）
- 顯示今日課堂列表（打卡成功後）（✅，`todaySessions`）

## 資料依賴

| 操作 | 資料表                                 |
| ---- | -------------------------------------- |
| 讀取 | `students`, `sessions`, `enrollments`  |
| 寫入 | `daily_checkins`, `attendance_records` |

## PRD 參考

- 4.7 日到班
- 6.4 日常到班流程

## 實作註記

- 需處理相機權限請求
- 需處理離線情境（顯示錯誤訊息）
- 同一分校一天最多打卡一次
- 打卡後系統自動推算當天各課堂的出席狀態
