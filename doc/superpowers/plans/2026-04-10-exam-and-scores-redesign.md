# 考務與成績重構 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將考務與成績板塊從 3 頁（補習班考試 / 段考登錄 / 成績查閱）重構為 2 頁（考試管理 + 成績總覽），修正致命的成績登錄流程問題，將成績登錄從 dialog 改為子頁面。

**Architecture:** 後端修改 DB schema（移除 draft 狀態、新增 term_exams.exam_date/status）、修改 API（新增 reopen/closed 檢查、候選學生名單、成績摘要 API）。前端新建統一的考試管理頁（合併列表 + chip 篩選）、成績登錄子頁面（academy/term 兩套編輯器）、成績總覽頁（學生/班級雙視角）。舊的三個頁面目錄廢棄。

**Tech Stack:** Angular 21 (Signals + Standalone), PrimeNG 21, Hono + @hono/zod-openapi, Supabase PostgreSQL

**Spec:** `doc/superpowers/specs/2026-04-10-exam-and-scores-redesign.md`

---

## File Structure

### DB Migration (新增)

```
supabase/migrations/
└── 20260411000001_exam_redesign_schema.sql
```

### Backend API (修改)

```
apps/api/src/routes/
├── academy-exams.ts          ← 修改：移除 draft/publish，新增 reopen，closed 擋寫入，候選學生名單
├── term-exams.ts             ← 修改：新增 exam_date/status，close/reopen，closed 擋寫入，recent-students
├── scores.ts                 ← 修改：搜尋修正、DB 層 UNION ALL、student summary、class exam stats
```

### Frontend Services (修改)

```
apps/web/src/app/core/
├── academy-exams.service.ts  ← 修改：移除 publish()，新增 reopen()，修改 status 類型，新增 getCandidates()
├── term-exams.service.ts     ← 修改：新增 exam_date/status，close/reopen，getRecentStudents()，getScoresByStudent()
├── scores.service.ts         ← 修改：新增 getStudentSummary()，getClassExamStats()
```

### Frontend Pages (新增 + 廢棄)

```
apps/web/src/app/features/admin/pages/grades/
├── exams/                                        ← 新建：考試管理
│   ├── exams.component.ts/.html/.scss/.spec.ts
│   ├── academy-exam-form-dialog/                 ← 新建：補習班考試建立/編輯 dialog
│   │   └── academy-exam-form-dialog.component.ts/.html/.scss/.spec.ts
│   ├── term-exam-form-dialog/                    ← 新建：段考建立/編輯 dialog
│   │   └── term-exam-form-dialog.component.ts/.html/.scss/.spec.ts
│   └── score-entry/                              ← 新建：成績登錄子頁面
│       ├── score-entry.component.ts/.html/.scss/.spec.ts    ← 共用外框
│       ├── academy-score-editor/                             ← 補習班考試編輯器
│       │   └── academy-score-editor.component.ts/.html/.scss/.spec.ts
│       └── term-score-editor/                                ← 段考編輯器
│           └── term-score-editor.component.ts/.html/.scss/.spec.ts
├── overview/                                     ← 新建：成績總覽
│   ├── overview.component.ts/.html/.scss/.spec.ts
│   ├── student-view/                             ← 學生視角
│   │   └── student-view.component.ts/.html/.scss/.spec.ts
│   └── class-view/                               ← 班級視角
│       └── class-view.component.ts/.html/.scss/.spec.ts
```

### 廢棄目錄

```
apps/web/src/app/features/admin/pages/grades/
├── academy-exams/           ← 整個廢棄
├── term-exam-entry/         ← 整個廢棄
├── score-records/           ← 整個廢棄
```

### Route/Nav (修改)

```
apps/web/src/app/
├── app.routes.ts                                ← 修改路由
├── core/smart-enums/routes-catalog.ts           ← 修改導航
├── core/smart-enums/routes-catalog.spec.ts      ← 修改測試
```

---

## 執行者分工

| 角色 | 負責範圍 |
|------|---------|
| **Codex** (`sessionId: exam-redesign-impl`) | Task 1–5（DB migration、API 修改、API 測試） |
| **Claude Code** | Task 6–15（前端 service、前端頁面、路由、清理） |

---

## Task 1: DB Schema Migration 🤖 Codex

**執行者**: Codex（`sessionId: exam-redesign-impl`）

**Codex prompt 要點**:
- 讀取 `doc/superpowers/specs/2026-04-10-exam-and-scores-redesign.md` 第七節「DB Schema 變更」
- 讀取現有 migration: `supabase/migrations/20260410000001_create_academy_exams.sql` 和 `20260410000002_create_term_exams.sql`
- 使用 Supabase migration，檔案命名為 `20260411000001_exam_redesign_schema.sql`

**Files:**
- Create: `supabase/migrations/20260411000001_exam_redesign_schema.sql`

- [ ] **Step 1: 建立 migration 檔案**

