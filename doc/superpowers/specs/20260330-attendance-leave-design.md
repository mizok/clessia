# 出勤紀錄 & 請假管理 設計文件

**日期**：2026-03-30
**功能**：管理員角色 > 學務管理 > 出勤紀錄 / 請假管理
**Branch**：feat/enrollment（待開新 branch）

---

## 一、背景與範疇

### 本次實作
- 出勤紀錄（`/admin/attendance`）：管理員查看、修改全校學生出勤
- 請假管理（`/admin/leave`）：管理員代建、查看學生請假；提交即生效、自動連動出勤狀態

### 本次不做
- 成績查詢（搭配全校模擬考管理獨立設計）
- 全校模擬考管理（獨立 session）
- 員工請假（日後歸入人員管理底下的員工詳情頁）
- Teacher 端點名介面（teacher portal 整體為下一階段）
- Parent 端請假申請（parent portal 整體為下一階段）

---

## 二、業務規則

### 出勤模式（組織層級）

系統支援兩種模式，由 `organizations.attendance_mode` 控制，全組織統一：

| 模式 | 說明 |
|------|------|
| `per_session`（隨堂點名） | 老師逐課堂標記每位學生的出席狀態；管理員可事後修改 |
| `daily_checkin`（日到班） | 學生抵達分校打卡後，自動批次標記當天所有課堂為「到課」；中途請假則手動修改 |

**日到班補充**：同一學生同一天可能在不同分校有課，需在各分校分別打卡。打卡以 `(student_id, campus_id, checkin_date)` 為唯一鍵。

### 出勤狀態

```
present（到課）/ absent（缺席）/ on_leave（請假）
```

### 請假規則

1. **提交即生效**，不需審核流程
2. 提交者可以是：家長（parent portal，未來實作）或管理員（代建）
3. 提交後，系統自動將該學生在請假日期範圍內所有 events 的 attendance_records 改為 `on_leave`
4. 刪除請假紀錄後，對應的 attendance_records 恢復為 `absent`（而非 `present`，需人工確認）

### 多分校

- 所有查詢預設顯示全部分校，可用篩選器縮小到特定分校
- attendance_records 透過 event → campus 關聯取得分校資訊

---

## 三、資料庫設計

### 3.1 新增 enum

```sql
CREATE TYPE event_type AS ENUM ('session', 'mock_exam');
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'on_leave');
CREATE TYPE attendance_mode AS ENUM ('per_session', 'daily_checkin');
CREATE TYPE leave_submitter_role AS ENUM ('parent', 'admin');
```

### 3.2 新增 `events` 表

```sql
CREATE TABLE events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type  event_type NOT NULL,
  title       TEXT NOT NULL,
  campus_id   UUID REFERENCES campuses(id),
  event_date  DATE NOT NULL,
  start_time  TIME,
  end_time    TIME,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_org_date ON events(org_id, event_date);
CREATE INDEX idx_events_campus ON events(campus_id);
```

### 3.3 修改 `sessions` 表（掛載 event_id）

```sql
-- Step 1: 加欄位（nullable）
ALTER TABLE sessions ADD COLUMN event_id UUID REFERENCES events(id);

-- Step 2: backfill（migration 中為每筆現有 session 建立對應 event 記錄）
-- 邏輯：INSERT INTO events (...) SELECT ... FROM sessions WHERE event_id IS NULL

-- Step 3: 加 NOT NULL 約束
ALTER TABLE sessions ALTER COLUMN event_id SET NOT NULL;
```

### 3.4 新增 `attendance_records` 表

```sql
CREATE TABLE attendance_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status            attendance_status NOT NULL DEFAULT 'present',
  note              TEXT,
  recorded_by       TEXT,           -- ba_user.id
  recorded_by_role  TEXT,           -- 'teacher' | 'admin' | 'system'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, event_id)
);

CREATE INDEX idx_attendance_org_event ON attendance_records(org_id, event_id);
CREATE INDEX idx_attendance_student ON attendance_records(student_id);
```

### 3.5 新增 `leave_requests` 表

```sql
CREATE TABLE leave_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  reason              TEXT,
  submitted_by        TEXT NOT NULL,       -- ba_user.id
  submitted_by_role   leave_submitter_role NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_org_date ON leave_requests(org_id, start_date, end_date);
CREATE INDEX idx_leave_student ON leave_requests(student_id);
```

### 3.6 新增 `daily_checkins` 表（日到班模式）

```sql
CREATE TABLE daily_checkins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  campus_id     UUID NOT NULL REFERENCES campuses(id),
  checkin_date  DATE NOT NULL,
  checkin_time  TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, campus_id, checkin_date)
);
```

### 3.7 修改 `organizations` 表

```sql
ALTER TABLE organizations
  ADD COLUMN attendance_mode attendance_mode NOT NULL DEFAULT 'per_session';
```

---

## 四、API 設計

所有 API 掛在 `/api/` 下，使用既有 `authMiddleware`（驗 session + org）。

