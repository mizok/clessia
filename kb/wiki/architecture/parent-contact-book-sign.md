---
title: 家長讀取與簽收個人聯絡簿
summary: GET /api/me/contact-book 與 POST /api/me/contact-book/{id}/sign 的範圍與「簽收後有修改」判準為什麼要走 pg 一句 SQL、為什麼管理端 PUT 原文照存不寫。
category: architecture
status: active
updated: 2026-10-23
tags: [parent, contact-book, scope]
---

# 家長讀取與簽收個人聯絡簿（#1100 #26）

規則在 [[rules/contact-book-rules]] 第 4 節。這頁記**為什麼這樣接**。

## 端點

- `GET /api/me/contact-book?childId&dateFrom&dateTo`：走 `childDb`（[[architecture/parent-data-scope]]），
  日期窗必填、上限 120 天（課表詳情「之前的聯絡簿」那個窗）。讀取 error 回 500，不吞成空清單。
- `POST /api/me/contact-book/{id}/sign`：走 `childDb.signContactBookEntry(pool, …)`，一句 CTE：
  範圍（同 org、`student_id = any(scope)`）＋只改 `signed_at IS NULL` 的。不是自己孩子的 → 404；
  已簽過 → 200 回現狀（冪等，不覆蓋第一位簽收者）。

## 為什麼簽收要走 pg，不走 `childDb.from().update()`

「簽收後有修改」的判準是 `updated_at > signed_at`。簽收本身也是一次 UPDATE，`updated_at` trigger
會設成 `now()`。PostgREST 沒辦法寫 `now()`，`signed_at` 只能用 Worker 的時間 —— 那 `updated_at`
一定比它晚一點（或因時鐘差早一點），**每一筆剛簽的都會被判成有修改**。

pg 一句 `set signed_at = now()`：`now()` 是交易開始時間，trigger 的 `now()` 是同一個值，兩欄相等。
之後老師一改，`updated_at` 才會大於 `signed_at`。pool 不在就 500，不給 REST 退路（同 #1922）。

SQL 放在 `child-db.ts` 而不是路由：家長端路由拿不到原始 client（A19），範圍條件跟其他家長端寫入
同一個地方守。契約 `contract/contact-book-sign.contract.ts` 對真 DB 驗範圍、不覆蓋、兩欄相等。

## 為什麼管理端 PUT 原文照存不寫

老師習慣性按儲存，upsert 會讓 trigger 跳 `updated_at`，已簽收的那則就變成「簽收後有修改」，
這個標記就沒有意義了。所以 PUT 先讀那一則，內容相同就直接回現狀（連最後編輯者也不換 ——
沒有人真的改了什麼）。

## 其他會動到 `updated_at` 的路徑（盤點 2026-10-23）

| 路徑 | 會不會誤標 |
| --- | --- |
| `PUT /api/contact-book`（唯一的應用層寫入） | 內容沒變已不寫；內容改了 → 正確標記 |
| 家長簽收 | 兩欄相等，不標 |
| `last_edited_by`／`signed_by` 的 `ON DELETE SET NULL`（刪 `ba_user`） | **會**：FK 動作也是 UPDATE，trigger 照跳。刪帳號是罕見的管理動作，接受 |
| 行政代簽、批次操作 | 不存在（全 repo 沒有其他寫入 `contact_book_entries` 的路徑） |