```sql
-- ============================================================
-- 考務與成績重構 — Schema 變更
-- ============================================================

-- 1. academy_exam_status enum: 移除 draft，改預設為 active
--    PostgreSQL 不能直接 DROP enum value，需要重建 enum
ALTER TYPE public.academy_exam_status RENAME TO academy_exam_status_old;

CREATE TYPE public.academy_exam_status AS ENUM ('active', 'closed');

-- 先把現有 draft/published 都遷移到 active
ALTER TABLE public.academy_exams
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.academy_exams
  ALTER COLUMN status TYPE public.academy_exam_status
  USING (
    CASE status::text
      WHEN 'draft' THEN 'active'::public.academy_exam_status
      WHEN 'published' THEN 'active'::public.academy_exam_status
      WHEN 'closed' THEN 'closed'::public.academy_exam_status
    END
  );

ALTER TABLE public.academy_exams
  ALTER COLUMN status SET DEFAULT 'active';

DROP TYPE public.academy_exam_status_old;

-- 2. term_exams: 新增 exam_date 和 status
CREATE TYPE public.term_exam_status AS ENUM ('active', 'closed');

ALTER TABLE public.term_exams
  ADD COLUMN exam_date date,
  ADD COLUMN status public.term_exam_status NOT NULL DEFAULT 'active';

CREATE INDEX term_exams_exam_date_idx ON public.term_exams (exam_date);
CREATE INDEX term_exams_status_idx ON public.term_exams (status);
```

- [ ] **Step 2: 本地驗證 migration**

Run: `cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia && supabase db reset`
Expected: 所有 migration 成功，無錯誤

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260411000001_exam_redesign_schema.sql
git commit -m "feat(db): exam redesign schema — remove draft status, add term_exams.exam_date/status"
```

---

## Task 2: Academy Exams API 修改 🤖 Codex

**執行者**: Codex（`sessionId: exam-redesign-impl`）

**Codex prompt 要點**:
- 讀取 `doc/superpowers/specs/2026-04-10-exam-and-scores-redesign.md` 第八節
- 修改 `apps/api/src/routes/academy-exams.ts`
- 變更清單：
  1. `AcademyExamStatusSchema` 改為 `enum(['active', 'closed'])`
  2. `POST /` 建立考試：status 預設 active（移除 draft）
  3. `POST /:id/scores`：新增 closed 狀態檢查，拒絕 closed 考試寫入
  4. `GET /:id/scores`：改為候選學生名單（班級 enrollment ∪ 已有成績學生），LEFT JOIN 現有成績
  5. `PATCH /:id/publish`：移除此端點
  6. `PATCH /:id/close`：改為 active → closed（不再限制 published）
  7. `PATCH /:id/reopen`：新增，closed → active
  8. `DELETE /:id`：改為檢查「已登錄 = 0 筆」而非 draft 狀態
  9. `ensureExamOwnedByOrg` 的 status 類型改為 `'active' | 'closed'`

**Files:**
- Modify: `apps/api/src/routes/academy-exams.ts`

- [ ] **Step 1: 修改 enum 和 status schema**

把 `AcademyExamStatusSchema` 從 `enum(['draft', 'published', 'closed'])` 改為 `enum(['active', 'closed'])`。更新所有 TypeScript interface 中的 status 型別。

- [ ] **Step 2: 修改 POST /:id/scores — 加 closed 狀態檢查**

在 `upsertScoresRoute` handler 開頭，取得 exam 後加檢查：

```typescript
if (exam.status === 'closed') {
  return c.json({ error: '考試已結束，無法登錄成績', code: 'EXAM_CLOSED' }, 400);
}
```

- [ ] **Step 3: 修改 GET /:id/scores — 候選學生名單**

改為：
1. 取得考試關聯的所有 class_id
2. 查 enrollments（status = active）的 student_id ∪ academy_scores 已有成績的 student_id
3. LEFT JOIN academy_scores 帶出現有成績
4. 回傳完整候選名單（未登錄的學生 score 為 null, status 為 scored）

```typescript
// 1. 取得關聯班級
const { data: examClasses } = await supabase
  .from('academy_exam_classes')
  .select('class_id')
  .eq('exam_id', id);

const classIds = (examClasses ?? []).map((r) => r.class_id);

// 2. 從 enrollments 取得 active 學生
const { data: enrolledStudents } = await supabase
  .from('enrollments')
  .select('student_id, students(name, grade)')
  .in('class_id', classIds)
  .eq('status', 'active');

// 3. 取得已有成績的學生
const { data: scoredRows } = await supabase
  .from('academy_scores')
  .select('student_id, score, status, notes, updated_at, students(name, grade)')
  .eq('exam_id', id);