### 分頁結構（統一）

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}
```

### 4.1 出勤紀錄

| Method | Path | 說明 |
|--------|------|------|
| `GET` | `/api/attendance` | 查詢出勤紀錄（分頁） |
| `POST` | `/api/attendance` | 手動新增出勤紀錄 |
| `PATCH` | `/api/attendance/:id` | 修改出勤狀態 |

**GET `/api/attendance` query params：**
```
campus_id?    分校篩選
class_id?     班級篩選
student_id?   學生篩選
date_from?    日期起
date_to?      日期迄
status?       狀態篩選
page          頁數（default: 1）
pageSize      每頁筆數（default: 20）
```

**PATCH body：**
```json
{ "status": "present" | "absent" | "on_leave", "note": "..." }
```

### 4.2 請假管理

| Method | Path | 說明 |
|--------|------|------|
| `GET` | `/api/leaves` | 查詢請假紀錄（分頁） |
| `POST` | `/api/leaves` | 新增請假（提交即生效，自動更新 attendance） |
| `DELETE` | `/api/leaves/:id` | 刪除請假（attendance 恢復為 absent） |

**GET `/api/leaves` query params：**
```
campus_id?
student_id?
date_from?
date_to?
page
pageSize
```

**POST body：**
```json
{
  "student_id": "uuid",
  "start_date": "2026-04-01",
  "end_date": "2026-04-01",
  "reason": "身體不適"
}
```

### 4.3 組織設定

| Method | Path | 說明 |
|--------|------|------|
| `GET` | `/api/org/settings` | 取得組織設定（含 attendance_mode） |
| `PATCH` | `/api/org/settings` | 更新組織設定 |

**PATCH body：**
```json
{ "attendance_mode": "per_session" | "daily_checkin" }
```

### 4.4 日到班打卡

| Method | Path | 說明 |
|--------|------|------|
| `POST` | `/api/daily-checkins` | 學生打卡，自動批次建立當天所有課堂 attendance |
| `GET` | `/api/daily-checkins` | 查詢打卡紀錄 |

---

## 五、前端頁面設計

### 5.1 `/admin/attendance`（出勤紀錄）

**元件**：`AttendancePage`（現有骨架轉正，`attendance.page.ts`）

**篩選區（Filter Bar）**：
- 分校下拉（`p-select`）
- 班級下拉（`p-select`，依分校聯動）
- 學生搜尋（`p-autocomplete`）
- 日期範圍（`p-datepicker` range mode）
- 狀態下拉（到課/缺席/請假）

**資料表（`p-table`）**：
| 學生姓名 | 分校 | 班級 | 日期 | 課堂時間 | 狀態 | 備註 | 操作 |
|---------|------|------|------|--------|------|------|------|

- 狀態欄位：inline 點選修改（`p-select` 或 status badge 點選）
- 分頁：`p-paginator`
- 載入骨架：`p-skeleton`

**Service**：新增 `AttendanceService`（`attendance.service.ts`）

### 5.2 `/admin/settings`（系統設定，本次新增出勤模式區塊）

**元件**：`SettingsPage`（現有骨架，新增出勤設定區塊）

**出勤模式設定：**
- 標題：「出勤紀錄模式」
- 說明文字：解釋兩種模式的差異
- 切換元件：`p-selectbutton` 或 `p-togglebutton`（隨堂點名 / 日到班）
- 儲存後 Toast 確認

**Service**：新增 `OrgSettingsService`（或整合至現有 settings service）

### 5.3 `/admin/leave`（請假管理）

**元件**：`LeavePage`（現有骨架轉正，`leave.page.ts`）

**工具列**：「新增請假」按鈕

**篩選區**：
- 分校下拉
- 學生搜尋
- 日期範圍

**資料表（`p-table`）**：
| 學生姓名 | 分校 | 請假開始 | 請假結束 | 天數 | 原因 | 提交者 | 操作（刪除） |
|---------|------|--------|--------|------|------|------|------------|

- 分頁

**新增請假 Dialog**：
- 選學生（`p-autocomplete`）
- 日期區間（`p-datepicker` range）
- 原因（`p-textarea`，可選填）
- 送出後 Toast 確認、自動 reload 列表

**Service**：新增 `LeaveService`（`leave.service.ts`）

---

## 六、未來擴充路徑

| 功能 | 說明 |
|------|------|
| Teacher 端點名 | 隨堂點名模式，老師在課堂中建立/修改 attendance_records |
| Parent 端請假申請 | 家長透過 parent portal 提交 leave_requests |
| 日到班打卡 UI | 公開頁 `qr-checkin` 擴充，觸發 `/api/daily-checkins` |
| 員工請假 | 獨立設計；`人員管理` 已於 2026-03-30 移至「人事管理」group（routes-catalog.ts），員工請假日後可直接歸入此群組 |
| 全校模擬考管理 | events 表 event_type='mock_exam'，獨立 session 設計，自動銜接出勤 |
| 成績查詢 | 搭配模擬考管理一起設計 |

---

## 七、風險與注意事項

1. **sessions backfill migration**：需為所有現有 sessions 建立 events 記錄，migration 要確保 idempotent
2. **attendance_records 刪除請假後的狀態**：恢復為 `absent` 而非 `present`，避免錯誤標記出席
3. **日到班 + 跨分校**：同學生同日跨分校的情況，每個分校需獨立打卡，`UNIQUE(student_id, campus_id, checkin_date)` 保證不重複
4. **授權**：目前 admin API 沒有後端 admin gate，新 API 需補上（列入現有已知風險）
