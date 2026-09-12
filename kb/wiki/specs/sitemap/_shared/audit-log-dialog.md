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
- 表格：`操作者` / `時間` / `對象` / `動作`
  - `對象` = 資源類型標籤 + 資源名稱（**實測 `invoice` 的名稱是空的，顯示成 `帳單—`**）
  - `動作` 是一顆 data chip；有變更摘要時底下多一行小字
- **「展開詳細資訊」不是每列都有** —— 它由 `app-responsive-table` 的
  `hasCollapsedColumns()` 決定，**只有欄位被寬度擠掉時才出現**。這四欄的
  min-width 合計 640px，對話框 800px 寬的內容區塞得下，**所以桌機寬度下一顆都沒有**
  （`/admin/payments` 實測：`tbody` 裡 0 顆按鈕）
- 分頁器：每頁 10 筆，`alwaysShow: false`（只有一頁時不出現）。
  **呼叫端設定的樣板 `顯示 {first} - {last}，共 {totalRecords} 筆` 在這支對話框裡看不到** ——
  `responsive-table` 在容器寬度 ≤ 768px 時切成 compact 分頁器，**改用 `第 N / M 頁`
  並藏掉頁碼與首末頁鍵**，而 800px 寬的對話框其表格容器正好落在那個門檻內
  （`/admin/payments` 實測顯示 `第 1 / 2 頁`）
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
| 展開詳細資訊       | 按鈕   | **只有欄位被寬度擠掉時**（桌機 1504px 下沒有）  | 展開該列的 `details` |
| 分頁器             | 按鈕組 | **紀錄超過 10 筆才出現**（`alwaysShow: false`） | 換頁，重新取數       |
| 關閉               | 按鈕   | 永遠                                            | 關閉對話框           |

**整支唯讀，沒有任何寫入動作。**

## 狀態

| 狀態          | 畫面                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 空            | **`尚無操作紀錄`**（實測兩處：`/admin/courses` 的 `['class','course']`、`/admin/fee-templates` 的 `['fee_template']`） |
| 有資料        | 表格 + （超過 10 筆時）compact 分頁器（**已實測**：`/admin/payments`，12 筆分 2 頁）                                   |
| 載入中 / 錯誤 | **未驗**                                                                                                               |

## 驗證紀錄

- **日期**：2026-09-12 ／ 帳號 `admin@demo.clessia.app` ／ 前端 `c1535d04`（port 4201）
- **開啟路徑**：`/admin/courses` 右上「操作紀錄」
- **實測結果**：空狀態，對話框只有標題、`尚無操作紀錄` 與一顆關閉鈕

### 兩向比對（空狀態）

對話框內 DOM 互動元素 **1** 個（關閉），地圖在空狀態下也只列得出這一個。**差異：0 筆。**

### 未驗到的

| 項目                               | 原因                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| **展開列**（`details` 的內容）     | 桌機寬度下這支對話框不產生展開鍵；要在窄寬度下才驗得到                        |
| 載入中 / 錯誤                      | 沒有製造手段                                                                  |
| `admin/leave` 傳的 `resourceTypes` | 那一頁還沒輪到（在 ADMIN_STUDENT_AFFAIRS 批次裡）                             |
| 其餘 4 個入口                      | `campuses` / `staff` 在 labor-4 的後續批次，`courses` 已由 labor-1 驗過空狀態 |

## 補驗紀錄（labor-4，2026-09-12）

上一版留了一句「這一頁的欄位清單有一半是讀原始碼得到的」。**在 `/admin/payments`
（`['invoice','payment_record']`，本機 12 筆）補驗，四欄與分頁都對得上，但兩處讀原始碼
推出來的結論是錯的**，已改在上面：

1. **「每列可展開詳細資訊」** —— 那顆按鈕在桌機寬度下**不存在**。它由 responsive-table
   的欄位收合狀態決定，不是每列都有。
2. **分頁器的字** —— 呼叫端設定的樣板在這支對話框裡**永遠不會出現**，因為容器寬度
   踩在 compact 門檻（≤ 768px）底下。

**兩個都是「元件原始碼寫了什麼」與「使用者看到什麼」之間隔著一層版面計算的例子。**

- **前端版本**：port 4202（本 worktree，`f579dada` = `origin/main` `897d691f` + 文件）
- **帳號**：`admin@demo.clessia.app` ／ **寬度**：1504 CSS px
- ⚠️ 補驗過程中 session 被別席的 parent 登入換掉，第 2 頁的請求回 **403** ——
  **畫面沒有任何提示**：對話框保留第 1 頁的內容、分頁器卻已經跳到「第 2 / 2 頁」。
  重新登入後同樣的操作是正常的（10 + 2 筆、不重複）。**那不是分頁 bug，是我的 session 沒了。**
