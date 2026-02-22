# 開課班管理 設計文件

**日期**：2026-02-23
**路由**：`/admin/classes`
**分支**：`feat/classes`

---

## 核心決策

### 1. 課程 + 班級合併為同一頁面（方案 B）

**決策**：將 `/admin/courses`（課程管理）與 `/admin/classes`（開課班管理）合併為一個層級式頁面。

**理由**：
- 管理員操作更直覺，一頁看到「哪個課程 → 哪些班」
- 專案初期，重構成本可接受
- 課程（course）是班級（class）的父層，視覺上合併呈現更清楚

**影響**：
- `ADMIN_COURSES` 從側邊欄隱藏（`showInMenu: false`）
- `ADMIN_CLASSES` 成為唯一入口，含課程 CRUD + 班級 CRUD
- 現有 courses.page 保留但不顯示在選單

---

### 2. 教室欄位 MVP 跳過

**決策**：上課時間的「教室」欄位在 MVP 階段不實作，`classrooms` 資料表暫不建立。
**理由**：初期先聚焦在核心功能（班級管理和產生課堂），教室管理留到後續 sprint。

---

### 3. 行事曆整合構想（記錄，留待後續 sprint）

**構想**：課堂搜尋（sessions）、排課管理（schedule）、課務異動（changes）三個頁面合成一個「課程日曆」頁面：
- 搜尋後直接在月曆上顯示結果
- 點擊月曆上的課堂 → 直接做課務異動
- 排課管理 = 純行事曆視圖

**行動**：在建立 sessions/schedule/changes 功能時採用此設計。

---

## 頁面設計

### 佈局

```
[Header] 開課班管理                                [+ 新增課程]

[搜尋框] [分校 ▼] [科目 ▼] [狀態 ▼]              [清除篩選]

─── 南板校區 > 國一數學 ─────────────── [編輯課程] [+ 新增班]
  ▶ A 班  週一/三 19-21  天成  15/20  啟用
  ▶ B 班  週二/四 19-21  李成  12/20  啟用

─── 南板校區 > 國二數學 ─────────────── [編輯課程] [+ 新增班]
  ▼ A 班（展開中）
    上課時間：
    • 週三 19:00-21:00 天成老師（2026/03/01 起）
    • 週五 19:00-21:00 天成老師（2026/03/01 起）
    [編輯班級] [產生課堂] [停用]
```

### 回應式設計

- **桌機**：課程群組標題 + 表格行 + 展開行（expandable rows）
- **手機**：課程群組標題 + 班級卡片 + 卡片內展開詳情

---

## 資料庫 Schema

### Migration 檔案

`supabase/migrations/20260223000001_create_classes.sql`

### `classes` 表

```sql
CREATE TABLE public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campus_id uuid NOT NULL REFERENCES public.campuses(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  name text NOT NULL,
  max_students smallint NOT NULL DEFAULT 20,
  grade_levels text[] DEFAULT '{}',       -- e.g. ['國中一', '國中二']
  is_recommended boolean NOT NULL DEFAULT false,
  next_class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classes_campus_name_key UNIQUE (campus_id, name)
);

CREATE INDEX classes_org_id_idx ON public.classes (org_id);
CREATE INDEX classes_campus_id_idx ON public.classes (campus_id);
CREATE INDEX classes_course_id_idx ON public.classes (course_id);
```

### `schedules` 表（上課時間）

```sql
CREATE TABLE public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- 1=週一, 7=週日
  start_time time NOT NULL,
  end_time time NOT NULL,
  teacher_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  -- classroom_id 跳過（MVP），待後續 sprint 補充
  effective_from date NOT NULL,
  effective_to date,                                          -- NULL = 持續有效
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedules_time_order CHECK (end_time > start_time),
  CONSTRAINT schedules_unique_slot UNIQUE (class_id, weekday, start_time, effective_from)
);

CREATE INDEX schedules_class_id_idx ON public.schedules (class_id);
CREATE INDEX schedules_teacher_id_idx ON public.schedules (teacher_id);
```

### `sessions` 表（課堂，由「產生課堂」批次建立）

```sql
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES public.schedules(id) ON DELETE SET NULL,
  session_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  teacher_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_class_date_time_key UNIQUE (class_id, session_date, start_time)
);

CREATE INDEX sessions_org_id_idx ON public.sessions (org_id);
CREATE INDEX sessions_class_id_idx ON public.sessions (class_id);
CREATE INDEX sessions_session_date_idx ON public.sessions (session_date);
CREATE INDEX sessions_teacher_id_idx ON public.sessions (teacher_id);
```

### RLS Policies

遵循現有模式（select for org members, all for admins）。

---

## API Endpoints

