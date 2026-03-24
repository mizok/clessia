# Session Handoff — 2026-03-20

> 新 session 請從這份文件了解目前進度與下一步任務。

---

## 目前狀態

- **Branch：** `feat/enrollment`
- **上一個 session 做了什麼：** 完成設計、寫好實作計畫，**尚未開始實作**

---

## 下一步任務（立即執行）

**執行實作計畫：**

```
doc/superpowers/plans/2026-03-20-batch-enroll-and-clean-remove.md
```

計畫已通過 reviewer 審查，可以直接執行。請使用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` skill，**盡量委派給 Codex**。

---

## 功能概述（給新 session 快速理解）

**功能一：批次加入學生**

- 班級詳情頁「加入學生」→ 開啟升級版 `StudentPickerDialog`（兩步驟 wizard）
- Step 1：多選學生（checkbox）
- Step 2：預覽名單，若超過班級名額則 block 確認
- Dialog 自行呼叫 `POST /api/enrollments/batch`，顯示 loading spinner，完成後關閉
- 父頁面收到結果，顯示 toast：「成功加入 N 人，M 人已在班（略過）」

**功能二：無痕移除（Hard Delete）**

- 出勤次數 = 0 → action menu 顯示「移除」（hard delete，不留紀錄）
- 出勤次數 ≥ 1 → action menu 顯示「退班」（現有流程不變）
- `GET /api/enrollments` 回傳新增 `attendanceCount` 欄位，前端直接用

---

## 計畫包含 6 個 Tasks

| Task | 說明 |
|------|------|
| Task 1 | API GET — 加入 `attendanceCount`（Supabase embedded count） |
| Task 2 | API — 新增 `POST /api/enrollments/batch` |
| Task 3 | API — 更新 `DELETE /api/enrollments/:id`（出勤檢查取代 status 檢查） |
| Task 4 | Frontend Service — `Enrollment` interface 加 `attendanceCount`、`batchCreate()` 方法 |
| Task 5 | Frontend — `StudentPickerDialog` 升級為兩步 wizard（含 loading spinner） |
| Task 6 | Frontend — `class-detail.page.ts` 更新 picker 呼叫、onClose callback、action menu |

---

## 重要技術細節

### API 端（`apps/api/src/routes/enrollments.ts`）

- 使用 Hono `app.openapi(createRoute({...}), handler)` 模式
- `c.get('orgId')` / `c.get('userId')` / `c.get('supabase')` 取得 context
- Supabase embedded count 語法：`.select('*, attendances(count)')` → `row.attendances?.[0]?.count ?? 0`
- DB partial unique index 保證：`status IN ('withdrawal','void')` 的學生可重新加入（不會觸發 `23505`）

### Frontend（`apps/web/src/app/...`）

- `StudentPickerDialog` 路徑：`features/admin/pages/courses/class-detail/student-picker-dialog/`
- `class-detail.page.ts` 路徑：`features/admin/pages/courses/class-detail/class-detail.page.ts`
- Dialog 需要 inject `EnrollmentsService` 來直接呼叫 `batchCreate()`
- `config.data` 傳入：`{ existingStudentIds, maxStudents, currentActiveCount, classId }`
- `onClose` 回傳：`{ results: BatchCreateResultItem[] }`
- Task 6 Step 1 要先確認 `cls()` signal 的型別有 `maxStudents` 欄位（若無需在 `ClassesService` 補上）

---

## 本 Session 完成的其他工作（已 commit）

1. **移除幼稚園年級（K）**：API schema、DB migration、frontend service、docs 全部更新
2. **InlineNoticeComponent 批次替換**：11 個頁面的 error/notice block 全換成 `<app-inline-notice>`（Codex 執行）
3. **文件同步**：`roles-and-auth.md`（標記已實作項目）、`students.md`（移除 K 年級）

---

## 相關文件

| 文件 | 路徑 |
|------|------|
| 設計規格 | `doc/superpowers/specs/2026-03-20-batch-enroll-and-clean-remove-design.md` |
| 實作計畫 | `doc/superpowers/plans/2026-03-20-batch-enroll-and-clean-remove.md` |
| DB Migration | `supabase/migrations/20260320000001_remove_grade_level_k.sql` |
