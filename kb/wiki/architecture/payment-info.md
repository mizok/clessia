---
title: 補習班帳戶資訊（payment_info）：機構預設＋分校覆寫
summary: organizations.payment_info（機構預設）＋ campuses.payment_info（分校覆寫，null＝沿用），形狀照 attendance_mode（#1112）。管理端系統設定與分校表單各一個多行欄位，改它要 manage_finance（改帳號＝改錢流向）。家長帳單列表 meta.paymentInfo 回這個孩子在籍分校的生效值（去重，多分校就多筆），沒有在籍分校退機構預設，全空時前端顯示原本的「請洽行政人員」。不做每張帳單各自判分校（帳單沒有分校欄，餐費／調整列沒有報名）。
category: architecture
status: developing
updated: 2026-10-03
tags: [architecture, billing, parent, settings, migration]
---

# 補習班帳戶資訊（#1073）

> 計畫席裁（10-03 12:3x，使用者授權）：照 `attendance_mode` 的形狀 —— 機構預設＋分校覆寫，
> 家長待付款頁顯示該孩子在籍分校的值。這頁記**怎麼接**與**要裁的兩點**。

## 決策

1. **Schema**（一支 migration，純加欄，部署前後套都安全）：
   - `organizations.payment_info text NULL` —— null＝還沒設定
   - `campuses.payment_info text NULL` —— null＝沿用機構預設（跟 `campuses.attendance_mode` 同語意）
   - 不加長度 CHECK；API 端 Zod 限 1000 字。
2. **生效值**：`campus.payment_info ?? org.payment_info`，空字串視同 null（清空＝改回沿用）。
   純函式 `pickPaymentInfo` 放 `lib/`，跟 `pickAttendanceMode` 並排。
3. **管理端**：
   - `GET/PATCH /api/org-settings` 加 `paymentInfo`；`GET/PATCH /api/campuses/:id` 加 `paymentInfo`（nullable）。
   - **改它要 `manage_finance`**（機構與分校都是）。⚖️ **要裁 1**：attendance_mode 用的是
     `manage_org_settings`；帳戶資訊我傾向歸財務 —— 改帳號等於改家長匯款的去向，
     是詐騙面最大的一個欄位。讀取不擋（它本來就要給家長看）。
   - Web：系統設定頁一個 textarea；分校表單一個 textarea（留白＝沿用機構預設，placeholder 顯示機構值）。
4. **家長端**：`GET /api/me/billing` 的 `meta.paymentInfo: { campusName: string | null; text: string }[]`。
   - 這個孩子**在籍**（active／pending_payment）報名的班 → 分校 → 生效值；**以 text 去重**
     （兩個分校都沿用機構預設 → 一筆，`campusName: null`）。
   - 沒有在籍報名 → 機構預設一筆；機構也沒設 → `[]`，前端照舊顯示「請洽補習班行政人員」。
   - 讀法：`childDb.pluck` 拿班 → `orgRef('classes')` 拿 campus_id → `orgRef('campuses')`（白名單加
     `campuses`，只讀）＋ 新的窄方法 `childDb.orgPaymentInfo()`（`organizations` 沒有 `org_id` 欄，
     不能走 `orgRef`；只回這一欄，不開整張機構設定給家長）。
   - ⚖️ **要裁 2**：放在**列表 meta 一份**，不是每張帳單各一份。帳單表沒有分校欄，餐費／調整列沒有報名，
     「這張帳單屬於哪個分校」判不出來；而補習班的帳戶本來就是跟著分校走、不是跟著帳單走。
     跨分校的孩子會看到多筆（標分校名）。
5. 前端待付款區：有值就列（`white-space: pre-line` 保留換行），多筆時每筆標分校名。

## 拒絕的替代方案

- **每張帳單各自判分校**：要 items → enrollments → classes 三層 join，且餐費／調整列判不出來，
  還得處理「一張帳單跨兩個分校」。帳戶跟著分校走，列表層級一份就夠。
- **結構化欄位（銀行代碼／帳號／戶名）**：使用者裁「多行欄位」；補習班的付款說明形形色色
  （多個帳戶、LINE Pay、現金時段），結構化反而塞不下。
- **家長端讀整份 org-settings**：會把財務設定（`invoice_due_days` 等）一起開給家長，窄方法只回一欄。

## 影響

- `supabase/migrations/<新>_payment_info.sql`
- `apps/api/src/routes/org-settings.ts`、`campuses.ts`、`parent/billing.ts`、`lib/child-db.ts`、`lib/`（pickPaymentInfo）
- `apps/web/.../admin/pages/settings/*`、`admin/pages/campuses/campus-form-dialog.*`、
  `parent/pages/payments/*`、對應 service
- `kb/wiki/specs/parent/payments.md`（補習班帳戶資訊 → 已實作）、`specs/admin/system/*`、
  `architecture/parent-data-scope.md` 二之一（白名單＋窄方法）