// 4. 合併：enrolled ∪ scored，LEFT JOIN 成績
const studentMap = new Map<string, { ... }>();
// ... merge logic
```

- [ ] **Step 4: 移除 PATCH /:id/publish 端點**

刪除 `publishRoute` 和 `app.openapi(publishRoute, ...)` 整段。

- [ ] **Step 5: 修改 PATCH /:id/close 和新增 PATCH /:id/reopen**

close 改為檢查 `status === 'active'`（不再限 published）。

新增 reopen：
```typescript
const reopenRoute = createRoute({
  method: 'patch',
  path: '/{id}/reopen',
  tags: ['AcademyExams'],
  summary: '重新開啟考試（closed -> active）',
  request: { params: z.object({ id: DbUuidSchema }) },
  responses: {
    200: { description: '更新成功', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
    400: { description: '狀態錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: '找不到資料', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(reopenRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const existing = await ensureExamOwnedByOrg(supabase, id, orgId);
  if (!existing) return c.json({ error: '找不到考試事件', code: 'NOT_FOUND' }, 404);
  if (existing.status !== 'closed') return c.json({ error: '僅 closed 可重新開啟', code: 'INVALID_STATUS' }, 400);

  const { error } = await supabase.from('academy_exams').update({ status: 'active' }).eq('id', id).eq('org_id', orgId);
  if (error) return c.json({ error: error.message, code: 'DB_ERROR' }, 400);

  logAudit(supabase, { orgId, userId, resourceType: 'academy_exam', resourceId: id, resourceName: existing.name, action: 'academy_exam.reopen' }, c.executionCtx.waitUntil.bind(c.executionCtx));
  return c.json({ success: true }, 200);
});
```

- [ ] **Step 6: 修改 DELETE — 改為檢查 scoreCount**

```typescript
// 取代原本的 draft 狀態檢查
const { count: scoreCount } = await supabase
  .from('academy_scores')
  .select('id', { count: 'exact', head: true })
  .eq('exam_id', id);

if ((scoreCount ?? 0) > 0) {
  return c.json({ error: '已有成績紀錄，無法刪除', code: 'HAS_SCORES' }, 400);
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/academy-exams.ts
git commit -m "feat(api): academy-exams redesign — active/closed status, candidate list, closed guard"
```

---

## Task 3: Term Exams API 修改 🤖 Codex

**執行者**: Codex（`sessionId: exam-redesign-impl`）

**Codex prompt 要點**:
- 讀取 spec 第八節「段考 API 修正」和「段考編輯器所需 API」
- 修改 `apps/api/src/routes/term-exams.ts`
- 變更清單：
  1. `CreateTermExamSchema` 和 `UpdateTermExamSchema` 新增 `examDate`
  2. `TermExamListItemSchema` 和 `TermExamDetailSchema` 新增 `examDate`, `status`
  3. `POST /` 建立時包含 exam_date
  4. `POST /:id/scores`：新增 closed 狀態檢查
  5. `GET /:id/scores`：支援 `?studentId=xxx` 參數
  6. `PATCH /:id/close`：新增
  7. `PATCH /:id/reopen`：新增
  8. `GET /:id/recent-students`：新增（該場段考已有成績紀錄的學生列表）
  9. `ensureTermExamOwnedByOrg` 回傳包含 status 的完整資料

**Files:**
- Modify: `apps/api/src/routes/term-exams.ts`

- [ ] **Step 1: 更新 schema 定義 — 新增 examDate 和 status**

`TermExamListItemSchema` 和 `TermExamDetailSchema` 都加上 `examDate: z.string().nullable()` 和 `status: z.enum(['active', 'closed'])`。

`CreateTermExamSchema` 加上 `examDate: z.string().date().optional()`。

`UpdateTermExamSchema` 加上 `examDate: z.string().date().nullable().optional()`。

- [ ] **Step 2: 修改 list 和 get 端點**

list 查詢加上 select `exam_date, status`，排序改為優先按 `exam_date DESC`。

get 回傳加上 `examDate` 和 `status`。

- [ ] **Step 3: 修改 create — 接受 examDate**

```typescript
const { data, error } = await supabase
  .from('term_exams')
  .insert({
    org_id: orgId,
    academic_year: body.academicYear,
    semester: body.semester,
    period: body.period,
    label,
    exam_date: body.examDate ?? null,
  })
  .select('id, label')
  .single();
```

- [ ] **Step 4: 新增 POST /:id/scores closed 檢查**

在 upsertScoresRoute handler 加：
```typescript
if (termExam.status === 'closed') {
  return c.json({ error: '段考已結束，無法登錄成績', code: 'EXAM_CLOSED' }, 400);
}
```

`ensureTermExamOwnedByOrg` 回傳要包含 `status`。

- [ ] **Step 5: GET /:id/scores — 支援 studentId 參數**

```typescript
const listScoresRoute = createRoute({
  // ...
  request: {
    params: z.object({ id: DbUuidSchema }),
    query: z.object({
      studentId: DbUuidSchema.optional(),
    }),
  },
  // ...
});

// handler 內：
const { studentId } = c.req.valid('query');
let query = supabase.from('term_scores').select('...').eq('term_exam_id', id);
if (studentId) {
  query = query.eq('student_id', studentId);
}
```

- [ ] **Step 6: 新增 PATCH /:id/close 和 PATCH /:id/reopen**

close: `active → closed`
reopen: `closed → active`
（與 academy-exams 的 close/reopen 結構相同）

- [ ] **Step 7: 新增 GET /:id/recent-students**

```typescript
const recentStudentsRoute = createRoute({
  method: 'get',
  path: '/{id}/recent-students',
  tags: ['TermExams'],
  summary: '該段考已有成績的學生列表（最近登錄優先）',
  request: { params: z.object({ id: DbUuidSchema }) },
  responses: {
    200: {
      description: '學生列表',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(z.object({
              studentId: z.uuid(),
              studentName: z.string(),
              studentGrade: z.string().nullable(),
              scoreCount: z.number().int(),
              lastUpdatedAt: z.string(),
            })),
          }),
        },
      },
    },
  },
});
```

Handler 邏輯：
1. 查 `term_scores` WHERE `term_exam_id = id`
2. GROUP BY `student_id`，取 `count(*)` 和 `max(updated_at)`
3. JOIN `students` 取 `name` 和 `grade`
4. ORDER BY `max(updated_at) DESC`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/term-exams.ts
git commit -m "feat(api): term-exams redesign — exam_date, status, close/reopen, recent-students"
```

