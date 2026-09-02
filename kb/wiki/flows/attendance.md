---
title: 到班與出勤流程
summary: 日到班（Check-in）如何轉成課堂出勤，以及補登與補請假。狀態只有 present/absent/on_leave，補登範圍由伺服器強制的補登窗決定。
category: flow
status: active
updated: 2026-09-02
tags: [flows, attendance]
---

# 到班與出勤流程

本文件整理 PRD 6.4-6.5，並補充 4.16 的模式定義，說明「日到班（Check-in）」如何轉成課堂出勤（Attendance），以及管理員如何補登與補請假。

## 1. 流程範圍與角色

- 主要角色：學生、系統、管理員、老師。
- 關聯功能：`/check-in`、課堂詳情（管理員/老師）、`/admin/attendance`、`/admin/leave`。

## 2. 兩種出勤模式（分校層級）

### 2.1 日到班模式（預設）

- 觸發：學生當日掃碼到班。
- 系統動作（`routes/daily-checkins.ts`）：
  1. 建立 Check-in 紀錄。
  2. 找出**當日該分校的所有 events**。
  3. 對每一筆 upsert 一則 `attendance_records`，狀態一律 `present`，
     `recorded_by_role = 'system'`。

> **沒有寬限期，也沒有遲到判定。** 原版寫「在寬限期內到班 `present`、超過寬限期 `late`」——
> `late` 這個狀態**從來不存在**（`attendance_status` 只有
> `present` / `absent` / `on_leave`），而程式碼裡也沒有任何時間比較：掃到碼就是 `present`。

### 2.2 課堂模式

- 觸發：學生掃碼到班。
- 系統只記錄 Check-in 時間，不直接決定每堂課最終出勤。
- 後續由管理員或任課老師逐堂確認出勤狀態。

## 3. 日常到班主流程（PRD 6.4）

1. 學生掃碼到班。
2. 系統建立日到班紀錄。
3. 系統依分校出勤模式執行自動推算或僅保留到班事件。
4. 產生可追溯的課堂出勤結果。

## 4. 出勤管理流程（PRD 6.5）

### 情境 A：補登或修正出勤

- 執行者：管理員、老師（限自己任課的課堂）。
- **可補登的範圍是「補登窗」，不是「僅限當天」** —— 由
  `organizations.attendance_retroactive_days` 決定，`0` 代表**無限制**。
  由伺服器強制（`lib/attendance-window.ts`），不是前端規則。
- 流程：
  1. 進入課堂詳情。
  2. 選擇學生。
  3. 修改狀態：**`present` / `absent` 兩種**（見下方「老師改不了請假」）。

### 情境 B：補請假

- 執行者：管理員。
- 流程：
  1. 進入請假管理建立請假紀錄。
  2. 系統把該日期區間內、該學生有報名的 `attendance_records` 改成 `on_leave`
     （`routes/leaves.ts`）。
  3. 刪除請假紀錄時，區間內的 `on_leave` 會被改回 `absent`。

> **老師改不了請假。** 點名面板對 `on_leave` 的學生只顯示「請假中」，沒有任何切換按鈕；
> `PATCH /api/attendance/batch` 的 enum 也只收 `present` / `absent`。
> 所以「請假的學生臨時出現」目前**在系統裡無法記錄**，只能請管理員刪掉請假單 ——
> 而那是一個跟「他今天有來」語意不同的動作。2026-09-02 UX 審查列為阻斷級缺口，
> 待銷假的業務規則確認後連 API 一起做。

## 5. 狀態集合

`attendance_status` enum 只有三個值：**`present` / `absent` / `on_leave`**。

~~`late`~~（遲到）與 ~~`leave`~~ 從來不存在。原版這份文件寫著四段式狀態機，
而 [[specs/teacher/attendance]] 記載那個錯誤**已經擴散過一次**（P1 A2 的工單照抄成
「扣堂 = attendance present/late」，實作時才被查出來）。這份就是還沒改到的源頭，
2026-09-02 除鏽。

## 6. 待確認（讀碼發現，與原版描述不符）

原版第 5 節寫了兩條保護規則，但程式碼裡找不到對應實作：

1. **「若該課堂已有人工修改，系統推算不得覆蓋」—— 目前不成立。**
   `daily-checkins.ts` 的 upsert 是 `ignoreDuplicates: false`，
   所以後來的掃碼會**覆蓋**先前的人工修改，把狀態寫回 `present`。
2. **「課堂結束後仍無出勤紀錄，系統自動標記為 `absent`」—— 沒有這個機制。**
   repo 裡沒有任何排程或批次在做這件事。沒點名的課堂就是沒有紀錄。

另外，2.1 的「找出學生**有報名**的課堂」在程式碼裡也不成立：
events 只用 org / 日期 / 分校篩選，**沒有比對報名**，所以掃碼會替該分校當天
每一堂課都寫一筆 `present`，包含學生沒報名的課。

這三點是行為問題不是文件問題，已回報計畫席轉 billing-api 席判斷。
**在有結論之前，不要照原版那三句話寫程式。**
