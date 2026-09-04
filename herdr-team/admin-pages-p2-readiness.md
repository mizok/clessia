# P2 管理端補完 —— 開工前盤點（admin-pages 席）

> 2026-08-29 由 clessia-8f 產出，唯讀盤點、零改動。計畫席核准的前置作業。
> **每一項都標了憑據**：「✅ 已驗於 main」＝我實際開檔看過；「⏳ 待 A2」＝ billing-api 席
> 的 invoices/payments PR 定案前只能當草稿（charter 坑 #2：工單的資料前提要驗再信）。
> 這份會過期 —— A2/A3 合併後第一件事是重驗一次再刪掉過期項。

## 0. 一句話結論

P2 的四個財務頁**不是開新頁，是填內容**：路由、選單、元件檔全都在，是 17–18 行的佔位符。
真正擋住的只有「沒有 invoices / payment_records / meal_records」。
**有兩件事現在就能做，不擋在 A2/A3 後面** —— 見第 4 節。

## 1. ✅ 已驗於 main —— 四個財務空殼頁

| 頁面 | 元件 | 行數 | 路由 | 選單 |
| --- | --- | --- | --- | --- |
| 費用方案管理 | `admin/pages/fee-templates/fee-templates.component.ts` | 17 | `app.routes.ts:279` ✅ | ✅ |
| 餐費管理 | `admin/pages/meals/meals.component.ts` | 18 | ✅ | ✅ |
| 繳費紀錄 | `admin/pages/payments/payments.page.ts` | 18 | ✅ | ✅ |
| 營收報表 | `admin/pages/reports/reports.page.ts` | 18 | ✅ | ✅ |

四筆都註冊在 `core/smart-enums/routes-catalog.ts:240-275`，`showInMenu: true`、
`NavigationGroup.ADMIN_FINANCE`。**charter 坑 #1 這次不咬人**（選單與路由已經接上），
但新增子路由（如繳費單詳情 `/admin/payments/:id`）時它會回來 —— 那時要同步
`app.routes.spec.ts`。

## 2. ✅ 已驗於 main —— A1 落地的 API 形狀

### `GET|POST /api/billing-periods`、`PUT|DELETE /api/billing-periods/{id}`

`{ data: BillingPeriod[] }`，**沒有分頁**（刻意：一年兩期放十年才二十筆）。

```ts
BillingPeriod { id, orgId, name, startDate, endDate, createdAt, updatedAt }  // 日期是 YYYY-MM-DD 字串
```

- 建立時驗 `endDate >= startDate`，**但期間之間可以重疊**（過渡期是真實情境，`isValidPeriodRange` 只看單筆）。UI 不要自己補一條「不可重疊」的檢查。
- 排序：`start_date` 降冪。
- GET 失敗時回 `200 { data: [] }` 而非 5xx —— **前端分不出「沒有資料」和「查詢炸了」**。

### `GET|POST /api/fee-templates`、`PUT|DELETE /api/fee-templates/{id}`

`{ data: FeeTemplate[] }`，同樣沒有分頁。

```ts
FeeTemplate { id, orgId, name, billingMode: 'monthly'|'period'|'session_pack',
              amount: number, isActive, createdAt, updatedAt }
```

- `amount` 是**整數**（台幣沒有小數）；DB 是 numeric，API 已 `Number()` 轉好。
- query: `search`（名稱模糊）、`isActive`（字串 `'true'`/`'false'`）、`billingMode`。
- **停用不刪除**：`isActive: false` 的不該出現在報名的選單，但要留著讓歷史報名看得懂。真要刪 FK 是 RESTRICT，被引用過就刪不掉 → **UI 的刪除按鈕必須處理「刪不掉」的錯誤**，不能只做樂觀更新。
- **沒有折扣欄位**，這是憲法級的刻意決定（`billing-rules.md` 規則 2）。實際談定金額在 `enrollments.agreed_amount`。

### 🔴 權限：金流路由多一道 `manage_finance`

`apps/api/src/index.ts:266-267` —— 兩支金流路由 `mount(..., ADMIN_ONLY, 'manage_finance')`，
是 repo 裡**第一個**用到細部權限的地方。

charter 記的「`permissionGuard` 全 repo 零路由使用中」仍然成立，但現在後端會真的回 403。
→ 財務頁必須決定：用 `permissionGuard('manage_finance')` 擋在路由層，還是頁面內
`auth.hasPermission()` 做降級顯示。**這是要計畫席裁決的設計決定**（charter 先例：權限判斷
要放在 `computed` 裡，不要 field initializer 取快照）。

## 3. ✅ 已驗於 main —— 聯絡簿 / 教務日誌（P2 第四塊）

兩支 API 都在 `mount(..., ['admin', 'teacher'])`，老師的範圍由 `lib/teacher-scope` 縮到自己的班。
**管理端目前沒有任何頁面** → 這塊是真的要開新頁，坑 #1 全額適用。

```ts
// GET /api/contact-book?studentId&from&to   PUT /api/contact-book  （upsert，每生每日一則）
ContactBookEntry { id, studentId, studentName, entryDate, content,
                   lastEditedByName, signedBy, signedAt, isSigned }

// GET /api/class-logs?classId&from&to&published   PUT /api/class-logs
// POST /api/class-logs/{id}/publish
ClassLog { id, classId, className, logDate, teachingRecord, homework,
           lastEditedByName, publishedAt, isPublished }
```

