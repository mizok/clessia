# 考務與成績板塊 — 三子頁面實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實作「考務與成績」板塊的三個子頁面：
1. **補習班考試**（academy-exams）— 管理補習班自辦的小考與模擬考事件
2. **段考登錄**（term-exam-entry）— 代管學生的學校段考成績
3. **成績查閱**（score-records）— 跨考試類型的成績查詢入口

**Scope:** 從 DB schema → API routes → Frontend service → 三個前端頁面的完整實作。

**Tech Stack:** Hono + `@hono/zod-openapi` + Supabase PostgreSQL（後端）；Angular 21 Signals + PrimeNG 21（前端）；Vitest（測試）

---

## 現有基礎

| 項目 | 狀態 |
|------|------|
| 前端路由 | 已設好。`GradesComponent` 為 `<router-outlet />`，三子頁面 lazy load |
| NavigationGroup | `ADMIN_LEARNING_CENTER`（考務與成績） |
| RoutesCatalog | `ADMIN_GRADES_ACADEMY_EXAMS`、`ADMIN_GRADES_TERM_ENTRY`、`ADMIN_GRADES_RECORDS` |
| Sidebar 導航 | 已顯示三個子頁面連結 |
| 子頁面元件 | 空殼 placeholder，只有 `page = input.required<RouteObj>()` |
| DB schema | **無**。目前沒有任何考試或成績相關的資料表 |
| API routes | **無**。`apps/api/src/routes/` 沒有 exams / scores 相關檔案 |
| `events` 表 | 已有 `event_type` enum 包含 `'session'` 和 `'mock_exam'`，可擴充 |
| `subjects` 表 | 已有（org 層級科目清單，FK 到 courses） |

---

## 設計決策

| 決策 | 選擇 | 理由 |
|------|------|------|
| 補習班考試事件儲存 | 新建 `academy_exams` 表，與 `events` 分開 | `events` 是出勤用途（session/mock_exam），考試事件有自己的生命週期（草稿→已發布→已結束）與不同欄位需求（科目、滿分、範圍說明） |
| 段考儲存 | 新建 `term_exams`（段考事件）+ `term_scores`（段考成績） | 段考是學校體系的事件，與補習班自辦考試在結構上不同（學期、考次、學校成績） |
| 補習班考試成績 | `academy_scores` 表 FK 到 `academy_exams` | 一場考試 × 多個學生 = 多筆成績 |
| 考試事件與班級的關聯 | `academy_exam_classes` junction table | 一場考試可關聯多個班級（跨班統考） |
| 成績查閱頁 | 聚合查詢，不建新表 | 從 `academy_scores` + `term_scores` 聯合查詢，提供統一搜尋 |
| 業務表 RLS | 不使用 RLS | 與專案慣例一致，授權在 Hono middleware 層（org_id 過濾） |

---

## DB Schema 設計

### academy_exams（補習班考試事件）