---

## Task 4: Scores API 修改 🤖 Codex

**執行者**: Codex（`sessionId: exam-redesign-impl`）

**Codex prompt 要點**:
- 讀取 spec 第八節「成績查閱 API 修正」
- 修改 `apps/api/src/routes/scores.ts`
- 變更清單：
  1. 搜尋修正：`search` 同時搜學生名和考試名稱
  2. 段考日期修正：使用 `exam_date` 而非 `created_at`
  3. `GET /student/:studentId/summary`：新增學生成績摘要（各科平均）
  4. `GET /class/:classId/exam/:examId`：新增班級某場考試統計

**Files:**
- Modify: `apps/api/src/routes/scores.ts`

- [ ] **Step 1: 修正搜尋邏輯**

academy_scores 查詢：除了 `students.name ILIKE` 外，也加上 `academy_exams.name ILIKE`。
term_scores 查詢：除了 `students.name ILIKE` 外，也加上 `term_exams.label ILIKE`。

- [ ] **Step 2: 段考日期改用 exam_date**

term_scores 查詢中，select 加上 `term_exams.exam_date`，mapping 時改用 `exam.exam_date ?? exam.created_at?.split('T')[0]`（向後兼容 exam_date 為 null 的舊資料）。

- [ ] **Step 3: 新增 GET /student/:studentId/summary**

回傳格式：
```json
{
  "data": {
    "studentId": "...",
    "studentName": "...",
    "subjects": [
      { "subjectName": "數學", "academyAvg": 72.5, "termAvg": 85.0, "totalRecords": 5 }
    ]
  }
}
```

- [ ] **Step 4: 新增 GET /class/:classId/exam/:examId**

回傳格式：
```json
{
  "data": {
    "examId": "...",
    "examName": "...",
    "className": "...",
    "summary": { "averageScore": 72.3, "highestScore": 98, "lowestScore": 35, "absentCount": 2, "recordedCount": 28 },
    "scores": [
      { "studentId": "...", "studentName": "...", "score": 72, "status": "scored", "notes": null }
    ]
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/scores.ts
git commit -m "feat(api): scores redesign — search fix, student summary, class exam stats"
```

---

## Task 5: API 整合測試 🤖 Codex

**執行者**: Codex（`sessionId: exam-redesign-impl`）

**Codex prompt 要點**:
- 針對 Task 2–4 的 API 變更，撰寫或更新 spec 檔案
- 使用專案現有的測試模式（參考 `apps/api/src/routes/enrollments.spec.ts`）
- 測試重點：
  - closed 狀態拒絕寫入
  - 候選學生名單（enrolled ∪ scored）
  - reopen 端點
  - 刪除條件（有成績不可刪）
  - term_exams 的 exam_date 和 status
  - recent-students 端點
  - scores 搜尋修正

**Files:**
- Create or Modify: `apps/api/src/routes/academy-exams.spec.ts`
- Create or Modify: `apps/api/src/routes/term-exams.spec.ts`
- Modify: `apps/api/src/routes/scores.spec.ts`

- [ ] **Step 1: 撰寫 academy-exams 新增功能的測試**
- [ ] **Step 2: 撰寫 term-exams 新增功能的測試**
- [ ] **Step 3: 撰寫 scores 修正的測試**
- [ ] **Step 4: 執行測試確認通過**

Run: `cd apps/api && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/*.spec.ts
git commit -m "test(api): exam redesign API integration tests"
```

---

## Task 6: Frontend Services 更新

**執行者**: Claude Code

**Files:**
- Modify: `apps/web/src/app/core/academy-exams.service.ts`
- Modify: `apps/web/src/app/core/term-exams.service.ts`
- Modify: `apps/web/src/app/core/scores.service.ts`

- [ ] **Step 1: 更新 academy-exams.service.ts**

