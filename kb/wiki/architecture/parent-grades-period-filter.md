---
title: 家長成績的學期篩選＝機構的「期」（billing_periods）
summary: GET /api/me/grades 的 meta 多回機構的期清單（billing_periods，經 childDb.orgRef 白名單讀），前端用考試日期落在期的 start_date～end_date 判歸屬，取代「近1月／3月／半年」按鈕。預設＝含今天的期（重疊取起始日最晚的），沒有期涵蓋今天就預設全部；沒有任何期涵蓋的考試歸「未分期」。段考的 academic_year／semester 只顯示不當篩選鍵。不加欄位、不動 schema。
category: architecture
status: developing
updated: 2026-10-03
tags: [architecture, parent, grades, billing-periods]
---

# 家長成績的學期篩選（#1076）

> 定案來源：#1076 留言「改定案（10-03 13:4x，使用者裁）」—— 全系統只有一條時間軸＝機構自建的
> 「期」（設定頁「學期與繳費週期」）。這頁只記**怎麼接**。

## 決策

1. **期清單隨成績列表一起回**：`GET /api/me/grades` 的 `meta.periods: { id, name, startDate, endDate }[]`
   （照 `start_date` 新到舊）。成績頁本來就是一次撈完再前端篩（`PAGE_SIZE = 100`），
   多一支端點只多一次往返。
2. **讀期走 `childDb.orgRef('billing_periods')`**：把它加進白名單。期是機構的行事曆、不是孩子的資料，
   跟 `classes` / `courses` 同一類 —— 只帶 `org_id`、只讀。
3. **歸屬在前端判**：`period.startDate <= examDate <= period.endDate`（日期字串比較）。
   期允許重疊（migration `20260829093241` 刻意不擋），所以一筆考試可以同時屬於兩個期，
   選哪個期都看得到它 —— 這是對的，不去挑「主要的那個」。
4. **選項**＝「全部」＋各期＋「未分期」（只在真的有未分期的考試時出現）。
5. **預設**＝含今天的那個期；重疊時取 `startDate` 最晚的；沒有期涵蓋今天 → 預設「全部」。
   換孩子不重設（期是機構的，換孩子還是同一組期）。
6. **段考的 `academic_year` / `semester` 不當篩選鍵**，academy 與 school 用同一把尺（`exam_date`）。

## 拒絕的替代方案

- **API 端用 `periodId` 篩**：成績頁是全量前端篩，伺服器端篩會讓「未分期」與「全部」各要一個特殊值，
  也讓每次切換都多一次請求。量變大要分頁時再搬到伺服器端（屆時 school 的日期也要一起篩 ——
  現在的 `dateFrom` / `dateTo` 只套在 academy 上，那是另一件事，這支不碰）。
- **另開 `GET /api/me/billing-periods`**：沒有第二個消費者，YAGNI。
- **法條純函式推學期 / 分校層級學期**：使用者已撤回，見 #1076。

## 影響

- `apps/api/src/lib/child-db.ts`（`orgRef` 白名單加一張表）
- `apps/api/src/routes/parent/grades.ts`（`meta.periods`）
- `apps/web/src/app/core/parent-grades.service.ts`、`features/parent/pages/grades/*`
  （`TIME_RANGE_OPTIONS` / `filterByTimeRange` 換成期篩選）
- `kb/wiki/specs/parent/grades.md` 的「學期篩選」⚠️ 改成已實作

不做：新期的 8/1、2/1 預填（設定頁的小改動，另開）。
