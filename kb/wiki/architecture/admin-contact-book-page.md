---
title: 聯絡簿管理端頁的設計
summary: 管理端的聯絡簿是監看不是撰寫：日期區間列表＋未簽收篩選（API 無分頁且 count 是 exact，所以前端篩是誠實的），編輯已存在的一則走同一支 upsert，但不做「挑學生開新的一則」——那是老師端 P3 的工作流。「今天哪些該寫還沒寫」這輪不做，現有 API 做出來會漏班且是 N+1。
category: architecture
status: active
updated: 2026-08-29
tags: [architecture, admin, contact-book]
---

# 聯絡簿管理端頁的設計

> 2026-08-29 設計。現況：管理端**完全沒有這一頁** —— `routes-catalog.ts` 對
> 「聯絡簿」零命中，`features/admin/pages/` 底下沒有目錄。後端已就緒
> （`apps/api/src/routes/contact-book.ts`，掛載於 `/api/contact-book`，角色
> `['admin', 'teacher']`），班級的 `usesContactBook` 開關也已暴露（#55）。
>
> 規則真相：[[rules/contact-book-rules]]。**這一頁沒有 spec**（roadmap 現況表：規格 0），
> rules 就是需求真相。
>
> ⚠️ **這是開新頁，charter 坑 #1 全額適用** —— catalog 條目、`app.routes.ts` 的
> `loadComponent`、`app.routes.spec.ts` 的斷言三個地方都要動，缺一個就會是
> 「頁面寫好、測試全綠、點進去卻是 redirect」。

## 先釐清：這一頁不是老師寫聯絡簿的地方

[[rules/contact-book-rules]] 規則 3 說撰寫者是帶班老師，老師端入口是 P3。
規則 4 給管理端的任務只有一句：**「管理端能看『哪些還沒簽』」**。

所以這一頁的定位是**監看**：誰寫了、寫了什麼、家長簽了沒。不是行政每天打開來寫字的地方。

## 已驗的 API 形狀（`routes/contact-book.ts` 全文，非推測）

| 端點                    | 形狀                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/contact-book` | query 只吃 `studentId` / `from` / `to`。回 `{ data: Entry[], meta: { total } }`                                          |
| `PUT /api/contact-book` | `{ studentId, entryDate, content }` → upsert（`onConflict: student_id,entry_date`），回**裸的 Entry**（不是 `{ data }`） |

`Entry` 帶 `studentName`、`lastEditedByName`、`signedBy`、`signedAt`、`isSigned`。

**三件跟繳費頁相反、值得記住的事**：

1. **`GET` 沒有分頁**，一次回符合日期區間的全部。
2. **`meta.total` 是 `count: 'exact'`，這個數字是對的** —— 不像 `/api/invoices` 那支。
3. 因為 1，**前端做狀態篩選是誠實的**：全部資料都在手上，篩「未簽收」不會像繳費頁那樣
   只篩到當頁。同一個動作在兩支 API 上一個會騙人一個不會，差別只在有沒有分頁 ——
   **判斷「前端能不能篩」看的是資料完不完整，不是「前端篩」這個做法本身**。

## 三個範圍決定

### 1. 未簽收篩選 —— 做（規則 4 的正面回應）

`isSigned` 在每一筆上，資料又是完整的，所以一個 toggle 就成立。這是 rules 唯一
明確指派給管理端的任務，也是這頁存在的理由。

### 2. 「今天哪些該寫、還沒寫」 —— 這輪不做

這是行政真正想問的下一個問題，但用現有 API 做出來會是錯的：

- `GET /api/classes` **沒有 `usesContactBook` 篩選參數**，要撈全部班級再前端挑。
  班級列表是分頁的 —— 這正是 charter 坑 #4，會**悄悄漏掉**沒撈到那頁的班級。
- 拿到班級之後要 `GET /api/enrollments?classId=` 逐班取學生：**N 個請求**。
- 再跟 entries 做差集。

一個會漏班的「今天還沒寫」清單，比沒有這個清單更糟 —— 行政會信它。
**要做得對得先有後端支援**：`GET /api/contact-book/missing?date=`，或至少
`GET /api/classes?usesContactBook=true`。已回報計畫席。

### 3. 撰寫 —— 只做「編輯已存在的一則」，不做「挑學生開新的」

`PUT` 是 upsert，兩件事走同一支端點，差別只在 UI 給不給學生選擇器。

- **編輯已存在的**：列表點一則 → 改內容 → PUT。行政修正錯字、補充內容是真實需求，
  而且 entry 已經帶著 `studentId` 與 `entryDate`，不需要任何額外的選擇器。
  規則 3 說共編就是覆寫同一列並換掉 `last_edited_by` —— 後端已經這樣做了。
- **開新的一則**：需要學生選擇器 + 日期選擇器，而那是老師端每天的工作流（P3）。
  管理端複製一份不會有人用，卻要維護。

## 頁面結構

```
contact-book.page          日期區間 + 學生 autocomplete + 未簽收 toggle + 列表
  └ entry-edit-dialog      改內容（PUT upsert），顯示最後編輯者與簽收狀態