### 已有（不變）

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/courses` | 課程列表（現有） |
| GET | `/api/courses/:id` | 單一課程（現有） |
| POST | `/api/courses` | 新增課程（現有） |
| PUT | `/api/courses/:id` | 更新課程（現有） |
| DELETE | `/api/courses/:id` | 刪除課程（現有） |

### 新增

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/classes` | 班級列表（分頁 + 篩選） |
| GET | `/api/classes/:id` | 單一班級（含 schedules） |
| POST | `/api/classes` | 新增班級 |
| PUT | `/api/classes/:id` | 更新班級 |
| PATCH | `/api/classes/:id/toggle-active` | 停用/啟用 |
| DELETE | `/api/classes/:id` | 刪除班級（無 sessions 才可刪） |
| POST | `/api/classes/:id/schedules` | 新增上課時間 |
| PUT | `/api/classes/:id/schedules/:sid` | 更新上課時間 |
| DELETE | `/api/classes/:id/schedules/:sid` | 刪除上課時間 |
| GET | `/api/classes/:id/sessions/preview` | 預覽將產生的課堂（帶 `?from=&to=`） |
| POST | `/api/classes/:id/sessions/generate` | 確認後批次建立課堂 |

### GET /api/classes 查詢參數

```typescript
{
  page?: number;
  pageSize?: number;
  search?: string;      // 搜尋班名
  campusId?: string;
  courseId?: string;
  isActive?: boolean;
}
```

---

## 前端元件架構

```
apps/web/src/app/
├── core/
│   └── classes.service.ts     # 新增 - API client + type definitions
├── features/admin/pages/
│   └── classes/
│       ├── classes.page.ts    # 重寫（原 classes.component.ts）
│       ├── classes.page.html
│       └── classes.page.scss
```

### Angular Signals 狀態

```typescript
// 資料狀態
readonly courses = signal<CourseWithClasses[]>([]);  // 課程 + 其班級
readonly loading = signal(false);
readonly expandedClassId = signal<string | null>(null);

// 篩選狀態
readonly searchQuery = signal('');
readonly selectedCampusId = signal<string | null>(null);
readonly selectedCourseId = signal<string | null>(null);
readonly statusFilter = signal<boolean | null>(null);

// Dialog 狀態
readonly courseDialogVisible = signal(false);
readonly courseDialogMode = signal<'create' | 'edit'>('create');
readonly editingCourse = signal<Course | null>(null);

readonly classDialogVisible = signal(false);
readonly classDialogMode = signal<'create' | 'edit'>('create');
readonly editingClass = signal<Class | null>(null);
readonly classDialogCourseId = signal<string | null>(null); // 新增班時的父課程

readonly generateDialogVisible = signal(false);
readonly generateTargetClass = signal<Class | null>(null);
readonly previewSessions = signal<SessionPreview[]>([]);
readonly generateLoading = signal(false);
```

### 4 個 Dialog

| Dialog | 觸發 | 欄位 |
|--------|------|------|
| 新增/編輯課程 | Header「新增課程」/ 課程群組「編輯課程」 | 分校、課程名稱、科目、說明、狀態 |
| 新增/編輯班級 | 課程群組「+ 新增班」/ 展開行「編輯班級」 | 班名、人數上限、適用年級（多選）、推薦開關、下一階班、狀態 + 上課時間動態列表 |
| 產生課堂 | 展開行「產生課堂」 | 起始日 → 結束日 → 預覽列表 → 確認 |
| 刪除確認 | 課程/班級刪除 | `p-confirmDialog` |

---

## 開發流程（AGENT_GUIDE.md Phase 順序）

| Phase | 說明 | 執行者 |
|-------|------|--------|
| Phase 0 | 環境調查（已完成） | 已完成 |
| Phase 2 | DB Migration（classes, schedules, sessions） | Codex |
| Phase 3 | API（/api/classes + schedules + sessions） | Codex |
| Phase 4 | Frontend Service（classes.service.ts） | Codex |
| Phase 5 | Frontend UI（classes.page 重寫） | Claude |
| Phase 5b | 側邊欄更新（courses 隱藏） | Claude |
| Phase 6 | E2E 驗證 | Codex |

---

## 測試情境

1. **Happy Path**：新增課程 → 新增班級（含 2 個時段）→ 產生課堂 → 確認建立
2. **篩選**：選擇分校篩選 → 只顯示該分校的課程/班級
3. **重複課堂**：已產生課堂後再次產生相同日期範圍 → 預覽應顯示「已存在，將略過」
4. **刪除防護**：有班級的課程 → 刪除應被阻擋，顯示錯誤
5. **停用**：班級停用 → 狀態更新，班級仍顯示於列表（帶停用 tag）
6. **手機版**：在 375px 寬度下操作，確認 Card list 正常顯示

---

## 適用年級選項（grade_levels 固定清單）

```typescript
const GRADE_OPTIONS = [
  '國小一', '國小二', '國小三', '國小四', '國小五', '國小六',
  '國中一', '國中二', '國中三',
  '高中一', '高中二', '高中三',
];
```

---

## 尚待決定（後續 sprint）

- `classrooms` 資料表設計（教室管理）
- `sessions` 頁面：搜尋 + 行事曆 + 課務異動合三為一
- 學生報名 enrollment 與 classes 的關聯

---

*文件由 Claude Code 於 2026-02-23 生成*