- 兩支都回 `{ data, meta: { total } }` —— 照 charter 坑 #4，要顯示筆數就取 `meta.total`。
- 重複 PUT 視為共同編輯，只記 `lastEditedBy`，不做分段作者。
- **沒有簽收端點**（家長端簽收是 P4）；管理端只能唯讀 `isSigned` 做「哪些還沒簽」。
- `class_logs` 有草稿/已發布兩態，`contact_book` 沒有。

### 🔴 缺口：`classes.uses_contact_book` 沒被 API 暴露

欄位在 `supabase/migrations/20260829100000_create_contact_book_and_class_logs.sql:110`
（`ALTER TABLE classes ADD COLUMN uses_contact_book boolean NOT NULL DEFAULT false`），
但 `apps/api/src/routes/classes.ts` 與 `apps/web/src/app/core/classes.service.ts`
**都零引用**（grep 兩邊皆無命中）。

`contact-book-rules.md` 規則 2 說這個開關就是「國小模式 / 國中模式」的選擇 —— 沒有它，
管理端聯絡簿頁無法區分「這個班該寫個人聯絡簿還是教務日誌」。
→ **要 billing-api 席補 classes API 的欄位（含 PUT 讓班級設定頁能開關）**，不是我這席能動的。

## 4. 🟢 現在就能做，不擋在 A2/A3 後面

### 4a. 報名頁沒有計費欄位（優先）

`enrollments` 的 API 與 web service **都已經有** `billingMode` / `feeTemplateId` / `agreedAmount`：

- `apps/api/src/routes/enrollments.ts:39-42`（回傳）、`:84-86`（建立）、`:97-99`（更新）
- `apps/web/src/app/core/enrollments.service.ts:36-39, 65-67, 76-78`（型別齊全）

但 `apps/web/src/app/features/admin/pages/enrollments/enrollments.page.ts` **零引用** ——
行政在 UI 上沒有任何地方能選計費模式、挑價目表、填議定金額。

`billing-rules.md` 規則 1「計費模式是報名層級的選擇」＋規則 2「金額人工覆寫」的整條路
在後端是通的，只差前端。**A1 的價值目前沒有交付給使用者。**

### 4b. 費用方案管理頁（fee-templates）

`/api/fee-templates` 四個動詞都在，無分頁、形狀簡單、是純 CRUD ——
**不依賴 A2/A3 的任何東西**。做完它，4a 的「挑價目表」下拉才有東西可挑。
順序上 4b 應該在 4a 之前，或兩者一個切片一起做。

## 5. ⏳ 待 A2/A3 定案（現在只能當草稿）

`grep -rln 'invoices|payment_records|meal_records' supabase/migrations` **零命中** ——
A2/A3 確實還沒進 main，以下全部沒有可驗的形狀：

| 頁面 | 缺什麼 |
| --- | --- |
| 繳費紀錄 | `invoices` / `payment_records` 的 schema 與端點、開帳動作、收款 dialog、列印收費袋視圖 |
| 餐費管理 | `meal_records` 的每日名單端點、月結動作 |
| 營收報表 | **完全沒有任何聚合端點**。charter 坑 #4：列表 API 上限 100 筆，報表要總額只能靠 `meta.total` 或後端聚合 —— 抓單頁自己加會在量大的月份悄悄少算 |

## 6. 🔴 需計畫席裁決：finance specs 比 rules 舊半年，而且互相矛盾

| 文件 | updated |
| --- | --- |
| `kb/wiki/rules/billing-rules.md` | **2026-08-29**（訪談定案） |
| `kb/wiki/specs/admin/finance/payments.md` | 2026-03-17 |
| `fee-templates.md` / `meals.md` / `reports.md` | 2026-02-13 |

實際衝突（不是措辭差異，是相反的需求）：

| `payments.md` 寫的 | `billing-rules.md` 寫的 |
| --- | --- |
| 費用明細有「折扣/調整」欄 | 規則 2：**不做**結構化折扣，只有定價 + 人工覆寫 |
| 六種狀態：待付款/部分付款/已付款/逾期/失效/已取消/已退款 | 規則 4：狀態**由累計實收推導** —— 未繳/部分繳/繳清 |
| 「強制啟用功能」：未付清仍可強制啟用 enrollment | 規則 7：欠繳只做**可見性**，從未停課 → 沒有「擋住」就不需要「強制」 |
| 部分付款時選「本次欲啟用的課程項目」 | 規則 4：不做排程式分期計畫 |

charter 說「設計文件沒到手不要動工」。這裡是更麻煩的變體：**文件到手了但過期**，
照它做會做出訪談明確否定的功能。

→ 請計畫席裁決：(a) 由誰重寫 finance specs 對齊 rules、(b) 重寫前 admin-pages 是否
先做第 4 節那兩件不受影響的事。

## 7. 這次盤點順手記下的東西（已蒸餾進 charter 的除外）

- `apps/web/src/app/core/` 的 service 是**扁平檔案**（`students.service.ts` 等），沒有 `services/` 子目錄。新增 `fee-templates.service.ts` 照這個放。
- `mount()` 的第四個參數是 optional permission，忘了寫角色會**編譯不過**（gate 守著），但忘了寫 permission 不會。要判斷某支 API 需不需要權限，看 `index.ts` 的 mount 那一行，不要看 route 檔內部。
