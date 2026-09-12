---
title: 操作紀錄對話框（子頁面，7 頁共用）
summary: AuditLogDialogComponent 的 UI 地圖：唯讀操作紀錄表，由呼叫端指定要看哪些資源類型。
category: spec
status: developing
tags: [sitemap, _shared, admin]
created: 2026-09-12
updated: 2026-09-12
---

# 操作紀錄對話框（子頁面）

**元件**：`@shared/components/audit-log-dialog/audit-log-dialog.component`

**開啟點（7 頁）** —— 每一頁的入口都是右上角那顆「操作紀錄」：

| 頁面                   | 傳進去的 `resourceTypes`                   |
| ---------------------- | ------------------------------------------ |
| `admin/campuses`       | `['campus']`                               |
| `admin/courses`        | `['class', 'course']`                      |
| `admin/fee-templates`  | `['fee_template']`                         |
| `admin/leave`          | （未查）                                   |
| `admin/payments`       | `['invoice', 'payment_record']`            |
| `admin/staff`          | `['staff']`                                |
| ~~`admin/attendance`~~ | `['attendance']` —— **那一頁接不到，見下** |

> ⚠️ **`admin/attendance` 是死的開啟點**：`/admin/attendance` 這條路由在 `app.routes.ts`
> 是純 `redirectTo` → `/admin/sessions`，而 `admin/pages/attendance/attendance.page.ts`
> **全庫沒有任何地方 import 它**。所以那個開啟點永遠不會被走到。
> 詳見 [[specs/sitemap/admin/attendance]]。

> ⚠️ **不要跟 `/admin/sessions` 的「操作紀錄」混在一起** —— 那一顆開的是
> `SessionOperationsLogDialogComponent`（自己有課堂異動／出勤紀錄兩個分頁），
> **是不同的元件**，只是按鈕的字一樣。見 [[specs/sitemap/admin/sessions]]。

## 畫面區塊

- 標題：`操作紀錄`
- 表格：`操作者` / `時間` / `對象` / `動作`，每列可「展開詳細資訊」
- 分頁器：每頁 10 筆，樣板 `顯示 {first} - {last}，共 {totalRecords} 筆`；
  **`alwaysShow: false`，所以只有一頁時不出現**
- 關閉鈕

資料來源：`GET /api/audit-logs?resourceTypes=<呼叫端指定>&page=1&pageSize=10`

## 動作標籤是對照表，不是原始值

`ACTION_MAP`（`audit-log-dialog.component.ts:19-` ）把動作代碼翻成中文，實際有 20+ 種，例如：

`create`→新增、`update`→編輯、`delete`→刪除、`batch_update_attendance`→批次點名、
`sync_leave_to_attendance`→套用請假、`generate_sessions`→建立課堂、`archive`→封存…

**對不上的代碼會原樣顯示**（`ACTION_MAP[action] ?? { label: action }`）——
所以畫面上看到英文代碼，意思是後端新增了一種動作而這張表沒跟上。

## 互動元素

| 元素（畫面上的字） | 類型   | 出現條件                                        | 按了之後             |
| ------------------ | ------ | ----------------------------------------------- | -------------------- |
| 展開詳細資訊       | 按鈕   | 每一列一顆                                      | 展開該列的 `details` |
| 分頁器             | 按鈕組 | **紀錄超過 10 筆才出現**（`alwaysShow: false`） | 換頁，重新取數       |
| 關閉               | 按鈕   | 永遠                                            | 關閉對話框           |

**整支唯讀，沒有任何寫入動作。**

## 狀態

| 狀態          | 畫面                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| 空            | **`尚無操作紀錄`**（實測：`/admin/courses` 的 `['class','course']` 目前是空的） |
| 有資料        | 表格 + （超過 10 筆時）分頁器                                                   |
| 載入中 / 錯誤 | **未驗**                                                                        |

## 驗證紀錄

- **日期**：2026-09-12 ／ 帳號 `admin@demo.clessia.app` ／ 前端 `c1535d04`（port 4201）
- **開啟路徑**：`/admin/courses` 右上「操作紀錄」
- **實測結果**：空狀態，對話框只有標題、`尚無操作紀錄` 與一顆關閉鈕

### 兩向比對（空狀態）

對話框內 DOM 互動元素 **1** 個（關閉），地圖在空狀態下也只列得出這一個。**差異：0 筆。**

### 未驗到的

| 項目                               | 原因                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **有資料時的表格與展開列**         | courses 這個入口目前零筆。**其他 6 個入口沒有實地開過** —— 欄位與「展開詳細資訊」是從元件原始碼讀的，不是量到的 |
| 分頁器                             | 需要 > 10 筆                                                                                                    |
| 載入中 / 錯誤                      | 沒有製造手段                                                                                                    |
| `admin/leave` 傳的 `resourceTypes` | 那一頁還沒輪到（在 ADMIN_STUDENT_AFFAIRS 批次裡）                                                               |

> **這一頁的欄位清單有一半是讀原始碼得到的，不是實測的。** 標在這裡是因為
> 「表格有這四欄」讀起來跟量過的事實一模一樣 —— 下一個開到有資料入口的人請回來補驗。
