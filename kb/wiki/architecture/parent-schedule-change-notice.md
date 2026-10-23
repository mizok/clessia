---
title: 課務異動通知發給該班家長
summary: 課務異動存檔時，接在 notifyScheduleChange 後面多寫一批 role=parent 的個人通知（不是公告）；收件人＝那幾堂當天在籍學生的家長，一批一班一位家長一則，v1 不推播；用班級 id 查在籍，因為背景工作裡請求的 pg pool 已經關了。
category: architecture
tags: [architecture, notifications, schedule-changes, parent]
status: active
sources: [https://github.com/mizok/clessia/issues/1100]
updated: 2026-10-23
---

# 課務異動通知發給該班家長（#1100 #49）

使用者 10-23 選「存檔時自動發給該班家長」。計畫席調整方向：**公告的對象是分校＋角色，沒有「某班的家長」**，
所以走個人通知（`notifications`，role=parent、kind=schedule_change），接在 `lib/notify-schedule.ts` 的
`notifyScheduleChange` 後面 —— 18 個路由寫入點都經 `queueScheduleChangeNotice`，不用一支一支接。
老師、管理員那兩批見 [[architecture/admin-schedule-change-notice]]。

## 規則（計畫席 10-23 批准）

- **收件人**：那幾堂**當天在籍**（`isEnrolledOn`，逐堂判，不是整批的日期窗）的學生；作廢的報名不算；
  家長要本 org、`status = 'active'`、有帳號。做異動的人自己不收。
- **一批一班一位家長一則**：去重鍵 `schedule_change:parent:{batch}:{classId}`（跟老師、管理員分開）。
  同一位家長兩個孩子在同班 → 一則，內文列兩個名字。
- **v1 不推播**：寫成 `push_status = 'skipped'`、`push_error = 'KIND_PUSH_DISABLED'`，推播排程不會撿；
  通知中心照樣看得到。推播排程本來只在台北 09–11 點跑，晚上的停課要隔天才推得到 —— 要推另開單。
- `payload.sessionIds`：給「原本／改為」展開用（即時從 `schedule_changes` 算，展開時要用 `childDb`
  確認是自己孩子在籍的班，payload 不當授權依據）。
- 原因只給停課（#46）。

## 為什麼用班級 id 查、不走 pg pool

在籍學生可能上百位（整門課停課），學生 id 進 `.in()` 會 414。pg pool 的 `= ANY($1)` 是平常的解法，
**但這裡在 `waitUntil` 背景跑**：`authPoolCleanup` 在 `await next()` 回來就 `pool.end()`，背景工作拿到的
是已經關掉的池。所以改成用**班級 id**（一批只有幾個班）一句撈在籍＋學生＋家長（巢狀 embed），在 JS 逐堂判。
上限是 PostgREST 的 max_rows 1000（一批超過 1000 筆在籍才會截），程式裡有 `ponytail:` 註記。

## 測試

- `notify-schedule.spec`：髒資料每筆只讓一個條件擋住（退班、還沒來、窗內但那幾堂不在籍、作廢、別 org 家長、
  停用家長、沒帳號、做異動的人、報名列 org 錯），兩個孩子同班一則、重送不重複、查詢失敗老師那批照寫。
- `contract/notify-schedule-parents.contract.ts`：對真 PostgREST 跑一堂，收件人跟 SQL 逐人相同。
