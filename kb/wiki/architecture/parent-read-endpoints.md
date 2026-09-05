---
title: 家長端三支讀取端點（出缺席／成績／繳費）
summary: 家長端 P4 主體的 API 側設計。三支 GET-only 端點複用既有 admin 查詢邏輯（attendance.ts / scores.ts / invoices.ts 的 select 常數與 mapper），走 childDb + 顯式 childId 查詢參數（403 不回空），欄位過濾表逐支列出，錨點聚合數字放進各自 meta 不另開 dashboard 端點。等 STOP 批准。
category: architecture
status: draft
updated: 2026-09-05
tags: [architecture, parent, authorization, attendance, grades, billing]
---

# 家長端三支讀取端點（出缺席／成績／繳費）

> **這份文件要計畫席批准才能動工。** 它是 [[architecture/parent-data-scope]] 授權模型的
> 第一批真實消費端，也是 P4 家長端（[[roadmap]] 標「目前 0%」）的主體，順序照 roadmap
> 建議：出缺席 → 繳費 → 成績（前兩個是家長真的會打電話問的事）。

## 前提裁決（計畫席已定案，這裡只是落地）

1. **scope 從 `activeChildId` 來**——前端 `ChildScopeService`（#344）管理的「目前在看哪個
   孩子」，不是一次回所有孩子混在一起。
2. **欄位過濾照 #295 的窗口三決**：成績遮班級排名、繳費遮內部備註，家長端點**只回該回
   的欄位**——不整包回傳再靠前端不顯示（那是 c1 的違反例形狀）。
3. **錨點聚合數字放各自端點的 `meta`**，不另開 dashboard 聚合端點——頁面本來就要拉列表，
   零額外往返，scope 過濾天然在後端。理由跟 `workbench.ts` 刻意不做「全部資料端點」
   一樣（`workbench.ts` 檔頭：兩套取數會各長一份，其中一份會忘記更新）。

## 為什麼是「複用」不是「新寫」

`parent-data-scope.md` 已經拒絕過「給家長一組獨立的唯讀端點，不共用 admin 的」——這個
codebase 已經為此收斂過三組（點名、成績鍵盤、匯入解析），兩份會分岔。三支端點的資料
形狀 admin 端都已經有完整實作：

| 家長端點 | 複用 admin 的哪一段                                                           | 檔案                   |
| -------- | ----------------------------------------------------------------------------- | ---------------------- |
| 出缺席   | `GET /api/attendance` 的 select 字串 + `toAttendanceResponse()`               | `routes/attendance.ts` |
| 成績     | `GET /api/scores` 的 academy/school 合併查詢邏輯                              | `routes/scores.ts`     |
| 繳費     | `INVOICE_SELECT` + `toInvoiceResponse()`（含 `lib/invoice-status.ts` 的推導） | `routes/invoices.ts`   |

**做法是匯出這些常數/函式給家長端 route 呼叫，換掉查詢用的 client（`supabase` → `childDb`），
不是照抄一份查詢邏輯。** `toAttendanceResponse` 已經是 exported；`toInvoiceResponse` 已經是
exported；`INVOICE_SELECT` 目前是 module-scope const，這支要把它也 export 出來。

## 一、scope 機制：顯式 `childId`，不是 middleware 猜

跟 `campusRequestGuard`的「檢查」形狀不同——那支處理的是「有沒有指名，指名了就查範圍內
合不合法」，這裡**一定要指名**（decision ①：一次只看一個孩子），所以：

- 三支端點的 query schema 都是 **`childId: DbUuidSchema`（必填，不是 optional）**。
  漏帶直接是 zod 400，不必額外寫「沒帶則怎樣」的分支。
- 新增 `isChildAllowed(scope: StudentScope, childId: string): boolean`（`lib/child-scope.ts`）：

  ```ts
  export function isChildAllowed(scope: StudentScope, childId: string): boolean {
    return scope !== null && scope.includes(childId);
  }
  ```

  **跟 `isCampusAllowed`刻意不同**：後者對「不受限」的人（`scope === null`）一律放行，
  因為那個語意是「這個角色沒有分校限制」。這裡的 `scope === null` 代表「這個人根本不是
  家長」——對家長端點來說那是異常狀態，**fail-closed 回 false**，不是「不受限」。

