---
title: 繳費紀錄頁的設計
summary: 把 /admin/payments 空殼接上 /api/invoices：狀態由後端推導直接呈現、篩選只做 API 真的支援的兩項（欠繳與單一學生）而不在前端偽造狀態篩選、meta.total 在非 overdue 路徑不可信所以分頁改用「當頁滿即有下一頁」、詳情走 dialog、收款/退費/催繳/手動開帳共用同一個 dialog、列印用 @media print 切區塊。
category: architecture
status: active
updated: 2026-08-29
tags: [architecture, admin, finance, payments, invoices]
---

# 繳費紀錄頁的設計

> 2026-08-29 設計。現況：`admin/pages/payments/payments.page.ts` 是 17 行的空殼
> （`Payments management coming soon...`），但路由與權限**已經接好**
> （`app.routes.ts:231` 掛 `PaymentsPage` + `permissionGuard('manage_finance')`，
> `routes-catalog.ts:273` 的 `ADMIN_PAYMENTS` 已帶 `manage_finance`）。
> 所以這一輪不碰路由，坑 #1（選單與路由表之間的縫）在這頁不適用 —— 它適用的是下一張聯絡簿頁。
>
> 需求真相：[[specs/admin/finance/payments]]、[[rules/billing-rules]]。衝突時 rules 贏。

## 這份文件要解決的問題

工單與 spec 描述的是**需求**，`apps/api/src/routes/invoices.ts` 是**已經存在的事實**。
兩者之間有五處落差，每一處都可以用「前端自己補一個」矇混過去，而每一種矇混都會產生
**看起來能用、實際會騙人**的畫面。這份文件把落差攤開，並對每一處選一個誠實的做法。

## 已驗的 API 形狀（`routes/invoices.ts`，非推測）

| 端點                                       | 形狀                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/invoices`                        | query 只吃 `studentId`(uuid) / `overdue`('true') / `page` / `pageSize`(上限 200)。回 `{ data: Invoice[], meta: { total, page, pageSize } }` |
| `GET /api/invoices/{id}`                   | `{ data: Invoice }`，含 items 與 payments                                                                                                   |
| `POST /api/invoices`                       | `{ studentId, issuedAt?, dueDate?, note?, items? }` → 201 `{ data: Invoice }`                                                               |
| `POST /api/invoices/{id}/items`            | `{ type, enrollmentId?, amount(int), billingPeriodId?, periodMonth?, note? }`                                                               |
| `DELETE /api/invoices/{id}/items/{itemId}` | 回整張帳單                                                                                                                                  |
| `POST /api/invoices/{id}/payments`         | `{ kind?('payment'\|'refund'), amount(正整數), method('cash'\|'transfer'), paidAt?, proofPath?, note? }`                                    |
| `POST \| GET /api/invoices/{id}/reminders` | `{ method('line'\|'phone'\|'other'), note? }` / 列表含 `createdBy`、`createdAt`                                                             |

`Invoice` 帶 `status`（`'unpaid' \| 'partial' \| 'paid'`）、`total`、`netPaid`、`studentName`，
**全是後端推導好的**（`apps/api/src/lib/invoice-status.ts`）。掛載於
`index.ts:270`，`ADMIN_ONLY` + `manage_finance`。

## 五處落差與決定

### 1. 狀態篩選：不做，而不是在前端偽造

spec 的列表篩選列了「狀態（未繳/部分繳/繳清）」，**API 沒有這個 query 參數**，而且不可能有得
太便宜：`status` 是從 items 與 payments 推導出來的，DB 濾不掉（這正是後端 `overdue=true`
要「全撈回來再篩」的原因）。

前端若自己篩，篩的是**當頁那 20 筆**，使用者看到「未繳：3 筆」而真相是 47 筆。
這是 charter 坑 #4 的形狀 —— 悄悄少算而且錯得沒有徵兆。

**決定**：這一輪不提供狀態篩選下拉。狀態以每列的 Tag 呈現（未繳/部分繳/繳清 + 逾期標記），
**欠繳清單走 API 真的支援的 `overdue=true`**，那正好是行政最需要的那一份工作清單。
需要完整狀態篩選 → 回報計畫席，由 billing-api 席在 `GET /api/invoices` 加 `status` 參數
（後端已經在 overdue 路徑做過「撈回來再篩」，加一個 status 是同一條路徑的延伸）。

### 2. `meta.total` 在非 overdue 路徑回的是當頁筆數，不是總數

`routes/invoices.ts` 的列表 handler：`.range()` 已經切過頁之後才 `const total = rows.length`。
overdue 路徑因為沒套 range、是全撈後自己 slice，所以那條的 `total` 是對的；
**一般路徑的 `total` 恆等於當頁筆數**（最後一頁以外都會等於 `pageSize`）。

spec 寫「總筆數取後端 `meta.total`」是對的原則，但這支端點目前給不出來。

**決定**：這一輪的分頁**不顯示總筆數與總頁數**，改用「當頁滿 `pageSize` 就允許下一頁」。
少一個數字，好過顯示一個錯的數字。已回報計畫席轉 billing-api 席修（前端不改 API，charter 邊界）。
後端修好之後，這裡換成 total 是一個小追加。

### 3. 學生搜尋：用既有的 `student-autocomplete` 換成 `studentId`

API 只吃 `studentId`(uuid)，不吃姓名關鍵字。`shared/components/student-autocomplete` 已經
存在（`students.service` 的 `search` + `searchScope: 'student_name'`），選定後帶 uuid 打
`GET /api/invoices?studentId=`。這是**加法**，不必動 API，也不必新做元件。

日期區間與分校篩選 API 都沒有 → 同 1，不做，回報。

### 4. 轉帳憑證：留欄位不接 Storage

工單明示「先留欄位不做上傳 —— Storage 接線是獨立議題」。API 吃的是 `proofPath: string`
（一個路徑字串），不是檔案。

**決定**：付款方式選「轉帳」時顯示**備註**欄位（放帳號後五碼，spec 的用途）與一行說明
「憑證上傳尚未開放」。**不做一個沒有後端的上傳按鈕** —— 假的上傳 UI 比沒有更糟，
行政會以為傳上去了。

### 5. 退費的「原因與經手人」

spec 要求退費必填原因與經手人。API 的 `payment_records` 只有 `note`，`recorded_by`
由後端填當前 `userId`。

**決定**：`kind: 'refund'` 時 `note` **前端必填**（原因），經手人由後端自動記。
不為了「必填」去改 schema。

## 頁面結構

一頁 + 一組 dialog，不新增路由：

```
payments.page                     列表：搜尋(學生 autocomplete) / 欠繳 toggle / 開帳按鈕 / 分頁
  └ invoice-detail-dialog         詳情：明細 items、收款記錄、催繳記錄
       ├ payment-form-dialog      記收款 / 記退費（同一個表單，kind 決定）
       └ reminder-form-dialog     記一次催繳
  └ invoice-form-dialog           手動開帳：挑學生 + 日期 + 多筆 items
