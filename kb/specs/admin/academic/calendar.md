# 課堂行事曆（Admin Calendar）

> 取代原本的排課管理（schedule）、課堂搜尋（sessions）、課務異動（changes）三個分頁。

## 概述

統一行事曆介面，管理員可瀏覽課堂並直接處理停課、代課、調課。

## 路由

`/admin/calendar`

## 視圖模式

- **週視圖**（桌機 ≥ 768px）：CSS Grid，Mon–Sun 7 欄 + 時間軸
- **日視圖**（手機 < 768px）：單日，左右箭頭換日

## 課堂狀態與色彩

| 狀態   | Class modifier   | 顏色                           |
|--------|-----------------|--------------------------------|
| 正常   | `--scheduled`   | accent-100 背景，accent-500 左邊框 |
| 停課   | `--cancelled`   | zinc-100 背景，zinc-400 左邊框，刪除線 |
| 有異動 | `--changed`     | warning-100 背景，warning-600 左邊框 |

## API

- `GET /api/sessions` — 查詢課堂列表
- `GET /api/sessions/:id/changes` — 查詢單一課堂異動紀錄
- `POST /api/sessions/:id/cancel` — 停課
- `POST /api/sessions/:id/substitute` — 代課
- `POST /api/sessions/:id/reschedule` — 調課

## 資料庫

新增 `schedule_changes` 表（`20260224000001_create_schedule_changes.sql`）記錄所有課務異動。
