# 課程管理 — 功能改善清單

**日期**：2026-02-23
**依據**：使用情境 brainstorming（feat/classes 實作後）

---

## 優先等級定義

| 等級  | 說明                           |
| ----- | ------------------------------ |
| 🔴 P1 | 影響日常操作正確性，應盡早實作 |
| 🟡 P2 | 提升操作效率與可見性           |
| 🟠 P3 | 重要但依賴其他功能先完成       |

---

## P1 — 日常操作正確性

### 1. 排課衝突檢查

**情境**：新增班級時，管理員指定老師 + 時段，但該老師在同一時段已被另一個班佔用。

**現狀**：系統無任何警告，可靜默地排出衝突課表。

**改善方向**：

- 儲存 schedule 時，後端檢查同老師 `weekday + start_time ~ end_time` 是否與其他 schedule 重疊（考慮 `effective_from / effective_to` 範圍）
- 前端顯示警告（非阻擋式：可選擇無視後繼續儲存，以應對「某老師同時教兩個班同一科但分上下半堂」的情況）

**需要修改**：

- `POST /api/classes/:id/schedules` — 加衝突查詢
- `classes.page.ts` — dialog 顯示警告

---

### 2. 班級完整度提示

**情境**：管理員建完課程、班級後，容易忘記「設時段」或「產生課堂」這些後續步驟。

**現狀**：UI 不提示任何缺漏。

**改善方向**：

- 在班級列表中，對「沒有 schedule」的班級顯示 `⚠ 尚未設定上課時間` 提示
- 對「有 schedule 但 0 sessions」的班級顯示 `⚠ 尚未產生課堂` 提示（需要 sessions count 回傳）
- API 回傳 `scheduleCount` 與 `sessionCount`（或 `hasUpcomingSessions`）

**需要修改**：

- `GET /api/classes` — 加入 `scheduleCount`, `hasUpcomingSessions`
- `ClassSchema` — 新增欄位
- `classes.page.html` — 在班級行顯示提示 badge

---

### 3. 產生課堂時排除假日

**情境**：選擇日期範圍後，想跳過國定假日（如：除夕、元旦、颱風假）。

**現狀**：產生課堂時無法排除特定日期，只能事後手動刪除。

**改善方向**：

- 「產生課堂」dialog 加入「排除日期」multi-select（可手動挑選要跳過的日期）
- 或加入「載入台灣國定假日」按鈕（呼叫 TDX 或內建假日清單）
- preview 畫面標示哪些日期因此被跳過

**需要修改**：

- `GET /api/classes/:id/sessions/preview` — 加 `excludeDates[]` 查詢參數
- `POST /api/classes/:id/sessions/generate` — 加 `excludeDates[]`
- `classes.page.ts` — generateDialog 加排除日期選擇

---

### 4. 課堂異動（取消 / 補課 / 調老師）

**情境**：已產生課堂後，老師臨時請假、調課、或換代課老師。

**現狀**：sessions 頁面尚未實作，無法對個別課堂操作。

**改善方向**（規劃於 sessions 頁面實作時一併完成）：

- 課堂清單支援以 class / 日期範圍 / 老師篩選
- 每筆課堂可操作：取消（status → cancelled）、補課（新增一筆 session）、換老師（更新 teacher_id）
- 取消/補課需填「原因」備註
- 日曆視圖（參考設計文件的「行事曆整合」構想）

**依賴**：sessions CRUD 頁面（尚未實作）

---

## P2 — 操作效率與可見性

### 5. 以老師為維度篩選排課

**情境**：「天成老師這週排了哪些班？」目前無法快速查到。

**現狀**：篩選只有分校 / 科目 / 狀態，無老師篩選。

**改善方向**：

- 班級列表的篩選工具列加入「老師」下拉（`p-select`，選項從 staff 清單來）
- 前端 computed `courseGroups` 加入 `teacherId` 篩選邏輯：若某班的任一 schedule 包含該老師則顯示
- 顯示時可 highlight 符合老師的時段

**需要修改**：

- `classes.page.ts` — 加 `selectedTeacherId` signal + computed 邏輯
- `classes.page.html` — 篩選列加老師 select

---

### 6. 操作紀錄（Audit Log）

**情境**：多個管理員共用系統時，需要追蹤「誰在什麼時候改了什麼」。常見問題：「人數上限是誰改的？」「課堂是誰刪的？」

**現狀**：無任何操作紀錄。

**改善方向**：

**方案 A（輕量）**：在 `classes` / `schedules` / `sessions` 表加 `updated_by uuid`，每次 update 記錄操作者 ID，查詢時 join staff 取名稱。只記「最後一次修改者」，不保留歷史。

**方案 B（完整 Audit Log）**：建立 `audit_logs` 資料表，記錄每次操作：

```
entity_type, entity_id, action (create/update/delete),
changed_by, changed_at, old_value (jsonb), new_value (jsonb)
```

可在各 entity 的詳情頁面顯示操作歷史。

**建議**：先做方案 A（成本低，解決最常見問題），後續有需要再升級到方案 B。

**需要修改（方案 A）**：

- migration：`classes`, `schedules` 加 `created_by`, `updated_by`
- API 各 POST/PUT/PATCH/DELETE 帶入 `session.user.id`
- `ClassSchema` 加 `updatedBy`, `updatedByName`
- UI：班級詳情顯示「最後由 XXX 修改於 YYYY-MM-DD」