```typescript
// 1. 修改 status 類型
export type AcademyExamStatus = 'active' | 'closed';

// 2. 移除 publish() 方法

// 3. 新增 reopen() 方法
reopen(id: string): Observable<{ success: boolean }> {
  return this.http.patch<{ success: boolean }>(`${this.base}/${id}/reopen`, {});
}

// 4. 新增 getCandidates() — 候選學生名單（成績登錄用）
getCandidates(examId: string): Observable<{ data: AcademyScore[] }> {
  return this.http.get<{ data: AcademyScore[] }>(`${this.base}/${examId}/scores`);
}
// 注意：getScores 就是 getCandidates（API 同一端點），但語意區分
```

- [ ] **Step 2: 更新 term-exams.service.ts**

```typescript
// 1. TermExam interface 新增 examDate 和 status
export interface TermExam {
  // ...existing fields...
  examDate: string | null;
  status: 'active' | 'closed';
}

// 2. TermExamDetail interface 新增 examDate 和 status
export interface TermExamDetail {
  // ...existing fields...
  examDate: string | null;
  status: 'active' | 'closed';
}

// 3. CreateTermExamInput 新增 examDate
export interface CreateTermExamInput {
  academicYear: number;
  semester: 1 | 2;
  period: TermExamPeriod;
  examDate?: string;
}

// 4. 新增 close/reopen
close(id: string): Observable<{ success: boolean }> {
  return this.http.patch<{ success: boolean }>(`${this.base}/${id}/close`, {});
}

reopen(id: string): Observable<{ success: boolean }> {
  return this.http.patch<{ success: boolean }>(`${this.base}/${id}/reopen`, {});
}

// 5. 新增 getRecentStudents
export interface RecentStudent {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  scoreCount: number;
  lastUpdatedAt: string;
}

getRecentStudents(examId: string): Observable<{ data: RecentStudent[] }> {
  return this.http.get<{ data: RecentStudent[] }>(`${this.base}/${examId}/recent-students`);
}

// 6. getScores 支援 studentId 參數
getScores(examId: string, studentId?: string): Observable<{ data: TermScore[] }> {
  const params: Record<string, string> = {};
  if (studentId) params['studentId'] = studentId;
  return this.http.get<{ data: TermScore[] }>(`${this.base}/${examId}/scores`, { params });
}
```

- [ ] **Step 3: 更新 scores.service.ts**

```typescript
// 1. 新增 getStudentSummary
export interface SubjectAverage {
  subjectName: string;
  academyAvg: number | null;
  termAvg: number | null;
  totalRecords: number;
}

export interface StudentSummary {
  studentId: string;
  studentName: string;
  subjects: SubjectAverage[];
}

getStudentSummary(studentId: string): Observable<{ data: StudentSummary }> {
  return this.http.get<{ data: StudentSummary }>(`${this.base}/student/${studentId}/summary`);
}

// 2. 新增 getClassExamStats
export interface ClassExamScore {
  studentId: string;
  studentName: string;
  score: number | null;
  status: string;
  notes: string | null;
}

export interface ClassExamStats {
  examId: string;
  examName: string;
  className: string;
  summary: {
    averageScore: number | null;
    highestScore: number | null;
    lowestScore: number | null;
    absentCount: number;
    recordedCount: number;
  };
  scores: ClassExamScore[];
}

getClassExamStats(classId: string, examId: string): Observable<{ data: ClassExamStats }> {
  return this.http.get<{ data: ClassExamStats }>(`${this.base}/class/${classId}/exam/${examId}`);
}
```

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx nx test web --testPathPattern=core`
Expected: PASS（service 是純 HTTP 呼叫，不該 break）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/academy-exams.service.ts apps/web/src/app/core/term-exams.service.ts apps/web/src/app/core/scores.service.ts
git commit -m "feat(web): update exam/score services for redesign — new endpoints, status types"
```

---

## Task 7: Routes & Navigation 更新

**執行者**: Claude Code

**Files:**
- Modify: `apps/web/src/app/core/smart-enums/routes-catalog.ts`
- Modify: `apps/web/src/app/core/smart-enums/routes-catalog.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`

- [ ] **Step 1: 更新 routes-catalog.ts**

移除：
```typescript
public static readonly ADMIN_GRADES_ACADEMY_EXAMS = ...
public static readonly ADMIN_GRADES_TERM_ENTRY = ...
public static readonly ADMIN_GRADES_RECORDS = ...
```

新增：
```typescript
// Group: 考務與成績
public static readonly ADMIN_GRADES_EXAMS = this.register(
  'grades/exams',
  '/admin/grades/exams',
  '考試管理',
  UserType.ADMIN,
  'pi-megaphone',
  true,
  NavigationGroup.ADMIN_LEARNING_CENTER,
);
public static readonly ADMIN_GRADES_SCORE_ENTRY = this.register(
  'grades/exams/:type/:id/scores',
  '/admin/grades/exams/:type/:id/scores',
  '成績登錄',
  UserType.ADMIN,
  'pi-pencil',
  false,
  NavigationGroup.ADMIN_LEARNING_CENTER,
);
public static readonly ADMIN_GRADES_OVERVIEW = this.register(
  'grades/overview',
  '/admin/grades/overview',
  '成績總覽',
  UserType.ADMIN,
  'pi-table',
  true,
  NavigationGroup.ADMIN_LEARNING_CENTER,
);
```

