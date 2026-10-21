---
title: 收款後報名轉正式、申請轉完成（設計稿）
summary: 設計稿（#1778，保留類、改既有記收款路徑 → 合併由使用者決定；待裁 Q1–Q6）。核准後報名是 pending_payment、申請是 awaiting_payment，現在沒有任何路徑把它們往前推，而月結只對 active 開單 —— 卡在 pending_payment 的學生下個月不會被開帳。建議：記收款那一刻在同一個交易裡判斷 —— 這張帳單上有明細的 pending_payment 報名，第一筆收款（含定金）就轉 active；帳單繳清時，連到這些報名的 awaiting_payment 申請轉 completed。退費、作廢不倒轉。手動把報名轉 active 也一併完成申請。記收款路由改走 withTx（順便關掉退費「先查淨額再寫」的競態）。
category: spec
status: draft
updated: 2026-10-21
tags: [specs, admin, enrollment, enrollment-requests, billing, payments, design]
sources: [https://github.com/mizok/clessia/issues/1778]
---

# 收款後報名轉正式、申請轉完成（設計稿）

> **狀態：待裁（Q1–Q6）。保留類：改的是既有「記收款」路徑（`POST /api/invoices/:id/payments`），合併由使用者決定。**
> 從 [[specs/admin/enrollment/approve-request]] Q7 拆出（使用者 10-21 裁：另開單）。
> 規則來源：[[rules/enrollment-rules]] §1.4–1.5、[[rules/billing-rules]] 規則 4（帳單狀態由收款推導）、規則 6（定金）、規則 9（作廢）。

## 0. 現況（2026-10-21 查）

| 項目               | 現況                                                                                                                                                                                                                    | 出處                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 誰產生待付款       | 核准申請（交易內建 `pending_payment` 報名＋帳單＋申請轉 `awaiting_payment`、寫 `enrollment_id`）；直接報名可選 `status: pending_payment`（預設 `active`）                                                               | `lib/enrollment-approve.ts:151,203`、`routes/enrollments.ts:129,772`                   |
| 誰把它往前推       | **沒有自動路徑**。只有行政手動 `PATCH /api/enrollments/:id/status`（任意轉，只擋終態與 `pending_payment → suspended`）。申請的 `completed` 全 repo 沒有任何寫入                                                         | `routes/enrollments.ts:940-1030`                                                       |
| 卡住的後果         | **月結／期結只挑 `active` 的報名開單** —— `pending_payment` 的學生下一期不會被開帳。名額、學生列表、聯絡簿、家長帳戶都把 `pending_payment` 當在班                                                                       | `routes/billing-runs.ts:135,249`；`lib/class-seats.ts:18`、`routes/students.ts:247` 等 |
| 記收款             | `POST /api/invoices/:id/payments`：supabase-js 逐句（查帳單 → 退費時查淨額 → insert），**沒有交易**；退費的「淨額夠不夠退」是先查再寫。沒有改／刪收款的路由                                                             | `routes/invoices.ts:912-1006`                                                          |
| 帳單狀態           | 沒有欄位，由 Σ收款 − Σ退費 對 Σ明細推導：`unpaid`／`partial`／`paid`／`void`／`overrefunded`                                                                                                                            | `lib/invoice-status.ts:23`                                                             |
| 作廢               | 淨額必須 0、連著堂數包不能作廢、不可撤銷                                                                                                                                                                                | `routes/invoices.ts:1073+`、[[rules/billing-rules]] 規則 9                             |
| 帳單 ↔ 報名 ↔ 申請 | `invoice_items.enrollment_id` → 報名；`enrollment_requests.enrollment_id` → 申請（Q5 不加 `invoice_id`）。**一張帳單可以有好幾個報名的明細**（手動開單、加明細）                                                        | `routes/invoices.ts:650,774`                                                           |
| 規則怎麼說         | §1.4「首次收款（**含部分繳費**）」；§1.5 確認收款後：帳單（部分或全額）、申請「**已繳清**可轉 `completed`」、報名轉 `active`「可依實務分批啟用」。規則 6：定金 = 第一筆部分收款，「`pending_payment` 承接**定金未繳**」 | [[rules/enrollment-rules]]:38-44、[[rules/billing-rules]]:55-59                        |
| 家長端             | 申請 `awaiting_payment` 顯示待付款＋帳單方塊（#1771／#1773）；`completed` 目前沒有文案                                                                                                                                  | `routes/parent/enrollment-requests.ts:140`、`features/parent/pages/enrollment`         |

所以規則其實給了**兩個不同的點**：報名在**收到第一筆錢（定金）**就算正式；申請要**繳清**才算完成。

## 1. 建議的行為

記收款（`kind = payment`）**同一個交易**裡，寫完那筆收款後：

1. **報名轉正式**：這張帳單上有（未刪）明細的報名裡，狀態還是 `pending_payment` 的 → `active`（`status_changed_at = 今天`）。
   觸發條件：這是一筆**收款**（不看金額是否繳清 —— 定金就算，Q1）。
2. **申請轉完成**：帳單推導後是 `paid` 時，`enrollment_id` 在上面那群報名裡、狀態 `awaiting_payment` 的申請 → `completed`。
   部分繳時申請維持 `awaiting_payment`（家長端繼續看到「還差 N 元」）。
3. 退費（`kind = refund`）**不倒轉**（Q3）：報名已經在上課、月結已經開；要退班走退班。
4. 手動 `PATCH /api/enrollments/:id/status` 把 `pending_payment` 轉 `active` 時，同一個交易把連到它的 `awaiting_payment` 申請轉 `completed`（Q4）—— 「依實務分批啟用」的人工路徑也不留下懸著的申請。

不限於從申請來的報名：**直接報名選 `pending_payment` 的也一樣**（Q2）—— 規則 1.5 說的是「報名」，不是「申請」。

## 2. 後端

### 2.1 `POST /api/invoices/:id/payments` 改走 `withTx`

```text
BEGIN
  SELECT … FROM invoices WHERE id=$1 AND org_id=$2 FOR UPDATE      -- 不在 / 不在 campusScope → 404（同現況 findScopedInvoice）
  voided → 409 VOIDED
  refund：SELECT Σ … FROM payment_records WHERE invoice_id=$1      -- 鎖住帳單後再數 → 併發兩筆退費不會一起過
          net − amount < 0 → 409 REFUND_EXCEEDS_PAID
  INSERT payment_records …                                          -- 收據號 trigger 在交易內照常
  if kind = payment:
    UPDATE enrollments SET status='active', status_changed_at=$today
      WHERE org_id=$2 AND status='pending_payment'
        AND id IN (SELECT enrollment_id FROM invoice_items WHERE invoice_id=$1 AND enrollment_id IS NOT NULL)
      RETURNING id                                                  -- activated
    if 推導狀態(帳單) = paid:
      UPDATE enrollment_requests SET status='completed'
        WHERE org_id=$2 AND status='awaiting_payment'
          AND enrollment_id IN (同一群報名：本帳單明細的 enrollment_id)
        RETURNING id                                                -- completed
COMMIT
```

- 交易外（rule 7）：既有的收款 `logAudit` 照舊；**另記** `enrollment.activate`（`details.via = 'payment'`, `paymentId`）與
  `enrollment_request.complete`，各自一筆，`resourceId` 指那筆報名／申請 —— 查「這個學生什麼時候轉正式」查得到。
- 回應多帶 `activatedEnrollmentIds`、`completedRequestIds`，前端 toast 寫「已記收款，○○ 轉為正式」。
- 推導 `paid` 用 `lib/invoice-status.ts` 同一支函式（交易內 SELECT 明細與收退款後算），不另寫一份判斷。
- 申請條件用「本帳單明細的報名」而不是只用 1. 剛轉的那批：報名可能先因定金轉了 `active`，**繳清那一筆**才完成申請。
- 為什麼要交易：收款寫進去了、報名沒轉 → 月結漏開；報名轉了、收款失敗 → 沒收錢就正式。兩步不同表，同 [[architecture/pg-pool-writes]]。
  順便關掉現況「退費先查淨額再寫」的競態（兩筆退費同時過、淨額變負）。
- pg 池不在就 500，不退回 supabase-js 逐句寫（pg-pool-writes rule 6）。

### 2.2 `PATCH /api/enrollments/:id/status`

只加一件事：`pending_payment → active` 時，同一個交易把 `enrollment_id = 這筆` 且 `awaiting_payment` 的申請轉 `completed`（Q4）。
這支現在是 supabase-js 單句；改成 `withTx`（鎖報名列、改狀態、改申請）。其他轉換不動。

### 2.3 不做 migration

狀態值、欄位都已存在（`enrollment_request_status` 有 `completed`、`enrollments.status_changed_at` 已有）。Q5 選 (b) 才要加 `notification_kind`。

## 3. 前端

- **帳單詳情記收款**：toast 多一句「○○（班名）轉為正式」／「申請已完成」（有才寫）。
- **管理端收件頁**：`completed` 的申請移到「已完成」，卡片寫「○/○ 繳清，已轉正式」。
- **家長端申請頁**：`completed` 寫「已完成報名」；`awaiting_payment` 而帳單部分繳時寫「已收 N 元，還差 M 元」（現有帳單方塊已帶 `netPaid`）。
  #1773 的「已繳清，等補習班確認」在這張合併後**不會再出現**（繳清的同一個交易就完成申請），文案拿掉。

## 4. 待裁

**Q1　報名在什麼時候轉 `active`？**
(a) **建議**：**第一筆收款**（含定金、部分繳）。規則 6 寫 `pending_payment` 承接「定金未繳」、§1.4 寫「首次收款（含部分繳費）」；
而且月結只對 `active` 開單 —— 等繳清才轉，繳了定金在上課的學生下個月會被月結漏掉。
(b) 繳清才轉（跟申請同一個點）。簡單一致，但月結漏開的問題要另外處理（例如月結也挑 `pending_payment`）。
(c) 不自動，一律行政手動確認（現況的 PATCH）。不改收款路徑，但「沒有人去按」就永遠卡著 —— 這張單存在的原因。

**Q2　直接報名選了 `pending_payment` 的（不是從申請來的）也適用嗎？**
**建議**：適用。規則說的是「報名」；同一張帳單、同一種狀態，從哪條路建的不該有不同結局。

**Q3　轉正式之後退費、或帳單作廢，要不要倒轉回 `pending_payment`／`awaiting_payment`？**
**建議**：**不倒轉**。報名已經在上課、可能已月結開了下一張；退錢是退費、退班是退班，各走各的路（規則 3：退班有自己的比例試算）。
作廢本來就要淨額 0 才能做，等於已經退費歸零 —— 照上面一樣不倒轉。

**Q4　行政手動把報名轉 `active`（分批啟用）時，要不要順便完成申請？**
**建議**：要。不然申請永遠停在 `awaiting_payment`，家長端一直顯示待付款。

**Q5　完成時要通知家長嗎？**
(a) **建議**：不另發。家長是當面或轉帳後通知櫃台才記收款的，當下就知道；家長端申請頁狀態自己會變。
(b) 發站內＋推播「○○ 的報名已完成」（要加 `notification_kind`，migration 獨立 PR，使用者 Approve）。

**Q6　一張帳單有好幾個報名的明細時（手動開單、加明細），怎麼算？**
**建議**：照**帳單**算 —— 收款記在帳單上，不分到明細（現況沒有「這筆錢付哪一列」的資料）。所以第一筆收款會把這張帳單上**所有** `pending_payment` 報名一起轉正式；
繳清時把連到它們的申請一起完成。核准開的帳單只有一列，這題只影響行政手動併單的情況。

## 5. 拆單

| #   | 類型   | 內容                                                                                                                                          |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 保留類 | 記收款改 `withTx`＋轉正式／完成申請＋稽核＋契約測試（定金轉 active、繳清才 complete、退費不倒轉、併發退費）—— **使用者親合**                  |
| 2   | 保留類 | `PATCH /enrollments/:id/status` 的 `pending_payment → active` 一併完成申請（withTx）                                                          |
| 3   | 一般類 | 前端：記收款 toast、收件頁「已完成」、家長端 `completed`／部分繳文案（拿掉「已繳清，等補習班確認」）                                          |
| —   | 規則   | 合併時改 [[rules/enrollment-rules]] §1.5、[[flows/enrollment]] 步驟 4、`architecture/enrollment-admin-view.md` 的「pending_payment 是死狀態」 |

順手（不在這張）：`features/admin/pages/enrollments/enrollments.page.ts:156` 的註解「沒有流程會產生 pending_payment」已不成立（核准會產生）。
