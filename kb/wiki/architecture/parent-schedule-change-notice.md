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

## 展開「原本／改為」（第二張）

- `GET /api/notifications/{id}/schedule-change`：只讀自己的、家長身分、kind schedule_change 的那則（不是自己的、
  不是家長身分 → 404）。哪幾堂從 `payload.sessionIds` 來，**但再用 `childDb` 確認每一堂是自己孩子那天
  （原本那天或現在那天）在籍的班**，作廢報名不算 —— payload 不當授權依據。
- 即時算：「改為」＝那堂**現在**的日期、時間、上課老師（停課＝null）；「原本」＝最新一筆異動記下的原值
  （沒記就退回現在的值）。原因只給停課。
- 端點放在 `routes/notifications.ts` 而不是 `routes/parent/**`：讀的是通知表（不是學生範圍的表），
  家長端路由拿不到原始 client（A19）。範圍那一段照樣走 `childDb`。
- 收件匣：inbox 回 `hasChangeDetail`（payload 有 sessionIds）；有的那則點了**展開**（不直接導頁），
  畫 A6 `.nt__chg` 的「原本／改為」＋「看課表」；讀過就不重讀，讀失敗再展開會重試。

## 為什麼用班級 id 查、不走 pg pool

在籍學生可能上百位（整門課停課），學生 id 進 `.in()` 會 414。pg pool 的 `= ANY($1)` 是平常的解法，
**但這裡在 `waitUntil` 背景跑**：`authPoolCleanup` 在 `await next()` 回來就 `pool.end()`，背景工作拿到的
是已經關掉的池。所以改成用**班級 id**（一批只有幾個班）一句撈在籍＋學生＋家長（巢狀 embed），在 JS 逐堂判。
超過 PostgREST 的 max_rows 1000 筆在籍時用 `fetchAllPages` 翻到底（計畫席 10-23 二讀要求），不靜默截掉後面的家長。

## 測試

- `notify-schedule.spec`：髒資料每筆只讓一個條件擋住（退班、還沒來、窗內但那幾堂不在籍、作廢、別 org 家長、
  停用家長、沒帳號、做異動的人、報名列 org 錯），兩個孩子同班一則、重送不重複、查詢失敗老師那批照寫。
- `contract/notify-schedule-parents.contract.ts`：對真 PostgREST 跑一堂，收件人跟 SQL 逐人相同。
