# 批次加入學生 & 無痕移除 Design Spec

> 討論日期：2026-03-20
> 狀態：設計完成，待實作

---

## 背景與動機

目前班級詳情頁一次只能加入一個學生（單選 Dialog）。管理員在開學期間需要一次加入多人，逐一操作效率低。

另一個問題：enrollment 一旦建立，唯一的移除方式是「退班」（status → `withdrawal`），此操作會永久留下紀錄。對於「加錯人、立即發現」這種純操作失誤，退班語意不符，且會污染出勤與歷史紀錄。

---

## 功能一：批次加入學生

### 入口

班級詳情頁學生名單區塊的「加入學生」按鈕（現有按鈕行為升級，不新增按鈕）。

### UX 流程

`StudentPickerDialog` 升級為兩步驟 wizard，步驟狀態用 `step: 'selecting' | 'reviewing'` signal 管理。

**Step 1 — 選擇**

- 每個學生 row 左側加 checkbox，點整行可切換勾選
- 已在班學生繼續過濾（現有 `existingStudentIds` 邏輯不變）
- Footer：「已選 N 人」tag（N = 0 時 disabled）＋「下一步 →」按鈕

**Step 2 — 預覽確認**

- 列出即將加入的學生（姓名、年級）
- 每筆右側有 ✕，可從清單移除（同步更新 Step 1 的勾選狀態，確保來回切換時一致）
- Footer：「← 上一步」＋「確認加入 N 人」按鈕
- 確認後 dialog 原地顯示 loading spinner，API 回應後才關閉

**完成後**

Dialog 回傳 `enrolledStudentIds[]`，class-detail page 重新載入學生名單，並以 toast 顯示摘要：

> 「成功加入 3 人，1 人已在班（略過）」

**人數上限處理（在 Step 2 預覽階段攔截）：**

Step 2 計算：`剩餘名額 = maxStudents - 目前 active 人數`。

若「已選人數 > 剩餘名額」：
- Step 2 頂部顯示 inline error：「班級剩餘 N 個名額，已選 M 人，請移除 (M-N) 人」
- 「確認加入」按鈕 disabled，直到已選人數 ≤ 剩餘名額
- 使用者自行從預覽名單中 ✕ 移除，直到符合額度

`maxStudents` 從 class-detail page 傳入 dialog config.data。

### API — `POST /api/enrollments/batch`

```
Request body:
{
  classId: string (uuid)
  studentIds: string[] (uuid[])
}

Response 200:
{
  results: Array<{
    studentId: string
    status: 'enrolled' | 'already_exists' | 'error'
    enrollmentId?: string   // status = 'enrolled' 時
    message?: string        // status = 'error' 時
  }>
}
```

**後端行為：**
- 前置驗證：查 `classId` 目前 active 人數，若 `active_count + studentIds.length > maxStudents`，整批回傳 `{ error: 'over_quota' }`（前端應已攔截，此為安全二次驗證）
- 逐一建立 enrollment（status 預設 `active`）
- 任一筆失敗不 rollback 其餘（部分成功為合理結果）
- `already_exists`：`enrollments` 表中已有相同 `classId + studentId` 且 status 不為 `withdrawal` / `void`（與 DB 的 partial unique index 語意一致）。`withdrawal` 或 `void` 的學生可重新加入。
- 回傳每筆結果，讓前端顯示正確摘要

---

## 功能二：無痕移除（Hard Delete）

### 業務規則

Enrollment 有無出勤紀錄，決定可執行的移除方式：

| 條件 | 操作 | 說明 |
|------|------|------|
| 出勤次數 = 0 | **移除**（hard delete） | 純操作失誤，不留紀錄 |
| 出勤次數 ≥ 1 | **退班**（status → `withdrawal`） | 正式退班，保留歷史 |

出勤次數定義：`attendances` 表中 `enrollment_id = id` 的紀錄筆數。

### API 升級 — `DELETE /api/enrollments/:id`

**取代現有邏輯**（移除 `status !== pending_payment` 的限制），改以出勤數為唯一判斷條件：

1. 查 `attendances WHERE enrollment_id = :id`
2. 有紀錄 → 回 `409 Conflict`，body: `{ error: 'has_attendance', message: '此學生已有出勤紀錄，請改用退班流程' }`
3. 無紀錄 → hard delete（不論 status 為何）

### UI — 班級詳情頁操作選單

學生 row 的操作選單（現有 action menu）根據出勤數調整選項：

- 出勤 = 0：顯示「**移除**」（執行 hard delete，二次確認提示：「確定移除？此操作不留紀錄。」）
- 出勤 ≥ 1：顯示「**退班**」（現有退班流程不變）

`attendanceCount` 為判斷唯一依據，與 enrollment status 無關（`suspended` 且出勤 = 0 → 也顯示「移除」）。

**出勤數資料來源：**
`GET /api/enrollments?classId=:id` 回傳資料中加入 `attendanceCount: number` 欄位，前端直接用此欄位判斷，不需額外 API 呼叫。

後端實作：Supabase select 加入 embedded count：
```ts
.select('*, attendances(count)')
// 回傳：attendances: [{ count: N }]
// mapping：attendanceCount = row.attendances?.[0]?.count ?? 0
```

前端 `Enrollment` interface 新增 `attendanceCount: number`，`EnrollmentsService` 對應 mapping 同步更新。

---

## 影響範圍

| 層 | 變更 |
|----|------|
| DB | 無 schema 變更（`attendances` 表查詢即可） |
| API | 新增 `POST /api/enrollments/batch`；`DELETE /api/enrollments/:id` 加出勤檢查；`GET /api/enrollments` 回傳加 `attendanceCount` |
| Frontend Service | `EnrollmentsService` 新增 `batchCreate()` 方法 |
| Frontend Component | `StudentPickerDialogComponent` 升級為兩步 wizard；`class-detail.page.ts` 調整 open/callback 邏輯；action menu 加出勤判斷 |

---

## 不在範圍內

- 學生詳情頁的 enrollment 操作（維持現有行為）
- 退班流程本身的 UI/UX 變更
- 出勤次數以外的 hard delete 條件（例如時間窗口）
