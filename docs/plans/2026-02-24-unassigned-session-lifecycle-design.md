# Unassigned Session Lifecycle Design (MVP)

## 背景與問題
目前課程管理的「產生課堂」流程存在規則不一致：
- `schedules.teacher_id` 允許為 `NULL`
- `sessions.teacher_id` 為必填，且產生流程會跳過無教師時段

因此使用者會看到「預覽看起來可產生，但實際建立 0 筆」的落差，且原因不透明。

## 本次目標（已確認）
- 範圍：`C`（一次到位設計），但先交付 `MVP`
- 交付重點：
  1. 建立「無主課堂」正式資料模型
  2. 修正產生課堂流程（預覽與實作一致）
  3. 提供單班級批次指派教師（S1）
  4. 對 `unassigned` 課堂做前後端雙層阻擋（R1）

## 已確認決策
- 里程碑：`MVP`
- 產生課堂預設：`P1`（預設包含無主課堂，可關閉）
- 衝突策略預設：`C1`（`skip-conflicts`）
- 阻擋層級：`R1`（API hard block + UI disabled）
- 批次指派範圍：`S1`（單班級 + 日期區間 + 星期/時段過濾）
- 方案：`A`（顯性無主模型 + 單一路徑批次指派）

## 非目標（MVP 不做）
- 跨課程/跨分校的大範圍批次指派
- 複雜自動排課最佳化
- 完整報表重構（先做必要欄位與查詢相容）

## 資料模型設計

### 1. sessions 欄位調整
- `teacher_id` 改為 nullable
- 新增 `assignment_status` enum：
  - `assigned`
  - `unassigned`

### 2. 一致性約束
新增 check constraint，確保資料語意一致：
- `assignment_status = 'assigned'` -> `teacher_id IS NOT NULL`
- `assignment_status = 'unassigned'` -> `teacher_id IS NULL`

### 3. 既有資料回填
- 既有 `sessions.teacher_id IS NOT NULL` 全部回填為 `assignment_status = 'assigned'`

## 後端 API 設計

### A. 預覽課堂（既有擴充）
- Route: `GET /api/classes/:id/sessions/preview`
- 新增 query：`includeUnassigned`（預設 `true`）
- 每筆預覽新增欄位：
  - `canCreate: boolean`
  - `willBeUnassigned: boolean`
  - `skipReason: 'exists' | 'no_teacher' | null`

### B. 產生課堂（既有擴充）
- Route: `POST /api/classes/:id/sessions/generate`
- 新增 body：`includeUnassigned?: boolean`（預設 `true`）
- 回傳統計改為：
  - `createdAssigned`
  - `createdUnassigned`
  - `skippedExisting`
  - `skippedNoTeacher`
  - `totalPlanned`

### C. 單班級批次指派（新增）
- Route: `PATCH /api/classes/:id/sessions/batch-assign-teacher`
- Body:
  - `from`, `to`
  - `weekday?: number[]`
  - `timeRanges?: Array<{ startTime: string; endTime: string }>`
  - `toTeacherId`
  - `mode: 'skip-conflicts' | 'strict' | 'force'`（MVP 預設 `skip-conflicts`）
- 處理範圍（MVP）：
  - `status = 'scheduled'`
  - `assignment_status = 'unassigned'`
- 回傳：
  - `updated`
  - `skippedConflicts`
  - `skippedNotEligible`
  - `conflicts[]`

### D. 操作阻擋（R1）
在會影響課堂執行狀態的操作前擋下 `unassigned`：
- 停課、代課、調課等 `/api/sessions/:id/*` 操作需檢查
- 回傳 `409` + `code: 'SESSION_UNASSIGNED'`

## 前端設計（Admin 課程管理/行事曆）

### 1. 產生課堂 Dialog
- 新增「包含無主課堂」開關（預設開啟）
- 對應 API `includeUnassigned`

### 2. 預覽頁資訊拆分
- Summary 顯示：
  - 將建立（已指派）
  - 將建立（無主）
  - 略過（已存在）
  - 略過（無老師）
- 列狀態 badge：
  - `將建立-已指派`
  - `將建立-無主`
  - `已存在`
  - `略過`

### 3. 批次指派 Dialog（S1）
- 入口：班級列操作 + 產生完成提示
- 表單：日期區間、星期、時段區間、目標老師、模式
- 流程：先預覽結果，再確認套用

### 4. 無主課堂 UI 限制（R1 前端層）
- 行事曆與課堂列表顯示 `unassigned` 標示
- 相關操作按鈕 disabled + tooltip 提示「請先指派老師」

## 錯誤碼與可觀測性
- `SESSION_UNASSIGNED`：未指派課堂不可操作
- `INVALID_DATE_RANGE`：日期區間錯誤
- `TEACHER_CONFLICT`：`strict` 模式因衝突失敗
- `DB_CONSTRAINT_VIOLATION`：違反 assignment 約束

Audit log 最小欄位：操作者、班級、日期範圍、模式、更新數、略過數、衝突數。

## 驗收標準（MVP）
1. 可建立 `unassigned` 課堂，且建立統計清楚可見。
2. 單班級批次指派可用，`skip-conflicts` 能部分成功並回報衝突。
3. `unassigned` 課堂在 API 與 UI 都無法進行受限操作。
4. 預覽結果與實際建立結果規則一致，不再出現不明原因 0 筆。

## 風險與緩解
- 風險：改動 sessions schema 影響既有查詢
  - 緩解：回填 + type 更新 + 嚴格 constraint + 回歸測試
- 風險：批次指派衝突計算與現行排課衝突邏輯不一致
  - 緩解：共用衝突判斷函式，避免分叉

## 里程碑
- M1: Migration + schema/type 對齊
- M2: preview/generate API 一致化 + stats 擴充
- M3: batch-assign API + 衝突預覽
- M4: 前端 Dialog/狀態呈現 + R1 阻擋整合
