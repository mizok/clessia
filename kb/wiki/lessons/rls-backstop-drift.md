---
title: 後盾在沒人看的時候悄悄少了一半
summary: 業務表該一律啟用 RLS 當 fail-closed 後盾，但 30 張裡有 16 張沒開——早期的都有、後期新增的都沒有，而沒有任何東西會提醒。
category: lesson
status: active
updated: 2026-08-18
tags: [lessons, rls-backstop-drift]
---

# 後盾在沒人看的時候悄悄少了一半

## 發生什麼

`AGENTS.md` 與憲法 c1 的脈絡都寫明：業務表一律啟用 RLS 且不建任何 policy。
API 用 service role key 會繞過 RLS，所以它不是第二道防線，而是
「**將來若真的接上 anon client，會被全拒而不是全放**」的後盾。

實際查下來，30 張業務表裡**只有 13 張開著**。分界線是年代：早期建的表都有開，
後期新增的（`schools`、`students`、`enrollments`、`academy_exams`、`attendance_records`…）
一張都沒開。

證據（在交易裡把 `students` 的 RLS 關掉再 rollback）：

```
【模擬修正前】anon 讀 students → 27 列
修正後        anon 讀 students →  0 列
service_role  讀 students      → 27 列
```

## 為什麼會漂

沒有人做錯事。建第一批表的人寫了 `ENABLE ROW LEVEL SECURITY`，後來加表的人照著
**旁邊最近的一支 migration** 抄，而那支剛好是沒寫的。錯誤一旦進入樣板就會自我複製。

**關鍵在於：這個漂移沒有任何症狀。** 系統照常運作，測試全綠，因為 service role 本來就
繞過 RLS。要發現它只能主動去查 `pg_class.relrowsecurity`，而沒有人有理由去查。

這跟現況表只掃 admin 是同一個形狀：**沉默的缺陷不會來找你**。

## 現在守它的東西

harness gate **A8**：靜態掃 `supabase/migrations/`，每個 `CREATE TABLE`（排除 `ba_*`）
都必須在某支 migration 裡有對應的 `ENABLE ROW LEVEL SECURITY`。

**靜態掃 migration 而不是查資料庫**，因為 gate 要在 CI 上跑，那裡沒有 DB。

兩個實作上的坑：

- **建了又刪的表要排除** —— `school_exam_schedules` 建於 20260421、刪於 20260422，
  第一版 gate 把它報成漏網之魚
- **靜態掃看不到後續的 `DISABLE`** —— 目前沒有任何 migration 這樣做，但這是這支 gate
  的已知盲區。真的出現 DISABLE 時，它會說謊

## 帶得走的

- **寫在文件裡的不變量，如果沒有機制守，就只是當初那個人的意圖。** 它會隨著新人照抄
  旁邊的樣板而稀釋，而且不會有任何症狀提醒你。
- **突變測試要先確認「真的變了」。** 這次第一版突變測試顯示 gate 沒抓到，我差點以為
  gate 壞了 —— 實際上是 `replace()` 的空白數量沒對上，檔案根本沒被改到。
  **綠燈可能來自「測試沒跑到」而不是「東西是對的」**，改動後先驗證改動本身生效。