- [ ] **Step 2: 更新 app.routes.ts**

```typescript
{
  path: RoutesCatalog.ADMIN_GRADES.relativePath,
  loadComponent: () =>
    import('@features/admin/pages/grades/grades.component').then((m) => m.GradesComponent),
  children: [
    {
      path: '',
      redirectTo: 'exams',
      pathMatch: 'full',
    },
    {
      path: 'exams',
      loadComponent: () =>
        import('@features/admin/pages/grades/exams/exams.component').then(
          (m) => m.ExamsComponent,
        ),
      data: { page: RoutesCatalog.ADMIN_GRADES_EXAMS },
    },
    {
      path: 'exams/:type/:id/scores',
      loadComponent: () =>
        import(
          '@features/admin/pages/grades/exams/score-entry/score-entry.component'
        ).then((m) => m.ScoreEntryComponent),
      data: { page: RoutesCatalog.ADMIN_GRADES_SCORE_ENTRY },
    },
    {
      path: 'overview',
      loadComponent: () =>
        import('@features/admin/pages/grades/overview/overview.component').then(
          (m) => m.OverviewComponent,
        ),
      data: { page: RoutesCatalog.ADMIN_GRADES_OVERVIEW },
    },
    // 舊路由 redirect
    { path: 'academy-exams', redirectTo: 'exams', pathMatch: 'full' },
    { path: 'term-exam-entry', redirectTo: 'exams', pathMatch: 'full' },
    { path: 'score-records', redirectTo: 'overview', pathMatch: 'full' },
  ],
},
```

- [ ] **Step 3: 更新 routes-catalog.spec.ts**

更新測試以反映新的路由項目。

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx nx test web --testPathPattern=routes-catalog`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/smart-enums/routes-catalog.ts apps/web/src/app/core/smart-enums/routes-catalog.spec.ts apps/web/src/app/app.routes.ts
git commit -m "feat(web): update routes and navigation for exam redesign — exams + overview"
```

---

## Task 8: 考試管理列表頁

**執行者**: Claude Code

**Files:**
- Create: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.ts`
- Create: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.html`
- Create: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.scss`
- Create: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.spec.ts`

**功能需求**（參考 spec 第四節）：
- 統一列表：合併 academy_exams + term_exams，用 chip 篩選類型（全部/補習班/段考）
- 篩選列：類型（chip）、校區（select）、科目（select）、狀態（select）
- 待辦提醒：active 且 scoreCount = 0 的考試數量
- 列表欄位：考試名稱、類型 Tag、日期、範圍、已登錄、狀態 Tag、操作 PopupMenu
- 操作選單：進入登錄、編輯基本資料、結束考試/重新開啟、刪除
- 建立考試按鈕：先選類型，再開對應 dialog
- 使用 `ResponsiveTableComponent`
- 考試名稱可點擊，導航到 `/admin/grades/exams/:type/:id/scores`

- [ ] **Step 1: 用 ng generate 建立 component**

Run: `cd apps/web && npx ng g c features/admin/pages/grades/exams --type component --skip-tests`

- [ ] **Step 2: 寫 spec 測試**

測試重點：
- 列表渲染（academy + term 混合）
- 類型 chip 篩選切換
- 待辦提醒顯示/隱藏
- 操作選單（closed 時顯示「重新開啟」，active 時顯示「結束考試」）

- [ ] **Step 3: 實作 component**

Signals：
- `examType = signal<'all' | 'academy' | 'term'>('all')`
- `campusId = signal<string | null>(null)`
- `subjectId = signal<string | null>(null)`
- `statusFilter = signal<'all' | 'active' | 'closed'>('all')`
- `academyExams = signal<AcademyExam[]>([])`
- `termExams = signal<TermExam[]>([])`
- `loading = signal(true)`
- `todoCount = computed(...)` — active 且 scoreCount=0 的考試數
- `mergedExams = computed(...)` — 合併兩種考試、排序、篩選

- [ ] **Step 4: 實作 template（BEM）**

- [ ] **Step 5: 實作 SCSS（BEM）**

- [ ] **Step 6: Run tests**

