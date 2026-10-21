---
title: 收款後報名轉正式、申請轉完成（設計稿）
summary: 設計稿（#1778，已裁 2026-10-21；保留類、改既有記收款路徑 → 合併由使用者決定）。核准後報名是 pending_payment、申請是 awaiting_payment，原本沒有任何路徑把它們往前推，而月結只對 active 開單。已裁：記收款同一個交易裡，第一筆收款（含定金）就把這張帳單上的 pending_payment 報名轉 active；帳單繳清時把連到它們的 awaiting_payment 申請轉 completed，並發站內＋推播通知家長（新 notification_kind enrollment_completed，migration 獨立 PR）。退費、作廢不倒轉；行政手動轉 active 也一併完成申請；多報名的帳單照帳單算。記收款路由改走 withTx（順便關掉退費先查淨額再寫的競態）。
category: spec
status: accepted
updated: 2026-10-21
tags: [specs, admin, enrollment, enrollment-requests, billing, payments, notifications, design]
sources: [https://github.com/mizok/clessia/issues/1778]
---

# 收款後報名轉正式、申請轉完成（設計稿）

> **狀態：已裁（使用者 2026-10-21，計畫席轉記於 #1787，見 §4）。保留類：改的是既有「記收款」路徑（`POST /api/invoices/:id/payments`），合併由使用者決定。**
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
5. **通知家長**（Q5 (b)）：申請轉 `completed` 時（1.2 或 1.4 任一條路），發一則站內＋推播「○○ 的報名已完成」給申請學生的家長，深連到申請詳情。
   只有**申請**完成才發 —— 直接報名沒有申請，家長本來就是在櫃台辦的。

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
- 交易外（rule 7）發通知：對每筆 `completed` 的申請呼叫 `notifyEnrollmentCompleted`（新，放 `lib/notify-events.ts`），
  形狀照抄 #1777 的 `notifyEnrollmentApproved` —— 收件人是 `parent_student_relations` 的家長、`role: 'parent'`、
  `push_status` 用欄位預設（pending，排程推播）、`dedupe_key = enrollment_completed:<requestId>`；用 `waitUntil` 背景跑，**失敗只記 log、不回滾收款**。
- 回應多帶 `activatedEnrollmentIds`、`completedRequestIds`，前端 toast 寫「已記收款，○○ 轉為正式」。
- 推導 `paid` 用 `lib/invoice-status.ts` 同一支函式（交易內 SELECT 明細與收退款後算），不另寫一份判斷。
- 申請條件用「本帳單明細的報名」而不是只用 1. 剛轉的那批：報名可能先因定金轉了 `active`，**繳清那一筆**才完成申請。
- 為什麼要交易：收款寫進去了、報名沒轉 → 月結漏開；報名轉了、收款失敗 → 沒收錢就正式。兩步不同表，同 [[architecture/pg-pool-writes]]。
  順便關掉現況「退費先查淨額再寫」的競態（兩筆退費同時過、淨額變負）。
- pg 池不在就 500，不退回 supabase-js 逐句寫（pg-pool-writes rule 6）。

### 2.2 `PATCH /api/enrollments/:id/status`

只加一件事：`pending_payment → active` 時，同一個交易把 `enrollment_id = 這筆` 且 `awaiting_payment` 的申請轉 `completed`（Q4）。
這支現在是 supabase-js 單句；改成 `withTx`（鎖報名列、改狀態、改申請）。其他轉換不動。
COMMIT 後同 2.1 發 `notifyEnrollmentCompleted`、記 `enrollment_request.complete` 稽核（`details.via = 'manual'`）。

### 2.3 Migration：只加一個通知種類

狀態值、欄位都已存在（`enrollment_request_status` 有 `completed`、`enrollments.status_changed_at` 已有）。
Q5 (b) 要一個新值：`ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'enrollment_completed'`（照 `20261021055600_notification_kind_enrollment_approved.sql`）。
純加列舉值、舊程式碼不寫它，「先套後部署」安全；`ADD VALUE` 不跟使用它的語句同交易 —— 這支只加值。**獨立 PR，使用者 Approve**；實作的 PR 要等它套上正式並部署。
家長端通知中心（`announcement-inbox`）的種類對照表要加這個值（#1777 加 `enrollment_approved` 的同一處）。

## 3. 前端

- **帳單詳情記收款**：toast 多一句「○○（班名）轉為正式」／「申請已完成」（有才寫）。
- **管理端收件頁**：`completed` 的申請移到「已完成」，卡片寫「○/○ 繳清，已轉正式」。
- **家長端申請頁**：`completed` 寫「已完成報名」；`awaiting_payment` 而帳單部分繳時寫「已收 N 元，還差 M 元」（現有帳單方塊已帶 `netPaid`）。
  #1773 的「已繳清，等補習班確認」在這張合併後**不會再出現**（繳清的同一個交易就完成申請），文案拿掉。

## 4. 裁定（使用者 2026-10-21，計畫席轉記於 #1787）

| 題                              | 裁定                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Q1 報名何時轉 `active`          | (a) **第一筆收款**（含定金、部分繳）；申請在帳單繳清時轉 `completed`                                       |
| Q2 直接報名的 `pending_payment` | 照建議：適用（同帳單、同狀態，不看從哪條路建的）                                                           |
| Q3 退費／作廢倒轉               | 照建議：**不倒轉**；退錢走退費、退班走退班                                                                 |
| Q4 手動轉 `active` 是否完成申請 | 照建議：要，同一個交易                                                                                     |
| Q5 完成時通知家長               | **(b)** 站內＋推播「○○ 的報名已完成」；新 `notification_kind`（`enrollment_completed`），migration 獨立 PR |
| Q6 一張帳單多個報名             | 照建議：照**帳單**算，第一筆收款轉全部 `pending_payment` 報名，繳清時完成連到它們的申請                    |

被否決的選項：Q1 (b) 繳清才轉 —— 繳了定金在上課的學生會被月結漏開；Q1 (c) 只靠手動 —— 沒人按就永遠卡著；Q5 (a) 不另發。

## 5. 拆單

| #   | 類型      | 內容                                                                                                                                                          |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | migration | `notification_kind` 加 `enrollment_completed`（Q5 (b)；獨立 PR，使用者 Approve）                                                                              |
| 1   | 保留類    | 記收款改 `withTx`＋轉正式／完成申請＋稽核＋通知家長＋契約測試（定金轉 active、繳清才 complete、退費不倒轉、併發退費）—— **使用者親合**；依賴 0 套上正式並部署 |
| 2   | 保留類    | `PATCH /enrollments/:id/status` 的 `pending_payment → active` 一併完成申請＋通知（withTx）；依賴 0                                                            |
| 3   | 一般類    | 前端：記收款 toast、收件頁「已完成」、家長端 `completed`／部分繳文案（拿掉「已繳清，等補習班確認」）、通知中心種類對照                                        |
| —   | 規則      | 合併時改 [[rules/enrollment-rules]] §1.5、[[flows/enrollment]] 步驟 4、`architecture/enrollment-admin-view.md` 的「pending_payment 是死狀態」                 |

順手（不在這張）：`features/admin/pages/enrollments/enrollments.page.ts:156` 的註解「沒有流程會產生 pending_payment」已不成立（核准會產生）。