- 三支 route 開頭都是：

  ```ts
  const { childId, ...rest } = c.req.valid('query');
  if (!isChildAllowed(c.get('studentScope'), childId)) {
    return c.json({ error: '沒有這個孩子的權限', code: 'CHILD_OUT_OF_SCOPE' }, 403);
  }
  ```

  **403 不回空**，跟 `parent-data-scope.md` 第三節、`campusRequestGuard` 同一個判準：
  越權指名要讓越權的人知道自己被擋，不是看到一個「這個孩子沒有資料」的空清單。

## 二、三支端點各自的形狀

全部 **GET-only**（parent-data-scope.md 已明確不做家長端寫入），全部掛在既有的
`/api/me` 之下（跟 `GET /api/me/children` 同一支 mount，ANY_ROLE，各自 handler 內
再檢查 `roles.includes('parent')`，形狀照抄 `routes/parent/children.ts`）。

新檔案位置：`routes/parent/attendance.ts`、`routes/parent/grades.ts`、
`routes/parent/billing.ts`——落在 A19 gate 的守備範圍內，`c.get('childDb')`，不用
`c.get('supabase')`。

### `GET /api/me/attendance?childId=&dateFrom=&dateTo=&page=&pageSize=`

- 複用 `attendance.ts` 的 select（`students!inner(name)` 這段拿掉，因為 childDb 已經
  限定單一學生，不需要再撈名字回來確認身分）與 `toAttendanceResponse()`。
- **欄位過濾**：目前找不到需要遮的欄位——`note` 是點名當下記的觀察（例如請假原因），
  對家長是有意義的資訊。**但 `recordedBy` / `recordedByRole` 建議拿掉**：前者是
  `ba_user.id` 的原始字串（不是姓名，對家長是無意義的亂碼），後者是內部角色標記。
  這條不在窗口三決裡，**列成待計畫席確認的一條**，不是我自己拍板。
- **meta**：`{ total, page, pageSize, monthlyAbsentCount }`——`monthlyAbsentCount` 是
  這個孩子本月（自然月，`getCurrentTaipeiDateString()` 算月初到今天）`status` 為
  `absent` 或 `on_leave` 的筆數。**用一支獨立的 `count: 'exact'` 查詢算，不是撈當頁
  自己數**——分頁截斷會讓「當頁自己數」在資料量大時悄悄變小（billing-api 席前一次
  帳單分頁事故的同型坑）。

### `GET /api/me/grades?childId=&dateFrom=&dateTo=&page=&pageSize=`

- 複用 `scores.ts` 的 `listRoute` handler 邏輯（academy + school 合併、`ScoreRecordSchema`
  形狀），把 `readableStudentIds`（老師範圍）那段換成 `isChildAllowed` 檢查。
- **欄位過濾**：`ScoreRecordSchema` 本來就沒有排名欄位——「遮班級排名」在這支端點是
  **靠只查單一學生做到的，不是靠事後刪欄位**。這是这個決定唯一乾淨的做法：管理端的
  「班級排名」活在 `class-scores-dialog`（撈全班分數，前端排序顯示名次），那個查詢
  **完全不會被這支端點呼叫**，排名沒有東西可以外洩。
- **meta**：`{ total, page, pageSize, recentCount }`——`recentCount` 是過去 7 天內
  `created_at` 落在區間內的成績筆數（academy_scores / school_scores 各自的
  `created_at`，登錄成績那一刻算「新」，不是考試日期）。跟出缺席一樣用獨立查詢算，
  不靠當頁筆數。

### `GET /api/me/billing?childId=&page=&pageSize=`