Run: `cd apps/web && npx nx test web --testPathPattern=exams.component`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/
git commit -m "feat(web): exam management list page — unified list with chip filter, todo reminder"
```

---

## Task 9: 建立考試 Dialogs

**執行者**: Claude Code

**Files:**
- Create: `apps/web/src/app/features/admin/pages/grades/exams/academy-exam-form-dialog/academy-exam-form-dialog.component.ts/.html/.scss/.spec.ts`
- Create: `apps/web/src/app/features/admin/pages/grades/exams/term-exam-form-dialog/term-exam-form-dialog.component.ts/.html/.scss/.spec.ts`

### Academy Exam Form Dialog

**表單欄位**：名稱、類型（小考/模擬考/分班考）、科目（select）、考試日期、滿分、範圍說明、關聯班級（必填 multi-select）

**模式**：建立 + 編輯共用，透過 `DynamicDialogConfig.data` 傳入 mode 和 examId

**Metadata 變更規則**（spec 第十節）：有成績時鎖定 examType/subjectId/totalScore/classIds

### Term Exam Form Dialog

**表單欄位**：學年度、學期、考次、考試日期

**模式**：建立 + 編輯共用

**Metadata 變更規則**：有成績時鎖定學年/學期/考次

- [ ] **Step 1: 用 ng generate 建立兩個 dialog component**

- [ ] **Step 2: 寫 spec 測試**

- [ ] **Step 3: 實作 academy-exam-form-dialog**

- [ ] **Step 4: 實作 term-exam-form-dialog**

- [ ] **Step 5: Run tests**

Run: `cd apps/web && npx nx test web --testPathPattern=exam-form-dialog`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/academy-exam-form-dialog/ apps/web/src/app/features/admin/pages/grades/exams/term-exam-form-dialog/
git commit -m "feat(web): exam create/edit dialogs — academy + term with metadata lock rules"
```

---

## Task 10: 成績登錄子頁面 — 共用外框

**執行者**: Claude Code

**Files:**
- Create: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.ts/.html/.scss/.spec.ts`

**功能**（spec 第五節「共用外框」）：
- 頂部「← 返回考試管理」breadcrumb
- 考試基本資訊（名稱、類型、科目、日期、關聯班級/—）
- 統計摘要（已登錄 N 筆、平均、最高、最低）
- 根據 route param `:type` 切換顯示 academy-score-editor 或 term-score-editor
- 底部「儲存成績」按鈕（disabled 當無變更或 closed）
- 離頁防呆（canDeactivate guard）

Signals：
- `type = signal<'academy' | 'term'>('academy')` — from route param
- `examId = signal('')` — from route param
- `exam = signal<AcademyExamDetail | TermExamDetail | null>(null)`
- `loading = signal(true)`
- `saving = signal(false)`
- `dirty = signal(false)`

- [ ] **Step 1: 用 ng generate 建立 component**
- [ ] **Step 2: 寫 spec 測試**
- [ ] **Step 3: 實作 component + template + SCSS**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.*
git commit -m "feat(web): score entry sub-page shell — breadcrumb, exam info, summary stats"
```

---

## Task 11: 補習班考試成績編輯器

**執行者**: Claude Code

**Files:**
- Create: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.ts/.html/.scss/.spec.ts`

**功能**（spec 第五節「補習班考試編輯器」）：
- 學生來源：關聯班級 active enrollments ∪ 已有成績學生（由 API 回傳候選名單）
- 班級篩選（多班時可切換）
- 名冊表格：學生、年級、分數（InputNumber）、狀態（Select）、備註（InputText）
- 分數 Tab 鍵連跳
- 缺考時 disable 分數欄位
- 已有成績自動帶入
- 儲存：只送有值的行，upsert

Signals：
- `candidates = signal<ScoreRow[]>([])`
- `classFilter = signal<string | null>(null)`
- `filteredRows = computed(...)` — 按班級篩選
- `dirty = signal(false)` — output to parent

- [ ] **Step 1: 用 ng generate 建立 component**
- [ ] **Step 2: 寫 spec 測試**
- [ ] **Step 3: 實作 component + template + SCSS**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/
git commit -m "feat(web): academy score editor — candidate list, inline scoring, class filter"
```

---

## Task 12: 段考成績編輯器

**執行者**: Claude Code

**Files:**
- Create: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.ts/.html/.scss/.spec.ts`

**功能**（spec 第五節「段考編輯器」）：
- 學生來源：系統全部 active 學生，需良好搜尋/篩選 UX
- 搜尋 UX：
  1. 搜尋框（姓名模糊搜尋，2 字開始過濾）
  2. 年級 chip 篩選（P1-P6, J1-J3, S1-S3）
  3. 校區 select 篩選
  4. 最近登錄：已有成績的學生列在上方（用 getRecentStudents API）
- Accordion 風格：點學生 → 展開科目成績表
- 科目列表從系統科目管理拉取
- 支援同時展開多個學生
- 儲存：統一底部「儲存成績」按鈕

Signals：
- `searchTerm = signal('')`
- `gradeFilter = signal<string | null>(null)`
- `campusFilter = signal<string | null>(null)`
- `recentStudents = signal<RecentStudent[]>([])`
- `searchResults = signal<Student[]>([])`
- `expandedStudents = signal<Set<string>>(new Set())`
- `studentScores = signal<Map<string, TermScoreRow[]>>(new Map())`
- `subjects = signal<Subject[]>([])`
- `dirty = signal(false)`

- [ ] **Step 1: 用 ng generate 建立 component**
- [ ] **Step 2: 寫 spec 測試**
- [ ] **Step 3: 實作 component + template + SCSS**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/
git commit -m "feat(web): term score editor — student search, grade chips, accordion, multi-subject"
```

