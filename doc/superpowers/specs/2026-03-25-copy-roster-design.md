# 從既有班級複製名單 Design Spec

**Date:** 2026-03-25
**Feature:** Copy Roster from Existing Class
**Status:** Approved

---

## Goal

在班級詳情頁新增「從既有班級複製名單」功能，讓管理者快速將另一個班級的學生批次加入當前班級，無需逐一搜尋學生。

---

## Architecture

新增 `CopyRosterDialogComponent`（standalone），從班級詳情頁兩個入口觸發：空班 empty state 和有學生時的 list header。後端新增 `POST /classes/:classId/copy-roster` 路由，邏輯層處理去重和批次建立 enrollments。

---

## UI Flow

### 入口

- **空班 empty state**：在現有「Excel 匯入」與「加入第一位學生」按鈕旁，新增「複製名單」按鈕
- **有學生時 list header**：在現有「Excel 匯入」與「加入學生」按鈕旁，新增「複製名單」按鈕

### 對話框（3 步驟）

**Step 1 — 選來源班級**

- 標題：「從既有班級複製名單」
- 使用 `p-select`（可搜尋）列出同組織下所有其他班級
  - 排除當前班級自身
  - **包含**已歸檔班級（`end_date` 早於今日），因為從舊班複製到新班是核心使用情境
  - 每筆選項顯示：班級名稱 + 所屬課程名稱；已結束的班級加上「已結束」視覺標示（灰色 tag）
- 選好後**立即 fetch 該班級的 enrollments**，進入 Step 2

**Step 2 — 篩選學生狀態**

- 標題：「選擇要複製的學生狀態」
- Step 1 選完班級後立即 fetch 來源班級的 enrollments（一次性），結果 cache 在 component signal 中
- Step 1 選完班級後立即呼叫 `GET /api/enrollments?classId=<sourceClassId>&pageSize=100`，取得完整名單（後端 pageSize 上限為 100，補習班班級規模不會超過此上限），結果 cache 於 component signal
- 勾選框列表（可複選），使用 `ENROLLMENT_STATUS_LABELS` 顯示中文名稱：
  - `active`（在籍）— 預設勾選
  - `pending_payment`（待付款）— 預設勾選
  - `suspended`（暫停）
  - `withdrawal`（退班）
  - `void`（失效）
- 勾選變更時 **client-side re-filter**（不重新 fetch），即時更新：「共 N 位學生將被複製」
- 至少需勾選一個狀態才能繼續

**Step 3 — 執行結果**

- 點擊「複製」後呼叫 API，顯示 spinner
- 完成後顯示摘要：
  - ✅ 成功加入 N 位學生
  - ⚠️ N 位學生已在本班，已略過（僅在 skipped > 0 時顯示）
- 若收到 `OVER_QUOTA` 錯誤：顯示 inline error notice（不關閉對話框），說明人數已達上限，讓使用者縮減篩選範圍後重試
- 「完成」按鈕關閉對話框並刷新名單

---

## API

### `POST /api/enrollments/copy-from-class`

**路由檔案：** `apps/api/src/routes/enrollments.ts`（與 batch create 路由同檔，掛載於 `/api/enrollments`）

**Authorization:** `requireAdminMiddleware`（定義於 `apps/api/src/middleware/auth.ts`，已在 parents.ts 中使用相同模式，透過 `middleware: [requireAdminMiddleware] as const` 掛載於 `createRoute()`）

**Request body:**
```json
{
  "targetClassId": "uuid",
  "sourceClassId": "uuid",
  "statuses": ["active", "pending_payment"]
}
```

- `statuses` 必須是 `EnrollmentStatus` enum 的子集，使用 `z.array(z.enum(['pending_payment', 'active', 'suspended', 'withdrawal', 'void'])).min(1)` 驗證

**Response（200）:**
```json
{
  "copied": 12,
  "skipped": 3
}
```

**Backend Logic:**

1. 驗證 `targetClassId` 與 `sourceClassId` 都存在且屬同一 org（`org_id` 過濾）
2. 驗證 `sourceClassId !== targetClassId`
3. 查出 source class 中符合 `statuses` 的 enrollments（取 `student_id`）
4. 查出目標班級中「有效在班」的 student_ids：status IN (`active`, `pending_payment`, `suspended`)
   - **去重規則**：只有在目標班有 `active` / `pending_payment` / `suspended` enrollment 的學生才視為「已在本班」而跳過。若學生在目標班的 enrollment 是 `withdrawal` 或 `void`，允許重新加入（`skipped` 不計入）
5. 計算人數上限：
   - `currentActiveCount` = 目標班級中 status IN (`active`, `pending_payment`) 的數量（與 `POST /enrollments/batch` 一致，不含 `suspended`）
   - 若 `(currentActiveCount + toInsert.length) > maxStudents`，回傳 `400 OVER_QUOTA`
6. Batch insert enrollments：
   - `status = 'active'`
   - `effective_from` 由應用層傳入今日日期字串（`new Date().toISOString().slice(0, 10)`），與 `POST /enrollments/batch` 現有做法一致
   - `org_id`、`class_id`、`created_by` 自動填入
7. 回傳 `{ copied, skipped }`

**Error cases:**
- `404` — `targetClassId` 或 `sourceClassId` 不存在 / 不屬本 org
- `400` — `sourceClassId === targetClassId`
- `400 OVER_QUOTA` — 超過人數上限
- `400` — `statuses` 陣列為空或含非法值

---

## Frontend Service

在 `EnrollmentsService` 新增：

```typescript
copyFromClass(
  targetClassId: string,
  sourceClassId: string,
  statuses: EnrollmentStatus[]
): Observable<{ copied: number; skipped: number }>
```

（方法名與 API 路徑 `copy-from-class` 對齊）

---

## Data Constraints

- **「已在本班」定義**：目標班級中 status IN (`active`, `pending_payment`, `suspended`) 的 enrollment。status 為 `withdrawal` / `void` 的學生可被重新加入。
- 新 enrollment 的 `status` 固定為 `active`
- `effective_from` 由應用層傳入今日日期字串（`new Date().toISOString().slice(0, 10)`），與現有 `POST /enrollments/batch` 做法一致
- 不複製 `paymentCycle`、`notes`、`effectiveTo` 等欄位

---

## Out of Scope

- 不支援跨組織複製
- 不提供「部分選擇學生」的細粒度選擇（篩選以狀態為單位）
- 不複製出缺席紀錄或其他關聯資料
- 不限制來源班級是否已結束（歸檔班級可作為來源）