- 複用 `invoices.ts` 的簡單分頁分支（**不含 `overdue`/`status` 那個推導式分頁**——
  家長端 v1 不需要那兩個篩選，維持 DB 分頁最簡單）、`INVOICE_SELECT`（需要 export）
  與 `toInvoiceResponse()`。
- **欄位過濾（窗口已定案：遮內部備註）**：回應在 `toInvoiceResponse()` 的結果上再過
  一層映射，**明確列出保留的欄位**（allowlist，不是 denylist——欄位改名或新增時
  allowlist 會讓新欄位預設不外流，denylist 會預設外流）：

  ```ts
  function toParentInvoice(invoice: ReturnType<typeof toInvoiceResponse>) {
    return {
      id: invoice.id,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      status: invoice.status,
      total: invoice.total,
      netPaid: invoice.netPaid,
      items: invoice.items.map((item) => ({
        id: item.id,
        type: item.type,
        amount: item.amount,
        periodMonth: item.periodMonth,
        // note 不回：內部備註（例如「家長來電抱怨」「特殊減免原因」）
      })),
      payments: invoice.payments.map((payment) => ({
        id: payment.id,
        kind: payment.kind,
        amount: payment.amount,
        method: payment.method,
        paidAt: payment.paidAt,
        receiptNo: payment.receiptNo,
        // note 不回；recordedBy 不回（内部經手人，跟出缺席那條同一個判準）
      })),
      createdAt: invoice.createdAt,
    };
  }
  ```

  `proofPath`（收款憑證檔案路徑）**這輪也不回**——那是給行政內部核對用的檔案路徑，
  家長端 v1 沒有檔案下載的 UI，回一個打不開的路徑沒有意義；要開放的話是另一個決定
  （牽涉檔案存取授權，不是欄位過濾能解決的）。

- **meta**：`{ total, page, pageSize, totalDue }`——`totalDue` 是這個孩子**全部**帳單
  （不分頁）裡 `status !== 'paid'` 的 `(total - netPaid)` 加總。跟前兩支一樣獨立算，
  理由相同：分頁截斷不能拿來算總額。

## 三、跟 `parent-data-scope.md` 的既有機制對齊

- `childDb.from(table, studentIdColumn)` 的 `studentIdColumn` 三支各自是：
  `attendance_records.student_id`、`academy_scores.student_id` / `school_scores.student_id`、
  `invoices.student_id`。都已經是 `childDb` 現有 API 涵蓋的形狀，不用擴充 `child-db.ts`。
- `childId` 通過 `isChildAllowed` 之後，還要不要再疊一層 `.eq('student_id', childId)`？
  **要**——`childDb` 的 `.in(idColumn, scope)` 只保證「這個家長全部孩子的範圍內」，
  一個家長有兩個孩子時，`scope = [c1, c2]`，沒有 `.eq('student_id', childId)` 的話
  `GET /api/me/attendance?childId=c1` 會連 `c2` 的資料一起撈回來。**兩層都要**：
  `isChildAllowed` 擋越權指名（403），`.eq()` 縮小到「這一次要看的那一個」。

## 明確不做（這輪）

- **家長端的寫入**——請假申請、繳費、成績疑問回報，都是 v1 之後的事（parent-data-scope.md
  已經講過一次，這裡重申範圍）
- **`recordedBy`/`recordedByRole` 要不要遮**——上面標成待確認，不是我自己拍板
- **未開票週期的「應繳」預估**——`totalDue` 只算已經開出來的帳單，不含尚未開票但
  已經報名、理論上會產生費用的週期。這是「billed vs. accrued」的差別，算 accrued
  需要另外推導邏輯（比照 `invoice-status.ts` 的模式但輸入不同），是獨立的一塊
- **v1b 教務日誌讀取**（家長讀已發布的 `class_logs`）——同一條 `childDb` 線，
  但排在 teacher-pages 的 P3 設計過 STOP 之後，這份文件先不展開它的欄位清單
  （教學紀錄內部欄不回，作業欄回，形狀跟這裡一致，等 teacher-pages 定案再補一節）