---

## Task 13: 成績總覽頁

**執行者**: Claude Code

**Files:**
- Create: `apps/web/src/app/features/admin/pages/grades/overview/overview.component.ts/.html/.scss/.spec.ts`
- Create: `apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.ts/.html/.scss/.spec.ts`
- Create: `apps/web/src/app/features/admin/pages/grades/overview/class-view/class-view.component.ts/.html/.scss/.spec.ts`

**功能**（spec 第六節）：

### overview.component
- SegmentedControl 切換：學生視角 / 班級視角
- 根據視角顯示對應子元件

### student-view.component
- 搜尋/選擇學生
- 顯示該生各科平均分
- 成績紀錄列表（日期、考試名稱、類型、科目、分數），按日期倒排
- 篩選：考試類型、學年學期

### class-view.component
- 先選班級 → 再選考試事件
- 顯示全班成績統計 + 學生明細
- 僅適用補習班考試

- [ ] **Step 1: 用 ng generate 建立 3 個 component**
- [ ] **Step 2: 寫 spec 測試**
- [ ] **Step 3: 實作 overview + student-view + class-view**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/overview/
git commit -m "feat(web): score overview page — student view + class view with segmented control"
```

---

## Task 14: 整合測試 & 驗收

**執行者**: Claude Code

- [ ] **Step 1: Run 全部前端測試**

Run: `cd apps/web && npx nx test web`
Expected: All tests pass

- [ ] **Step 2: Run 前端 build**

Run: `cd apps/web && npx nx build web`
Expected: Build succeeds

- [ ] **Step 3: 驗證路由**

手動啟動 dev server 確認：
- `/admin/grades/exams` 顯示考試管理列表
- `/admin/grades/exams/academy/:id/scores` 顯示補習班成績登錄
- `/admin/grades/exams/term/:id/scores` 顯示段考成績登錄
- `/admin/grades/overview` 顯示成績總覽
- 舊路由 redirect 正確

- [ ] **Step 4: Commit（如有修正）**

---

## Task 15: 清理舊頁面

**執行者**: Claude Code

**Files:**
- Delete: `apps/web/src/app/features/admin/pages/grades/academy-exams/` (entire directory)
- Delete: `apps/web/src/app/features/admin/pages/grades/term-exam-entry/` (entire directory)
- Delete: `apps/web/src/app/features/admin/pages/grades/score-records/` (entire directory)

- [ ] **Step 1: 確認新頁面完全取代舊頁面功能**

- [ ] **Step 2: 刪除舊目錄**

```bash
rm -rf apps/web/src/app/features/admin/pages/grades/academy-exams/
rm -rf apps/web/src/app/features/admin/pages/grades/term-exam-entry/
rm -rf apps/web/src/app/features/admin/pages/grades/score-records/
```

- [ ] **Step 3: 確認無殘留 import**

搜尋 codebase 確認沒有對舊目錄的 import 引用。

- [ ] **Step 4: Run 全部測試**

Run: `cd apps/web && npx nx test web && npx nx build web`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(web): remove deprecated exam/score pages — academy-exams, term-exam-entry, score-records"
```

---

## Codex 委派執行指引

### 啟動 Codex 進行 Task 1–5

使用 `sessionId: exam-redesign-impl` 確保連續上下文。

**第一次呼叫 prompt 模板**：

```
sessionId: exam-redesign-impl

你是 Clessia 專案的後端開發者。這是一個補習班管理系統，後端用 Hono + @hono/zod-openapi，DB 用 Supabase PostgreSQL。

請閱讀以下文件了解完整設計：
- `doc/superpowers/specs/2026-04-10-exam-and-scores-redesign.md` — 完整重構設計
- `doc/superpowers/plans/2026-04-10-exam-and-scores-redesign.md` — 實作計劃（你負責 Task 1–5）

現有程式碼：
- `supabase/migrations/20260410000001_create_academy_exams.sql` — 現有 academy schema
- `supabase/migrations/20260410000002_create_term_exams.sql` — 現有 term schema
- `apps/api/src/routes/academy-exams.ts` — 現有 academy API
- `apps/api/src/routes/term-exams.ts` — 現有 term API
- `apps/api/src/routes/scores.ts` — 現有 scores API

請開始執行 Task 1: DB Schema Migration。完成後告訴我結果，我會指示你繼續 Task 2。

Tech Stack: Hono, @hono/zod-openapi, Supabase JS client, TypeScript
Angular 版本: 21, Node: 20+
```

**後續呼叫**：`繼續執行 Task N`（靠 sessionId 延續上下文）

### 注意事項

- 每個 Task 完成後要 review Codex 的產出再繼續
- 如果 Codex 的實作與 spec 有出入，以 spec 為準
- Task 5 的測試要確認能跑過再進入前端 Task 6