```

**詳情為什麼是 dialog 不是獨立路由**：`routes-catalog` 沒有帳單詳情這條，加一條就要同時動
catalog、`app.routes.ts`、`app.routes.spec.ts`，而帳單詳情不是一個會被 bookmark 或從選單
進入的「家」—— 它永遠從列表點進去。「一個功能一個家」的家是 `/admin/payments`
（[[architecture/teacher-students-view]]），帳單是那個家裡的一個抽屜。

**收款/退費為什麼共用一個 dialog**：兩者送的是同一支端點、同一組欄位，差別只有 `kind`
與「退費時 note 必填」。兩個元件會是同一份程式碼複製兩次。

## 列印：兩種視圖，一個 `@media print`

實體流程有兩張紙（spec）：**收費袋 = 列印帳單**（發出去）與**收據**（收款後給）。
先例是 `shared/components/login-link-dialog`：`window.print()` + `@media print` 藏掉
不該印的區塊，**不引入 pdfmake**（那個依賴已經因為同樣的理由被拿掉過一次）。

**決定**：詳情 dialog 內兩顆按鈕（列印帳單 / 列印收據），按下時在 host 上切一個
`data-print` 屬性決定 `@media print` 要留哪一塊，然後 `window.print()`。
收據需要 `receiptNo` —— 它由 DB trigger 產生、在 `payments[].receiptNo` 回來，
**沒有收款記錄就沒有收據可印**，那顆按鈕在 `payments` 為空時 disabled。

## 純函式 + spec（charter 先例）

`payments.util.ts`：

- `isOverdue(invoice, today)` —— 逾期是衍生標記不是狀態，`dueDate` 可為 null（沒到期日就不逾期），
  比較用日期字串不用 `Date`（跨時區與跨日是這裡唯一的邊界）
- `outstanding(invoice)` —— `total - netPaid`，可為負（退費多於應繳）
- `statusLabel(status, overdue)` —— 三態 + 逾期標記的顯示組合

會有邊界條件的就這三個。**比例試算（插班/退班）不在這一輪** —— spec 有，工單沒有，
不自行擴範圍。

## 明確不做

| 項目                       | 理由                                      |
| -------------------------- | ----------------------------------------- |
| 狀態 / 日期區間 / 分校篩選 | API 無此 query，前端做會騙人（落差 1、3） |
| 顯示總筆數與總頁數         | `meta.total` 目前不可信（落差 2）         |
| 憑證圖上傳                 | Storage 接線是獨立議題（工單明示）        |
| 插班/退班比例試算          | spec 有、工單無，不擴範圍                 |
| run（自動開帳）觸發        | A3 進行中，合併後小追加（工單明示）       |
| 修 `meta.total`            | `apps/api` 不是這一席的邊界，回報計畫席   |

## 影響的既有元件

**只有新增，沒有修改既有元件。** 新增 `core/invoices.service.ts`、
`features/admin/pages/payments/**`。復用 `shared/components/` 的
`student-autocomplete`、`responsive-table`、`empty-state`、`popup-menu`、`confirm-dialog`。

`kb/wiki/specs/admin/finance/payments.md` 的「⏳ 這三張表尚未存在於 main」那段**已經過期**
（A2 已合，`invoices` / `payment_records` / `payment_reminders` 都在），隨這一輪一起改掉。
