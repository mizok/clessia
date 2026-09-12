---
title: 操作紀錄對話框（子頁面，6 頁共用）
summary: AuditLogDialogComponent 的 UI 地圖：唯讀操作紀錄表，由呼叫端指定要看哪些資源類型。
category: spec
status: developing
tags: [sitemap, _shared, admin]
created: 2026-09-12
updated: 2026-09-13
---

# 操作紀錄對話框（子頁面）

**元件**：`@shared/components/audit-log-dialog/audit-log-dialog.component`

**開啟點（6 頁）** —— 每一頁的入口都是右上角那顆「操作紀錄」：

| 頁面                   | 傳進去的 `resourceTypes`                         |
| ---------------------- | ------------------------------------------------ |
| `admin/campuses`       | `['campus']`                                     |
| `admin/courses`        | `['class', 'course']`                            |
| `admin/fee-templates`  | `['fee_template']`                               |
| `admin/leave`          | `['leave']`（`leave.page.ts:192`）               |
| `admin/payments`       | `['invoice', 'payment_record']`                  |
| `admin/staff`          | `['staff']`                                      |
| ~~`admin/attendance`~~ | `['attendance']` —— **元件已刪除（#698）**，見下 |

> ⚠️ **`admin/attendance` 曾經是個死的開啟點**：`/admin/attendance` 是純 `redirectTo`
> → `/admin/sessions`，而 `admin/pages/attendance/attendance.page.ts` 全庫無人 import。
> **2026-09-12 那支元件已刪除（#698）**，所以現在實際的開啟點是 **6 個**不是 7 個。
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

| 項目                                   | 原因                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **展開列**（`details` 的內容）         | 桌機寬度下這支對話框不產生展開鍵；要在窄寬度下才驗得到                                         |
| 載入中 / 錯誤                          | 沒有製造手段                                                                                   |
| ~~`admin/leave` 傳的 `resourceTypes`~~ | **已補**：`['leave']`（`leave.page.ts:192`），實測列出「請假X / 日期區間」+「新增」（labor-2） |
| 其餘 4 個入口                          | `campuses` / `staff` 在 labor-4 的後續批次，`courses` 已由 labor-1 驗過空狀態                  |

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

## 390px


> ⚠️ **2026-09-13 訂正：上面的對話框尺寸是在 ResizeObserver 失效的環境下量的。**
> `--shell-layout-body-height` 靠 `InheritSizeDirective` 的 ResizeObserver 寫入，
> 而**它在 MCP 的背景分頁 iframe 裡不觸發** —— 於是 `styles.scss:721-722` 的
> `max-height: calc(var(--shell-layout-body-height) - …)` 的 `calc()` 無效，
> **computed 值是 `none`，對話框不受限**。
>
> **真實瀏覽器裡對話框會被限制在 `shell body 高 − 24px`（本輪環境是 `700px`），
> 超出的部分由 `.p-dialog-content` 捲動。** 上面的高度數字要照這個重新讀：
> **矮於 700 的那些是真的，高於 700 的只會出現在這個量測環境裡。**
> 全文與正控見[方法頁](../README.md)的「ResizeObserver 在這個環境完全不觸發」。
- **量測**：390 × 844 與 1504 × 752（對話框只記「版面怎麼變」，不重抄元素表）
- **前端**：主 checkout 的 dev server（port 4200），`543e5eda`
- **手段**：同源 iframe 當 viewport；**開啟一律用 `element.click()`（合成事件，坑 6 的等級標記）**，
  關閉後用輪詢斷言消失（坑 9），疊層時比對**數量**不是 `=== null`

### ⚠️ 390 多出 12 顆展開鍵，1504 一顆都沒有

**這正好補上 labor-4 在 charter 裡留的那個洞**（「原始碼寫 `expandControlPosition="start"`，
而 1504 桌機一顆展開鍵都沒有」）——**換個寬度答案就相反**：

| | 390 × 844 | 1504 × 752 |
| --- | --- | --- |
| `.p-dialog` | `390 × 437 @0,204` | `800 × 445 @352,154` |
| 佔寬比 | `1.00` | `0.53` |
| **`responsive-table__expand-button`** | **12 顆**（`26 × 26`，**coarse 有**） | **0 顆** |
| 分頁器 | （未單獨量） | `第 1 / 2 頁`（compact 樣板） |
| 可見互動元素 | **15** | — |

機制是 `responsive-table` 的 `hasCollapsedColumns()`：390 寬的對話框塞不下四欄 → 收合 → 產生展開鍵；
800 寬塞得下 → 不收合 → 不產生。**這一支在兩個寬度是兩種互動模型。**