```sql
CREATE TYPE public.academy_exam_status AS ENUM ('draft', 'published', 'closed');
CREATE TYPE public.academy_exam_type AS ENUM ('quiz', 'mock_exam', 'placement_test');

CREATE TABLE public.academy_exams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campus_id   uuid REFERENCES public.campuses(id) ON DELETE SET NULL,
  name        text NOT NULL,
  exam_type   public.academy_exam_type NOT NULL DEFAULT 'quiz',
  subject_id  uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  exam_date   date NOT NULL,
  total_score smallint NOT NULL DEFAULT 100,
  scope_note  text,                          -- 考試範圍說明
  status      public.academy_exam_status NOT NULL DEFAULT 'draft',
  created_by  text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

### academy_exam_classes（考試 ↔ 班級關聯）

```sql
CREATE TABLE public.academy_exam_classes (
  exam_id  uuid NOT NULL REFERENCES public.academy_exams(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  PRIMARY KEY (exam_id, class_id)
);
```

### academy_scores（補習班考試成績）

```sql
CREATE TYPE public.score_status AS ENUM ('scored', 'absent', 'makeup');

CREATE TABLE public.academy_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id     uuid NOT NULL REFERENCES public.academy_exams(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  score       numeric(6,2),                  -- NULL 表示缺考
  status      public.score_status NOT NULL DEFAULT 'scored',
  notes       text,
  created_by  text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT academy_scores_exam_student_unique UNIQUE (exam_id, student_id)
);
```

### term_exams（段考事件）

```sql
CREATE TYPE public.term_exam_period AS ENUM ('midterm_1', 'final_1', 'midterm_2', 'final_2');

CREATE TABLE public.term_exams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  academic_year smallint NOT NULL,            -- 學年度，如 114
  semester      smallint NOT NULL CHECK (semester IN (1, 2)),
  period        public.term_exam_period NOT NULL,
  label         text NOT NULL,                -- 顯示名稱，如「114 上學期期中考」
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT term_exams_org_year_sem_period_unique
    UNIQUE (org_id, academic_year, semester, period)
);
```

### term_scores（段考成績）

```sql
CREATE TABLE public.term_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_exam_id  uuid NOT NULL REFERENCES public.term_exams(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  subject_id    uuid NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  score         numeric(6,2),
  status        public.score_status NOT NULL DEFAULT 'scored',
  notes         text,
  created_by    text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT term_scores_exam_student_subject_unique
    UNIQUE (term_exam_id, student_id, subject_id)
);
```

---

## 檔案清單

| 動作 | 檔案 | 說明 |
|------|------|------|
| 新增 | `supabase/migrations/YYYYMMDDHHMMSS_create_academy_exams.sql` | 補習班考試相關 4 張表 + enum |
| 新增 | `supabase/migrations/YYYYMMDDHHMMSS_create_term_exams.sql` | 段考相關 2 張表 + enum |
| 新增 | `apps/api/src/routes/academy-exams.ts` | 補習班考試 CRUD + 成績登錄 API |
| 新增 | `apps/api/src/routes/academy-exams.spec.ts` | 補習班考試 API 測試 |
| 新增 | `apps/api/src/routes/term-exams.ts` | 段考事件 CRUD + 成績登錄 API |
| 新增 | `apps/api/src/routes/term-exams.spec.ts` | 段考 API 測試 |
| 新增 | `apps/api/src/routes/scores.ts` | 成績查閱聚合查詢 API |
| 新增 | `apps/api/src/routes/scores.spec.ts` | 成績查閱 API 測試 |
| 新增 | `apps/web/src/app/core/academy-exams.service.ts` | 前端 service |
| 新增 | `apps/web/src/app/core/term-exams.service.ts` | 前端 service |
| 新增 | `apps/web/src/app/core/scores.service.ts` | 前端成績查閱 service |
| 修改 | `apps/web/src/app/features/admin/pages/grades/academy-exams/academy-exams.component.*` | 補習班考試頁面 |
| 修改 | `apps/web/src/app/features/admin/pages/grades/term-exam-entry/term-exam-entry.component.*` | 段考登錄頁面 |
| 修改 | `apps/web/src/app/features/admin/pages/grades/score-records/score-records.component.*` | 成績查閱頁面 |
| 修改 | `apps/api/src/index.ts`（或路由註冊處） | 掛載新路由 |

---

## 背景知識

### 現有慣例

- **API 路由格式**：使用 `@hono/zod-openapi`，每個路由檔案 export 一個 `Hono` app，在 `index.ts` 掛載
- **Org 過濾**：所有查詢加 `org_id = session.user.orgId`，不使用 RLS
- **分頁**：`page` + `pageSize` 參數，回傳 `{ data, meta: { total, page, pageSize } }`
- **前端 Service**：`providedIn: 'root'`，方法回傳 `Observable`，使用 `HttpClient`
- **前端 Component**：Standalone + Signals，使用 `ResponsiveTableComponent` 做列表
- **ID 慣例**：`uuid`，由 DB `gen_random_uuid()` 產生
- **Audit log**：重要操作寫入 `audit_logs`，需擴充 `resource_type` constraint

### 關鍵 FK 關係

```
academy_exams → organizations, campuses, subjects, ba_user
academy_exam_classes → academy_exams, classes
academy_scores → academy_exams, students, ba_user
term_exams → organizations
term_scores → term_exams, students, subjects, ba_user
```

---

## Task 1：DB Migration — 補習班考試表

- [ ] 建立 migration 檔案 `supabase/migrations/YYYYMMDDHHMMSS_create_academy_exams.sql`
- [ ] 建立 `academy_exam_status`、`academy_exam_type`、`score_status` enum
- [ ] 建立 `academy_exams` 表（含 index：org_id, campus_id, subject_id, exam_date, status）
- [ ] 建立 `academy_exam_classes` junction table
- [ ] 建立 `academy_scores` 表（含 index：exam_id, student_id；unique constraint）
- [ ] 不使用 RLS（與專案慣例一致）
- [ ] 更新 `audit_logs` resource_type constraint，加入 `'academy_exam'`
- [ ] 加入 `updated_at` trigger

### 驗證
```bash
supabase db reset  # 確認 migration 可執行
```

---

## Task 2：DB Migration — 段考表

- [ ] 建立 migration 檔案 `supabase/migrations/YYYYMMDDHHMMSS_create_term_exams.sql`
- [ ] 建立 `term_exam_period` enum
- [ ] 建立 `term_exams` 表（含 unique constraint：org × year × semester × period）
- [ ] 建立 `term_scores` 表（含 unique constraint：term_exam × student × subject）
- [ ] 加入 index（org_id, student_id, subject_id, term_exam_id）
- [ ] 更新 `audit_logs` resource_type constraint，加入 `'term_exam'`
- [ ] 加入 `updated_at` trigger
- [ ] 複用 Task 1 建的 `score_status` enum

### 驗證
```bash
supabase db reset  # 確認兩個 migration 都可執行
```

---

## Task 3：API — 補習班考試路由

建立 `apps/api/src/routes/academy-exams.ts`，提供以下端點：

### 考試事件 CRUD
- [ ] `GET /api/academy-exams` — 列表查詢（支援 search、status、campus_id、subject_id 篩選 + 分頁）
- [ ] `GET /api/academy-exams/:id` — 單筆查詢（含關聯班級 + 成績統計摘要）
- [ ] `POST /api/academy-exams` — 建立考試事件（含 classIds 陣列）
- [ ] `PUT /api/academy-exams/:id` — 更新考試事件（名稱、日期、狀態等）
- [ ] `DELETE /api/academy-exams/:id` — 刪除（僅限 draft 狀態）

### 成績登錄
- [ ] `GET /api/academy-exams/:id/scores` — 取得該場考試的所有成績（含學生資訊）
- [ ] `POST /api/academy-exams/:id/scores` — 批次登錄/更新成績（upsert by exam_id + student_id）
  - Body: `{ scores: [{ studentId, score, status, notes }] }`
  - 使用 `INSERT ... ON CONFLICT (exam_id, student_id) DO UPDATE`

### 考試事件狀態
- [ ] `PATCH /api/academy-exams/:id/publish` — 草稿 → 已發布
- [ ] `PATCH /api/academy-exams/:id/close` — 已發布 → 已結束

### 注意事項
- 使用 `@hono/zod-openapi` 定義 schema
- 所有查詢加 `org_id` 過濾
- 寫入操作記錄 audit log
- 掛載到主路由

---

## Task 4：API — 段考路由

建立 `apps/api/src/routes/term-exams.ts`，提供以下端點：

### 段考事件 CRUD
- [ ] `GET /api/term-exams` — 列表查詢（支援 academic_year、semester 篩選）
- [ ] `GET /api/term-exams/:id` — 單筆查詢（含成績統計摘要）
- [ ] `POST /api/term-exams` — 建立段考事件（academic_year + semester + period 自動產生 label）
- [ ] `PUT /api/term-exams/:id` — 更新
- [ ] `DELETE /api/term-exams/:id` — 刪除（僅限無成績紀錄時）

### 成績登錄
- [ ] `GET /api/term-exams/:id/scores` — 取得該段考的所有成績（含學生、科目資訊）
- [ ] `POST /api/term-exams/:id/scores` — 批次登錄/更新成績
  - Body: `{ scores: [{ studentId, subjectId, score, status, notes }] }`
  - 使用 `INSERT ... ON CONFLICT (term_exam_id, student_id, subject_id) DO UPDATE`

### 學生段考成績查詢
- [ ] `GET /api/term-exams/by-student/:studentId` — 取得某學生的所有段考成績（跨學期）

### 注意事項
- label 自動產生邏輯：`{academic_year} {semester === 1 ? '上' : '下'}學期 {periodLabel}`
- period label map：`midterm_1: '第一次段考'`, `final_1: '第一次期末考'`, `midterm_2: '第二次段考'`, `final_2: '第二次期末考'`

---

## Task 5：API — 成績查閱聚合路由

建立 `apps/api/src/routes/scores.ts`，提供統一的成績查詢入口：

- [ ] `GET /api/scores` — 聚合查詢，支援以下篩選：
  - `studentId` — 查某學生的所有成績
  - `type` — `'academy'` | `'term'`（篩選來源類型）
  - `subjectId` — 篩選科目
  - `dateFrom` / `dateTo` — 日期範圍
  - `search` — 模糊搜尋考試名稱或學生姓名
  - 分頁
- [ ] 回傳統一格式：
  ```typescript
  interface ScoreRecord {
    id: string;
    type: 'academy' | 'term';
    examName: string;
    examDate: string;         // academy_exams.exam_date 或 term_exams label
    studentId: string;
    studentName: string;
    subjectName: string | null;
    score: number | null;
    totalScore: number | null; // academy 才有
    status: 'scored' | 'absent' | 'makeup';
  }
  ```
- [ ] 使用 `UNION ALL` 合併 `academy_scores` + `term_scores` 查詢

---

## Task 6：API 測試

- [ ] `apps/api/src/routes/academy-exams.spec.ts` — 補習班考試 API 測試
  - 考試事件 CRUD 基本流程
  - 狀態轉換（draft → published → closed）
  - 成績批次登錄 upsert
  - 刪除限制（非 draft 不可刪）
  - org_id 隔離
- [ ] `apps/api/src/routes/term-exams.spec.ts` — 段考 API 測試
  - 段考事件 CRUD
  - unique constraint（同學年同學期同考次不可重複）
  - 成績登錄 upsert
  - 刪除限制（有成績時不可刪）
- [ ] `apps/api/src/routes/scores.spec.ts` — 聚合查詢測試
  - 跨類型查詢
  - 各篩選條件組合

### 驗證
```bash
npx vitest run apps/api/src/routes/academy-exams.spec.ts
npx vitest run apps/api/src/routes/term-exams.spec.ts
npx vitest run apps/api/src/routes/scores.spec.ts
```

---

## Task 7：前端 Service

### academy-exams.service.ts
- [ ] 建立 `apps/web/src/app/core/academy-exams.service.ts`
- [ ] `providedIn: 'root'`
- [ ] 方法：`list()`, `get()`, `create()`, `update()`, `delete()`, `publish()`, `close()`
- [ ] 方法：`getScores()`, `saveScores()`
- [ ] 定義型別：`AcademyExam`, `AcademyExamDetail`, `AcademyScore`, `AcademyExamStatus`, `AcademyExamType`

### term-exams.service.ts
- [ ] 建立 `apps/web/src/app/core/term-exams.service.ts`
- [ ] `providedIn: 'root'`
- [ ] 方法：`list()`, `get()`, `create()`, `update()`, `delete()`
- [ ] 方法：`getScores()`, `saveScores()`, `getByStudent()`
- [ ] 定義型別：`TermExam`, `TermScore`, `TermExamPeriod`

### scores.service.ts
- [ ] 建立 `apps/web/src/app/core/scores.service.ts`
- [ ] `providedIn: 'root'`
- [ ] 方法：`list()` — 統一查詢
- [ ] 定義型別：`ScoreRecord`

---

## Task 8：前端 — 補習班考試頁面（academy-exams）

實作 `apps/web/src/app/features/admin/pages/grades/academy-exams/`

### 列表頁
- [ ] 頁面 header：eyebrow「考務與成績」+ 標題 + 說明文字 + 「建立考試」按鈕
- [ ] 搜尋列：關鍵字搜尋 + 狀態篩選（全部/草稿/已發布/已結束）+ 科目篩選 + 分校篩選
- [ ] 使用 `ResponsiveTableComponent` 顯示列表
  - 欄位：考試名稱、類型（Tag）、科目、考試日期、關聯班級數、狀態（Tag）、操作
  - 操作選單（PopupMenu）：查看詳情、編輯、發布/結束、刪除
- [ ] 空狀態：使用 `EmptyStateComponent`
- [ ] 分頁

### 建立/編輯 Dialog
- [ ] 建立 `exam-form-dialog.component.ts`（shared 在 academy-exams 目錄內）
- [ ] 欄位：考試名稱、類型（select）、科目（select）、考試日期（datepicker）、滿分、範圍說明（textarea）、關聯班級（multi-select）
- [ ] 新增時預設狀態為 draft
- [ ] 使用 `DynamicDialog`

### 考試詳情 / 成績登錄 Dialog 或子頁
- [ ] 建立 `exam-detail-dialog.component.ts`
- [ ] 顯示考試基本資訊
- [ ] 成績表格：列出關聯班級的所有 active enrollment 學生
  - 欄位：學生姓名、班級、分數（可編輯 input）、狀態（scored/absent/makeup select）、備註
- [ ] 「儲存成績」按鈕 → 呼叫批次 upsert API
- [ ] 成績統計摘要：平均分、最高分、最低分、缺考人數

### 注意事項
- 使用 `InlineNoticeComponent` 顯示操作結果
- Skeleton loading
- 參考 `students.page.ts`、`sessions.page.ts` 的列表頁模式

---

## Task 9：前端 — 段考登錄頁面（term-exam-entry）

實作 `apps/web/src/app/features/admin/pages/grades/term-exam-entry/`

### 列表頁
- [ ] 頁面 header：eyebrow「考務與成績」+ 標題 + 說明文字 + 「建立段考」按鈕
- [ ] 篩選：學年度（select）+ 學期（select）
- [ ] 使用 `ResponsiveTableComponent` 顯示段考事件列表
  - 欄位：段考名稱、學年度、學期、考次、已登錄人數、操作
  - 操作：登錄成績、編輯、刪除
- [ ] 空狀態

### 建立/編輯 Dialog
- [ ] 建立 `term-exam-form-dialog.component.ts`
- [ ] 欄位：學年度（number input，預設當前學年）、學期（select: 上/下）、考次（select: 4 種 period）
- [ ] label 自動產生預覽
- [ ] 使用 `DynamicDialog`

### 成績登錄頁
- [ ] 建立 `term-score-entry-dialog.component.ts`
- [ ] 上方：段考資訊摘要
- [ ] 學生選擇：搜尋 + 年級篩選，選擇學生後顯示該學生的科目成績表
- [ ] 成績輸入表格：每個科目一行
  - 欄位：科目名稱、分數（input）、狀態（select）、備註
- [ ] 「儲存」→ 批次 upsert
- [ ] 已有成績的科目自動帶入現有值
- [ ] 批次模式：可選多個學生同時登錄同一科目

### 注意事項
- 學年度計算：台灣學年度 = 西元年 - 1911，如 2026 年 = 114 或 115 學年度
- 段考 period label 對應：`midterm_1` → 第一次段考、`final_1` → 第一次期末考、`midterm_2` → 第二次段考、`final_2` → 第二次期末考

---

## Task 10：前端 — 成績查閱頁面（score-records）

實作 `apps/web/src/app/features/admin/pages/grades/score-records/`

### 搜尋與篩選
- [ ] 頁面 header：eyebrow「考務與成績」+ 標題 + 說明文字
- [ ] 搜尋列：關鍵字搜尋（考試名稱或學生姓名）
- [ ] 篩選：評量類型（全部/補習班考試/段考）+ 科目 + 日期範圍
- [ ] 支援從學生詳情頁帶 `studentId` query param 進入（預設篩選該學生）

### 列表
- [ ] 使用 `ResponsiveTableComponent`
  - 欄位：考試/段考名稱（含類型 Tag）、學生姓名、科目、分數、狀態（Tag）
  - 分數顯示：academy 類型顯示 `score / totalScore`，term 類型只顯示 `score`
- [ ] 點擊考試名稱 → 跳轉到對應的考試詳情（academy-exams）或段考詳情（term-exam-entry）
- [ ] 點擊學生姓名 → 跳轉到學生詳情頁
- [ ] 空狀態
- [ ] 分頁

---

## Task 11：整合驗證

- [ ] `supabase db reset` 確認所有 migration 正確執行
- [ ] `npx vitest run` 確認所有 API 測試通過
- [ ] `npx ng build web` 確認前端編譯無錯誤
- [ ] `npx nx test web` 確認前端測試通過
- [ ] 手動驗證以下流程：
  1. 建立補習班考試（草稿）→ 關聯班級 → 發布 → 登錄成績 → 結束
  2. 建立段考事件 → 選學生 → 登錄各科成績
  3. 成績查閱頁搜尋學生 → 看到兩種類型成績 → 點擊跳轉
  4. Sidebar 導航正確，三個子頁面都可正常切換