---

### 7. 批次操作

**情境**：暑假前要把 20 個班同時停用；新學期開始前要把舊的班一次刪除。

**現狀**：只能一個一個操作。

**改善方向**：

- 班級列表加 checkbox（桌機模式）
- 底部出現 action bar：「停用選取 (N)」/ 「啟用選取 (N)」/ 「刪除選取 (N)」
- 確認對話框 → 批次 API

**需要修改**：

- `PATCH /api/classes/batch-toggle-active` — 批次停用/啟用
- `DELETE /api/classes/batch` — 批次刪除（有 sessions 的拒絕）
- `classes.page.ts` — 加 selection signal
- `classes.page.html` — checkbox column + action bar

---

### 10. 新增時段時允許不指派老師

**情境**：開設新班時，課表時段已確定（如：每週六上午 9-11 點），但老師尚未決定。目前必須先指派老師才能儲存時段，造成流程卡關。

**現狀**：

- 前端 `saveClass()` 驗證要求 `teacherId` 非空，否則顯示「時段資料不完整」
- `addScheduleEntry()` 預設自動帶入第一位符合條件的老師
- API `CreateScheduleSchema` 要求 `teacherId` 必為有效 UUID

**改善方向**：

- `teacherId` 改為選填（`nullable`）
- 前端移除 teacherId 的必填驗證，改為「若有 teacherId 則驗證格式」
- UI：老師選單預設顯示「待指派」選項（值為 `null`）
- 班級列表中，無老師的時段以 `— 待指派` 顯示（搭配改善項 #2 的完整度提示）

**需要修改**：

- `ScheduleFormEntry.teacherId` 型別改為 `string | null`
- `saveClass()` — 移除 teacherId 必填檢查
- `addScheduleEntry()` — 預設 teacherId 為 `null`（不再自動帶入第一位老師）
- `POST /api/classes/:id/schedules` — `teacherId: z.uuid().nullable().optional()`
- `PUT /api/classes/:id/schedules/:sid` — 同上
- DB migration：`schedules.teacher_id` 欄位允許 NULL

---

### 11. 篩選無結果時顯示正確的空狀態

**情境**：搜尋或套用篩選條件後，結果為空時，畫面顯示「尚未建立任何課程」並附上「新增課程」按鈕——這個訊息是針對「系統完全沒資料」的狀況，在有篩選條件時出現會讓人誤以為資料被刪除了。

**現狀**：`courseGroups().length === 0` 時一律顯示同一個 empty state，不區分「真的沒資料」vs「篩選無結果」。

**改善方向**：
- 有篩選條件（`hasActiveFilters() === true`）時顯示：「找不到符合條件的課程或班級」+ 「清除篩選」按鈕
- 完全沒資料（`hasActiveFilters() === false`）才顯示：「尚未建立任何課程」+ 「新增課程」按鈕

**需要修改**：
- `classes.page.html` — `@else if (courseGroups().length === 0)` 區塊內依 `hasActiveFilters()` 分支

---

## P3 — 依賴其他功能

### 8. 學生人數顯示（依賴 enrollment）

**情境**：班級建立後需要知道「已報名 / 人數上限」，管理員才能決定是否停招。

**現狀**：`maxStudents` 有設，但在籍學生數無法顯示（enrollment 功能未實作）。

**改善方向**：

- 待 enrollment 功能實作後，在班級行顯示 `12 / 20` 人數進度條
- 達到上限時顯示「已滿班」badge

**依賴**：enrollment 功能（尚未規劃）

---

### 9. 升班流程（依賴 enrollment）

**情境**：學期末，某班學生要統一升到下一階班（`nextClassId` 的用途）。

**現狀**：`nextClassId` 欄位有設計，但沒有「批次升班」的操作界面與邏輯。

**改善方向**：

- 在班級詳情加「執行升班」按鈕（只有設有 `nextClassId` 的班才顯示）
- 點擊後顯示：「將把 N 位學生從此班轉移到下一階班，確定執行？」
- API 批次更新 enrollments 的 class_id

**依賴**：enrollment 功能（尚未規劃）

---

## 摘要

| #   | 功能                  | 優先  | 依賴          |
| --- | --------------------- | ----- | ------------- |
| 1   | 排課衝突檢查          | 🔴 P1 | 無            |
| 2   | 班級完整度提示        | 🔴 P1 | 無            |
| 3   | 產生課堂排除假日      | 🔴 P1 | 無            |
| 4   | 課堂異動（取消/補課） | 🔴 P1 | sessions 頁面 |
| 5   | 以老師篩選            | 🟡 P2 | 無            |
| 6   | 操作紀錄              | 🟡 P2 | 無            |
| 7   | 批次操作              | 🟡 P2 | 無            |
| 10  | 時段允許不指派老師    | 🟡 P2 | 無            |
| 11  | 篩選無結果空狀態修正  | 🟡 P2 | 無            |
| 8   | 學生人數顯示          | 🟠 P3 | enrollment    |
| 9   | 升班流程              | 🟠 P3 | enrollment    |

---

_由 Claude Code 於 2026-02-23 生成，feat/classes brainstorming session_