```

單頁 + 一個 dialog，沒有詳情層 —— entry 只有一段自由文字，攤在列表的展開列裡就看完了。

**日期區間預設最近 7 天**：API 沒有分頁，不給預設區間等於每次進頁都全撈歷史。
7 天跟儀表板的回溯窗一致（`dashboard.util.ts`），也對得上「聯絡簿是每天的事」。

## 路由與權限

| 項目       | 值                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 路徑       | `/admin/contact-book`                                                                              |
| catalog    | 新增 `ADMIN_CONTACT_BOOK`，group `ADMIN_STUDENT_AFFAIRS`（學務管理，與學生／家長／報名／請假同組） |
| permission | **不加**                                                                                           |

**為什麼不加 permission**：`index.ts:264` 的 mount 是
`mount('/api/contact-book', contactBookRoute, ['admin', 'teacher'])` ——
**只有角色，沒有 permission**。`core/staff.service.ts` 的 `Permission` union 裡
也沒有任何一個是為聯絡簿設的（最接近的 `manage_students` 管的是學生資料本身）。

在前端掛一個後端不檢查的 `permissionGuard`，得到的是「選單藏起來但直接打網址就進得去」，
而且沒有人會發現不一致。charter 的先例說「填了 permission 就要兩邊都動」——
這裡的兩邊指的是選單與路由守衛，但前提是**後端真的守著那個 permission**。
不守就不要在前端假裝。

## 純函式 + spec

`contact-book.util.ts`：

- `dateRangeOf(days, today)` —— 預設區間的起訖。跨月與月初往回退是唯一的邊界
- `signedSummary(entries)` —— 總數 / 已簽 / 未簽，用來顯示「12 則中 5 則未簽」

**不做的**：`isSigned` 後端已經算好了，前端再算一次就是兩個版本的真相。

## 明確不做

| 項目                          | 理由                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| 「該寫還沒寫」清單            | 現有 API 做出來會漏班且 N+1（決定 2）                       |
| 挑學生開新的一則              | 那是老師端 P3 的工作流（決定 3）                            |
| 班級維度的檢視                | entry 只有 student × date，**沒有 classId** —— 資料上做不到 |
| 家長簽收動作                  | P4 家長端；這頁只讀簽收狀態                                 |
| `permissionGuard`             | 後端沒有對應的 permission（見上）                           |
| 班級的 `usesContactBook` 開關 | 那是班級編輯頁的事，不搬過來                                |

## 影響的既有元件

**新增** `core/contact-book.service.ts`、`features/admin/pages/contact-book/**`。
**修改** `core/smart-enums/routes-catalog.ts`（一條）、`app.routes.ts`（一條 `loadComponent`）
—— 這兩個是坑 #1 的兩半，`app.routes.spec.ts` 會自動把新的 `showInMenu` 項目納入斷言。

復用 `shared/components/` 的 `student-autocomplete`、`responsive-table`、`empty-state`。
