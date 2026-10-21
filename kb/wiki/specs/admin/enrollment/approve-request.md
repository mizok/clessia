---
title: 核准家長的報名申請（開繳費單、建報名、轉待付款；設計稿）
summary: 設計稿（#1726，保留類、金額路徑；使用者 10-21 已裁 Q1–Q8，Q9 待裁）。管理員在 /admin/applications 核准家長 App 送的報名申請：一個對話框選計費模式與價目表、看首期試算（可改，改了要寫原因）、繳費期限；送出後在**一個 pg 交易**（withTx，repo 不引入 RPC）裡鎖班、重數名額（直接報名不拿鎖的競態另列 Q9）、建 pending_payment 的報名、開一張帳單一列學費明細（填好月份／期別，月結不會重開）、申請轉 awaiting_payment 並寫 enrollment_id。候補可核准但名額照數、額滿 409 不給硬塞。帳單不加欄位，靠 enrollment_requests.enrollment_id → invoice_items → invoices 連回；家長端申請詳情走 childDb 讀這張帳單與班級分校的帳戶。核准當下發站內＋推播給家長（新 notification_kind，migration 獨立 PR）。核准要 manage_students＋manage_finance；這版支援堂數制。A6 沒畫管理端核准；家長端待付款詳情照 A6 p-enrollment 全採。
category: spec
status: accepted
updated: 2026-10-21
tags: [specs, admin, enrollment, enrollment-requests, billing, invoices, parent, design]
sources: [https://github.com/mizok/clessia/issues/1726]
---

# 核准家長的報名申請（設計稿）

> **狀態：已裁定（使用者 2026-10-21，計畫席轉記於 #1758；Q1–Q8 全照建議）。Q9 未裁，未裁前拆單 1b 不開。**
> 保留類（金額路徑）：每張實作 PR 開之前先報計畫席。
> 規則來源：[[rules/enrollment-rules]] §1.2（核准＝建繳費單＋建 `pending_payment` 報名＋申請轉 `awaiting_payment`）、
> [[rules/billing-rules]]（定價＋人工覆寫、比例試算是建議值、單一 `due_date`）。
> 家長端「待付款詳情」從 [[specs/parent/applications]] Q3 併進來（計畫席 10-19）。

## 0. 現況（2026-10-21 查）

| 項目         | 現況                                                                                                                                                                                                          | 出處                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 管理端收件   | 報名只能**拒絕**；`awaiting_payment` 不能拒絕（帳單已開）。頁面寫「核准：目前請到學生檔案手動報名」                                                                                                           | `routes/parent-requests.ts:17-21`、`applications.page.html:114`          |
| 直接報名     | `POST /api/enrollments`：先查班、名額（`OVER_QUOTA`，**不能硬塞**）、衝堂（可 `skipConflictCheck`）→ 單句 insert。**不開帳單**。先讀後寫、沒鎖                                                                | `routes/enrollments.ts:696-811`、`routes/enrollments/validation.ts:96`   |
| 手動開帳單   | `POST /api/invoices`：先 insert 帳單、再 insert 明細，明細失敗就刪帳單（**補償式，不是交易**）。`due_date` 預設 = 開帳日 + `organizations.invoice_due_days`（預設 14）                                        | `routes/invoices.ts:661-750`                                             |
| 月結／期結   | `billing-runs`：金額 `agreed_amount ?? fee_templates.amount`，`prorateByDays` 依生效起迄試算；**冪等靠查 `invoice_items` 有沒有這個報名 × 這個月份／期別**                                                    | `routes/billing-runs.ts:78,243-283`、`lib/billing-run.ts:39`             |
| 多步原子寫入 | **repo 不引入 RPC**（計畫席 09-06）；要全有或全無就走 `withTx(getAuth(c).pool, …)`，交易內 `FOR UPDATE` 重做範圍判斷                                                                                          | [[architecture/pg-pool-writes]]、`lib/pg-tx.ts`、`lib/class-delete.ts`   |
| 申請表       | `enrollment_requests`：`enrollment_id`（FK，SET NULL，**還沒有任何路徑寫它**）、`billing_mode`（#1745，nullable，家長端只擋 `session_pack`）、`preferred_start_date`。**沒有 `invoice_id`**（刻意，從報名追） | `20261003033635_enrollment_requests.sql`、`20261019100310_…billing_mode` |
| 名額         | 佔名額 = `enrollments.status IN ('active','pending_payment')`；`classes.max_students` null = 不限。報名表沒有候補狀態，候補只在申請表                                                                         | `validation.ts:96`、`lib/catalog-class.ts:116`                           |
| 帳戶資訊     | `campuses.payment_info` 優先、`organizations.payment_info` 墊底（`pickPaymentInfo`）。帳單**沒有分校欄**                                                                                                      | `lib/payment-info.ts`、`20261003071532_payment_info.sql`                 |
| 家長讀帳單   | `childDb.from('invoices','student_id')`；帳戶從孩子 `active`／`pending_payment` 報名的班級分校推                                                                                                              | `routes/parent/billing.ts:128-225`                                       |
| 家長通知     | `notification_kind` 給家長的只有 `invoice_due`／`invoice_overdue`（到期前後的推播排程）。**沒有「已核准／已開帳」**                                                                                           | `20261016073848_push_notifications.sql:38`                               |
| 付清後       | **沒有任何路徑**把報名轉 `active`、申請轉 `completed`                                                                                                                                                         | grep 無                                                                  |

**A6**：沒有畫管理端核准（`enrollments.html` 只有「直接報名」表單，欄位是學生、班、計費模式、生效起迄、建不建繳費單）。
家長端待付款詳情有畫（`p-enrollment.html:255-270`）：時間軸「審核通過，開立繳費單」、繳費單方塊（金額、期限）、
付款方式（現金到某分校櫃台／轉帳後告訴櫃台末五碼）、銀行帳戶 → **家長端照 A6 全採**；管理端對話框沿用 A6 直接報名表單的欄位與 `form()` 形狀。

## 1. 管理端：核准對話框

`/admin/applications` 報名卡片（`pending`／`waitlist`）加「核准」鈕，開對話框（A6 `form()` 形狀，同 #1740 的共用表單）：

| 欄位     | 預設                                                                                   | 規則                                                                                  |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 計費模式 | 家長選的 `billing_mode`；沒選 → 班級預設範本的模式；都沒有 → 不預選                    | 必填。三種都可選（堂數制見 Q4）                                                       |
| 價目表   | 班級預設範本（模式相符時）；否則該模式唯一一張啟用中的範本；否則不預選                 | 必填，只列該模式、啟用中的範本。**實際價以 `enrollments.fee_template_id` 為準**（Q2） |
| 議定金額 | 空                                                                                     | 選填，填了寫進 `agreed_amount`，要附調整原因（規則 5.3）                              |
| 生效起   | 家長的「希望開始」；沒有 → 今天                                                        | 必填                                                                                  |
| 首期金額 | 試算值：`agreed_amount ?? 範本金額` 依生效起 `prorateByDays`（同月結算法），旁邊寫算式 | 可改；**改了要寫原因**（寫進明細 note）。0 元擋                                       |
| 繳費期限 | 今天 + `invoice_due_days`                                                              | 可改                                                                                  |

- 家長選的模式與實際選的不同時，對話框上方琥珀字「家長選的是月繳」—— **不擋**（行政核准時對，#1727 B (b)）。
- 衝堂：跟直接報名同一個檢查，有衝堂列出來，勾「仍要報名」才送（`skipConflictCheck`）。
- 送出後卡片移到「進行中」，toast「已核准，帳單 INV-xxxx 已開」＋連到帳單詳情。

首期的「期」：月繳 = 生效起那個月（`period_month` = 該月 1 號）；期繳 = 涵蓋生效起的 `billing_periods`（沒有涵蓋的期 → 對話框寫「沒有涵蓋這天的繳費期，請先到設定建立」，送出鈕停用）。

## 2. 後端：`POST /api/parent-requests/enrollment/:id/approve`

`manage_students` **且** `manage_finance`（開帳單是金流動作，見 Q6）。一個 `withTx`，順序：

1. `SELECT … FROM enrollment_requests WHERE id=$1 AND org_id=$2 FOR UPDATE` —— 不在、或班不在 campusScope → 404；
   status 不是 `pending`／`waitlist` → 409 `REQUEST_NOT_APPROVABLE`（併發的拒絕／取消／重複核准都落在這）。
2. `SELECT … FROM classes WHERE id=$1 AND org_id=$2 FOR UPDATE` —— 鎖班，**核准與核准之間**的名額判斷序列化。
   ⚠️ 直接報名（`POST /api/enrollments`、`/batch`、`/copy-from-class`）現在先讀後寫、**不拿這把鎖**（§0），
   所以核准與直接報名仍可能同時擠進最後一位。要真的擋住，那幾條也得在交易裡鎖同一列班再數 —— 見 Q9、拆單 1b。
3. 重數佔名額；`count >= max_students` → 409 `CLASS_FULL`（候補也一樣，見 Q3）。
4. 驗價目表屬於本 org、啟用中、模式相符；期繳驗 `billing_period_id` 屬於本 org 且涵蓋生效起。
5. `INSERT enrollments (status='pending_payment', billing_mode, fee_template_id, agreed_amount, adjustment_note, effective_from)`；
   23505（`enrollments_active_class_student_unique`）→ 409 `ALREADY_ENROLLED`。
6. `INSERT invoices (student_id, issued_at, due_date, note)`（`assign_invoice_no` trigger 在交易內照常編號）。
7. `INSERT invoice_items (type='tuition', enrollment_id, amount, period_month | billing_period_id, note)` ——
   **週期欄一定要填**：月結／期結的冪等是查這兩欄，不填會在下一次月結重開一張（§0）。
   堂數制另插 `session_packs (enrollment_id, purchased_count, invoice_item_id)`（Q4）。
8. `UPDATE enrollment_requests SET status='awaiting_payment', enrollment_id=$enrollment WHERE id=$1`。

COMMIT 後（交易外，rule 7）：`logAudit`（`enrollment_request.approve`，帶 enrollmentId／invoiceId／金額）、通知（§4）。
回 `{ enrollmentId, invoiceId, invoiceNo }`。

**為什麼是交易不是補償**：任一步失敗都不能留下半套 —— 有報名沒帳單（佔名額、家長看不到要繳什麼）、
有帳單沒報名（月結又開一張）、兩者都有但申請還在待審核（行政再核准一次 → 23505 才擋得住，帳單已多一張）。
`invoices.ts` 的補償式是單表兩步；這裡是四表，補償要自己設計三種失敗態，[[architecture/pg-pool-writes]] 說能用交易就不要選它。

**不做**：pg 池不在就 500，不退回 supabase-js 逐句寫（pg-pool-writes rule 6）。

## 3. 帳單怎麼連回申請；家長端待付款詳情

**不加欄位**（Q5）：`enrollment_requests.enrollment_id → invoice_items.enrollment_id → invoices`。
「這筆申請的帳單」= 該報名**最早開立、未作廢**的帳單（核准開的那張；作廢重開也找得到新的那張）。

家長端 `GET /api/me/enrollment-requests`（`childDb`，保留類）：`awaiting_payment` 的列多帶

```ts
invoice: { id, invoiceNo, amount, paid, dueDate, status } | null; // status 照 lib/invoice-status 推導
paymentInfo: PaymentInfo | null; // pickPaymentInfo(班級分校, org)
```

- 讀法：先用 childDb 確認申請屬 scope 內孩子（已是現況），再以 `enrollment_id` 讀明細 → 帳單（同一個孩子，`childDb.from('invoices','student_id')`）。
- 帳戶取**申請的班級**的分校，不是孩子現有的分校（新報名的孩子可能第一次來這個分校）。
- 前端照 A6 `p-enrollment.html:255-270`：時間軸「審核通過，開立繳費單」＋繳費單方塊（金額、期限）＋付款方式＋帳戶；
  帳單已繳清時方塊改寫「已繳清，等補習班確認」（見 Q7）。`invoice` 為 null（被作廢沒重開）時沿用過渡文案「請到繳費頁」。
- 過渡文案「已核准，請到繳費頁付款」在這張完成後拿掉。

## 4. 通知家長

不接 LINE Messaging API。**已裁 Q1 (b)**：核准當下發一則站內＋推播「○○ 的報名已核准，請在 MM/DD 前繳 N 元」，深連到申請詳情。要加 `notification_kind` 值（migration，獨立 PR）。
收件人：申請學生的家長（`parent_student_relations`）；COMMIT 後在交易外發（pg-pool-writes rule 7），失敗不回滾核准。

## 5. 拆單

| #   | 類型      | 內容                                                                             |
| --- | --------- | -------------------------------------------------------------------------------- |
| 1   | 保留類    | 核准 API（交易、名額、帳單、申請轉態）＋ spec 測試（併發、23505、週期欄）        |
| 1b  | 保留類    | 只在 Q9 選 (a)：直接報名三條路的名額判斷改走同一支「鎖班＋數名額」函式（withTx） |
| 2   | 一般類    | 管理端核准對話框（試算、原因、衝堂確認）                                         |
| 3   | 保留類    | 家長端申請 API 帶 `invoice`／`paymentInfo`（childDb）                            |
| 4   | 一般類    | 家長端待付款詳情照 A6                                                            |
| 5   | migration | `notification_kind` 加值（Q1 (b) 已裁；獨立 PR）                                 |
| 6   | 保留類    | 核准後發站內＋推播給家長（依賴 5 套上正式）                                      |

規則同步：`enrollment-rules.md` §1.1「核准尚未實作」那句、`enrollment-requests.md` 頁首現況、`parent/applications.md` Q3 過渡，實作合併時一起改。

## 6. 裁定（使用者 2026-10-21，計畫席轉記於 #1758）

| 題                     | 裁定                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Q1 通知家長            | (b) 站內＋推播；新 `notification_kind`，migration 獨立 PR                                 |
| Q2 金額來源            | 必選價目表、預選班級預設範本；首期試算可改，改了寫原因                                    |
| Q3 候補／額滿          | 候補可直接核准；交易裡重數名額，額滿 409 `CLASS_FULL`，不硬塞                             |
| Q4 堂數制              | (a) 這版支援：對話框多一欄堂數，交易多插一列 `session_packs`                              |
| Q5 申請加 `invoice_id` | 不加，從報名追                                                                            |
| Q6 核准權限            | `manage_students` **且** `manage_finance`                                                 |
| Q7 付清後轉正式        | 另開單                                                                                    |
| Q8 核准可不開帳單      | 不行，核准一定開帳單                                                                      |
| Q9 直接報名不拿鎖      | **未裁**（不在 10-21 的裁定裡），未裁前拆單 1b 不開                                       |
| A6 申請自動過期        | 這版不做，維持規則「不自動失效」，登記為 A6 偏離（[[architecture/a6-adoption-rules]] R5） |

## 6.1 原題與建議（留存）

**Q1　核准時要不要通知家長？**
(a) 不另發，靠繳費頁＋既有到期推播。(b) **建議**：發一則站內＋推播（加 enum，migration 獨立 PR）。
理由：家長送出後在等的就是這個消息；到期推播是期限前才發，中間兩週家長不知道已核准。

**Q2　帳單金額從哪來？** 班級預設範本只用於顯示（#1727 B (b)）。
**建議**：核准對話框**必選價目表**，預選班級預設範本；首期 = 試算值、可改、改了寫原因（規則 5.2、5.3）。
不走「自動套班級預設、不給選」：那等於給預設範本一個它沒有的硬性語意。

**Q3　候補（`waitlist`）能不能直接核准？額滿怎麼辦？**
**建議**：候補**可以**核准（有人退班空出名額時，行政就是從候補挑人），但跟待審核一樣在交易裡重數名額；
額滿一律 409 `CLASS_FULL`、**不給硬塞**（跟直接報名的 `OVER_QUOTA` 一致；要多收就先改班級上限）。

**Q4　堂數制（`session_pack`）要不要在這一版支援？** 家長端不能選，但行政核准時可能改成堂數制。
(a) **建議**：支援 —— 對話框選堂數制時多一欄「堂數」，交易多插一列 `session_packs`（有 `invoice_item_id` 可連）。多一步 insert，不多一張表。
(b) 這一版不給選，堂數制請到學生檔案手動報名。

**Q5　帳單要不要直接存在申請上（加 `enrollment_requests.invoice_id`）？**
**建議**：不加，照申請表 migration 檔頭的原意從報名追；「最早、未作廢」那張就是。加欄位要 migration，而且作廢重開時還得同步改它。

**Q6　誰能核准？** 收件頁現在是 `manage_students`。
**建議**：核准要 `manage_students` **加** `manage_finance`（會開帳單）；只有前者的人看得到「核准」但停用，hover 寫「需要財務權限」。
另一個選項是只要 `manage_students`（行政一人包辦的小補習班較順）—— 請使用者依實際分工裁。

**Q7　付清之後誰把報名轉 `active`、申請轉 `completed`？**（規則 1.5，目前沒有任何路徑會做）
**建議**：**另開單**（收款路徑，也是保留類）。這張只核准；家長端看到帳單繳清時寫「已繳清，等補習班確認」，不會卡在一個看起來沒動的「待付款」。

**Q9　直接報名不拿鎖，核准與它仍可能一起擠進最後一位，要不要一起修？**（審核席 #1758 指出）
(a) **建議**：要 —— 拆單 1b，把直接報名的名額判斷搬進交易、鎖同一列班，跟核准共用同一支函式（pg-pool-writes rule 5：同一件事只能有一份守門）。
(b) 不修，接受極少見的超收一位（兩個行政同一秒對同一班的最後一個位子動作），額滿時行政自己退一位。
現況直接報名彼此之間本來就有同樣的競態，(b) 等於維持現狀。

**Q8　核准時能不能「不開帳單」**（A6 直接報名有「不建立（已收款或免費）」）？
**建議**：不行 —— 規則 1.2 核准就是開帳單；已收現金的，核准後在帳單上直接記收款。要免費就走直接報名。

## 7. 不做（這一版）

- 申請過期（`expired`，A6：繳費期限過了申請過期）—— **使用者 10-21 裁不做**：維持規則 3「欠繳只做可見性、不自動失效」，A6 偏離已登記於 [[architecture/a6-adoption-rules]] R5。
- 批次核准。
- 首次收款自動建家長／學生（規則 1.4，那是公開表單的路；家長 App 的申請學生已存在）。