### ⚠️ 先換一個有資料的開啟點（坑 8）

**`/admin/courses` 的操作紀錄是空的**（畫面逐字：`操作紀錄 尚無操作紀錄`，可見互動元素只有 **3**）。
`select resource_type, count(*) from audit_logs group by 1` 查到本機 44 筆全部集中在
`invoice`(12) / `leave`(9) / `attendance`(8) / `staff`(6) / `session`(4) / `school_exam`(2) / `parent`(2) / `class_log`(1)
—— **`course` 是 0 筆**。

本節的數字改用 **`/admin/payments` 的操作紀錄**（12 筆）量。
**照 courses 那個開啟點量，會得到一張「這支對話框只有 3 個互動元素」的地圖，而兩向比對照樣 0 差異。**

### 水平溢出

**無** —— 內容區 390 下 `388 × 435`、1504 下 `798 × 443`，兩邊 `scrollWidth === clientWidth`。
**表格自己的收合（而不是橫向捲動）就是它不溢出的原因。**

### 觸控目標 < 44px

| 元素 | 量到 | coarse |
| --- | --- | --- |
| 關閉鈕 `.dialog-header-inline__close` | `32 × 32` | **無** |
| `responsive-table__expand-button` × 12（**只在 390**） | `26 × 26` | **有** |

### 關閉方式

`.dialog-header-inline__close`（`32 × 32`），**兩個寬度都在視窗內**。無 header 的 `×`。
**沒有 `aria-label`。**

### 未驗與原因

| 項目 | 原因 |
| --- | --- |
| 展開鍵按開之後的內容（390） | 本輪只量了它們存在與尺寸 |
| 390 的分頁器樣板 | 只在 1504 量到 compact 樣板（`第 1 / 2 頁`） |
| 768 / 1024 | 本輪沒補量 |

> **本輪四支對話框的共同形狀**：390 下**滿寬**（佔寬比 1.00）、**沒有一支是全螢幕**、
> 內容區**都沒有橫向溢出**、**都沒有 header 的 `×`**（`showHeader: false`，#714 確立的規則）。
> 差別在**高度**，而那是 #784 的成因。

## 載入中 / 錯誤

- **量測**：390 × 844 ／ 主 checkout 的 dev server（port 4200）`7e9da649`
- **手段**：同一個 XHR 包裝 —— 錯誤態把 URL 從 `:8787` 改指到沒人監聽的 `:8799`，
  載入中把 `send` 用 `setTimeout` 延後 3 秒（**只影響那一個 iframe，不動 8787、零寫入**）。
  方法全文見[方法頁 Phase 2-D](../README.md)
- **證據**：每一輪都確認攔截清單不是空的，**請求數 0 的一律作廢**（例外要自己附正控）

**開啟點**：多個 admin 頁的「操作紀錄」。本輪從 `/admin/courses` 開。

### 載入中（3 秒延遲）

| skeleton | spinner | 對話框內互動元素 | 判定 |
| --- | --- | --- | --- |
| **4**（`div.skeleton-list 356×220` + `span.skeleton-bar--label 142×16 op=0.6` + `span.skeleton-bar 356×16` ×2） | 0 | 1 | ✅ 誠實 |

延遲期間對話框只有標題「操作紀錄」與骨架。

⚠️ `animation-name: skeleton-wave` —— 看得見，波紋不動（坑 12）。

### 錯誤（API 失敗）

| 判定 | 重試鈕 | toast | 攔到的請求數 |
| --- | --- | --- | --- |
| 🔴 **謊稱沒資料，而且零訊號** | 否 | **0** | 1 |

對話框逐字「**操作紀錄／尚無操作紀錄**」，**沒有 toast、沒有任何失敗字樣**。

機制（`audit-log-dialog.component.ts:166-168`）：

```ts
error: () => {
  this.loading.set(false);
},
```

**沒有 failed 旗標、沒有 toast** → 模板從「載入中」直接落到「空」。

> 本機 `select count(*) from audit_logs` = **44**。
>
> **`_shared/subject-manager` 的錯誤分支一字不差**（`subject-manager.component.ts:80-86`）——
> **同一個寫法在兩支獨立的共用元件裡各長了一次**，所以它是 pattern 不是個案。
> 方法頁已收（[方法頁](../README.md)「空的錯誤處理是一個 pattern」）。

### 未驗與原因

| 項目 | 原因 |
| --- | --- |
| 重試 | **沒有重試鈕、沒有任何失敗訊號** |
| 分頁在錯誤態下的樣子 | 清單是空的，分頁器沒有出現 |
