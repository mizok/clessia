# Schools Entity + Term Exam Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將「就讀學校」從 `students.school` text 欄位升級為正式 entity，並讓段考支援「多所學校各自考試日期」的排程模型。

**Architecture:**
1. 新增 `schools` 表（org 內的就讀學校 entity），`students` 改用 `school_id` 外鍵
2. 新增 `term_exam_schedules(term_exam_id, school_id, exam_date)` junction，取代 `term_exams.exam_date` 單一欄位
3. 成績摘要 API 計算「最近段考之後的補習班考試」時，改以學生就讀學校對應的 schedule 日期為 cycle cutoff
4. 前端補 `/admin/schools` 管理頁、段考建立對話框改為多學校多日期輸入、學生表單下拉選擇學校

**Tech Stack:** Supabase (PostgreSQL migration) · Hono + zod-openapi (API) · Angular 21 Signals + PrimeNG 21 (Web) · Vitest（測試）

**Scope out of this plan:**
- 同學校不同年級不同考試日期（目前暫不支援，若未來需要再擴 schedule 維度）
- 歷史資料合併工具（專案尚未上線，種子資料用 migration 一次處理）
- 家長 / 老師介面對 school 的顯示（本次只改 admin）

---

## File Structure

**DB migrations（新建）**
- `supabase/migrations/20260421000001_create_schools.sql` — schools 表 + students.school_id FK
- `supabase/migrations/20260421000002_create_term_exam_schedules.sql` — term_exam_schedules 表
- `supabase/migrations/20260421000003_seed_schools_from_students.sql` — 從現有 `students.school` 去重種子 + 回填 `school_id`，最後 drop `students.school` text 欄位

**API（新建）**
- `apps/api/src/routes/schools.ts` — /schools CRUD
- `apps/api/src/routes/schools.spec.ts` — 純函式單元測試

**API（修改）**
- `apps/api/src/index.ts` — 註冊 schools 路由
- `apps/api/src/routes/students.ts` — 改用 school relation、接受 `schoolId`
- `apps/api/src/routes/students.spec.ts` — 調整現有測試
- `apps/api/src/routes/term-exams.ts` — 拆 `examDate` 到 schedules、list/detail 回傳 schedules
- `apps/api/src/routes/scores.ts` — student summary 用學生 school 對應的 schedule 日期

**Web core（新建）**
- `apps/web/src/app/core/schools.service.ts` — SchoolsService

**Web core（修改）**
- `apps/web/src/app/core/students.service.ts` — Student type：`school: { id; name } | null`
- `apps/web/src/app/core/term-exams.service.ts` — TermExamDetail：加 `schedules[]`

**Web features（新建）**
- `apps/web/src/app/features/admin/pages/schools/schools.page.ts|.html|.scss`
- `apps/web/src/app/features/admin/pages/schools/school-form-dialog.component.ts|.html|.scss`

**Web features（修改）**
- `apps/web/src/app/app.routes.ts` — 加 `/admin/schools` lazy route
- `apps/web/src/app/core/smart-enums/routes-catalog.ts` — ADMIN_SCHOOLS 註冊
- `apps/web/src/app/features/admin/pages/students/student-form-dialog.component.ts|.html` — school 改為 p-select
- `apps/web/src/app/features/admin/pages/students/students.page.html` — 顯示 `s.school?.name`
- `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.html` — 顯示 `student.school?.name`
- `apps/web/src/app/features/admin/pages/grades/exams/term-exam-form-dialog/*` — schedule 編輯 UI
- `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.ts|.html` — header 顯示所選 filter 對應學校的日期
- `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.ts|.html` — 加 school filter
- `apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.ts` — summary 顯示資料沿用 API 結果（API 已更新計算基準）

**規則**
- DB migration 用 `YYYYMMDDHHMMSS` 命名，與既有格式一致
- API 純函式（如 buildScheduleByStudent）抽出便於 Vitest 測試
- 前端 component/service 用 `ng generate`，遵守 `.component.ts / .component.html` 後綴
- 每個 task 獨立可 commit，commit message 前綴 `feat(schools):` / `feat(term-exams):` / `feat(web):` / `fix(...)`

---

## Phase 1 — Schema

### Task 1: Create `schools` table + link students

**Files:**
- Create: `supabase/migrations/20260421000001_create_schools.sql`

- [ ] **Step 1: 撰寫 migration**

```sql
-- ============================================================
-- schools：就讀學校 entity（取代 students.school 自由文字）
-- ============================================================
CREATE TABLE public.schools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  short_name  text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX schools_org_id_idx ON public.schools (org_id);
CREATE INDEX schools_is_active_idx ON public.schools (is_active);

CREATE TRIGGER schools_updated_at
  BEFORE UPDATE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- students 加上 school_id FK（先 nullable，後續 migration 回填後可視情況設 NOT NULL）
ALTER TABLE public.students
  ADD COLUMN school_id uuid REFERENCES public.schools(id) ON DELETE RESTRICT;

CREATE INDEX students_school_id_idx ON public.students (school_id);

-- audit_logs resource_type 加入 'school'
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_resource_type_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (
    resource_type IN (
      'class','course','campus','staff','session','student','parent',
      'enrollment','attendance','leave','academy_exam','term_exam','school'
    )
  );
```

- [ ] **Step 2: 執行 migration**

Run: `cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia && supabase db reset`
Expected: reset 完成、schools 表建立、students 多了 school_id 欄位、無錯誤。

- [ ] **Step 3: 驗證 schema**

Run: `supabase db diff --schema public | head -60`
Expected: 看到 `schools` 表與 `students.school_id` 欄位。

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260421000001_create_schools.sql
git commit -m "feat(db): add schools entity and students.school_id FK"
```

---

### Task 2: Create `term_exam_schedules` table

**Files:**
- Create: `supabase/migrations/20260421000002_create_term_exam_schedules.sql`

- [ ] **Step 1: 撰寫 migration**

```sql
-- ============================================================
-- term_exam_schedules：段考依學校各自的考試日期
-- 取代 term_exams.exam_date 單一欄位
-- ============================================================
CREATE TABLE public.term_exam_schedules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_exam_id  uuid NOT NULL REFERENCES public.term_exams(id) ON DELETE CASCADE,
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  exam_date     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_exam_id, school_id)
);

CREATE INDEX term_exam_schedules_term_exam_id_idx
  ON public.term_exam_schedules (term_exam_id);
CREATE INDEX term_exam_schedules_school_id_idx
  ON public.term_exam_schedules (school_id);
CREATE INDEX term_exam_schedules_exam_date_idx
  ON public.term_exam_schedules (exam_date);

CREATE TRIGGER term_exam_schedules_updated_at
  BEFORE UPDATE ON public.term_exam_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

- [ ] **Step 2: 執行並驗證**

Run: `supabase db reset`
Expected: `term_exam_schedules` 表建立成功。

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000002_create_term_exam_schedules.sql
git commit -m "feat(db): add term_exam_schedules junction table"
```

---

### Task 3: Seed schools from existing students + drop `students.school`

**Files:**
- Create: `supabase/migrations/20260421000003_seed_schools_from_students.sql`

- [ ] **Step 1: 撰寫 migration（去重種子 + 回填 + drop）**

```sql
-- ============================================================
-- 從 students.school 自由文字建立 schools 種子，並回填 school_id
-- 完成後把原本的 school text 欄位移除
-- （專案尚未上線，此為一次性資料遷移）
-- ============================================================

-- 1. 每個 (org_id, TRIM(school)) 建一筆 schools（已存在則跳過）
INSERT INTO public.schools (org_id, name)
SELECT DISTINCT org_id, TRIM(school)
FROM public.students
WHERE school IS NOT NULL AND TRIM(school) <> ''
ON CONFLICT (org_id, name) DO NOTHING;

-- 2. 把 students.school_id 回填為對應 schools.id
UPDATE public.students AS s
SET school_id = sc.id
FROM public.schools sc
WHERE sc.org_id = s.org_id
  AND sc.name = TRIM(s.school);

-- 3. 確認沒有漏掉的 students（允許 school_id 為 NULL，因此不強制 100%）
DO $$
DECLARE
  missing integer;
BEGIN
  SELECT COUNT(*) INTO missing
  FROM public.students
  WHERE school_id IS NULL
    AND school IS NOT NULL
    AND TRIM(school) <> '';
  IF missing > 0 THEN
    RAISE EXCEPTION 'Seed failed: % students have non-empty school but no school_id', missing;
  END IF;
END$$;

-- 4. 移除 students.school 文字欄位
ALTER TABLE public.students DROP COLUMN school;
```

- [ ] **Step 2: 執行並驗證**

Run: `supabase db reset`
Expected: reset 完成、無 `RAISE EXCEPTION`、`students.school` 欄位不存在、`students.school_id` 皆有值。

- [ ] **Step 3: 手動查核**

Run:
```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "SELECT COUNT(*) AS schools FROM public.schools; SELECT COUNT(*) FILTER (WHERE school_id IS NOT NULL) AS linked, COUNT(*) AS total FROM public.students;"
```
Expected: schools 數量 > 0；linked = total（或僅少量未 link 的 edge case）。

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260421000003_seed_schools_from_students.sql
git commit -m "feat(db): seed schools from students.school and drop text column"
```

---

## Phase 2 — Schools API

### Task 4: `buildSchoolListQuery` + 純函式測試

**Files:**
- Create: `apps/api/src/routes/schools.ts`
- Create: `apps/api/src/routes/schools.spec.ts`

- [ ] **Step 1: 先寫測試**

```ts
// apps/api/src/routes/schools.spec.ts
import { describe, expect, it } from 'vitest';
import * as schoolsRoute from './schools';

const buildSchoolListQuery = (schoolsRoute as Record<string, unknown>)[
  'buildSchoolListQuery'
] as
  | ((params: { search?: string; isActive?: boolean }) => {
      searchFilter: string | null;
      isActiveFilter: boolean | null;
    })
  | undefined;

describe('buildSchoolListQuery', () => {
  it('returns nulls when no filters', () => {
    expect(buildSchoolListQuery?.({})).toEqual({
      searchFilter: null,
      isActiveFilter: null,
    });
  });

  it('builds search ilike with name + short_name', () => {
    expect(buildSchoolListQuery?.({ search: '明湖' })).toEqual({
      searchFilter: 'name.ilike.%明湖%,short_name.ilike.%明湖%',
      isActiveFilter: null,
    });
  });

  it('passes through isActive', () => {
    expect(buildSchoolListQuery?.({ isActive: true })).toEqual({
      searchFilter: null,
      isActiveFilter: true,
    });
  });
});
```

- [ ] **Step 2: 執行測試並確認失敗**

Run: `cd apps/api && npx vitest run src/routes/schools.spec.ts`
Expected: FAIL — `Cannot find module './schools'`。

- [ ] **Step 3: 撰寫 schools.ts 骨架 + 純函式**

```ts
// apps/api/src/routes/schools.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';

export function buildSchoolListQuery(params: { search?: string; isActive?: boolean }): {
  searchFilter: string | null;
  isActiveFilter: boolean | null;
} {
  const search = params.search?.trim();
  const searchFilter = search
    ? `name.ilike.%${search}%,short_name.ilike.%${search}%`
    : null;
  const isActiveFilter = params.isActive ?? null;
  return { searchFilter, isActiveFilter };
}

const app = new OpenAPIHono<AppEnv>();
export default app;
```

- [ ] **Step 4: 執行測試並確認通過**

Run: `cd apps/api && npx vitest run src/routes/schools.spec.ts`
Expected: 3 tests PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/schools.ts apps/api/src/routes/schools.spec.ts
git commit -m "feat(api): add schools route skeleton and buildSchoolListQuery"
```

---

### Task 5: `GET /schools` list endpoint

**Files:**
- Modify: `apps/api/src/routes/schools.ts`

- [ ] **Step 1: 在 schools.ts 中補上 list 路由**

附加到 `schools.ts`：

```ts
const SchoolSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  shortName: z.string().nullable(),
  isActive: z.boolean(),
  studentCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).openapi('School');

const ErrorSchema = z.object({ error: z.string(), code: z.string().optional() }).openapi('SchoolError');

const ListResponseSchema = z.object({
  data: z.array(SchoolSchema),
  meta: z.object({ total: z.number().int().min(0) }),
}).openapi('SchoolListResponse');

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Schools'],
  summary: '列出就讀學校',
  request: {
    query: z.object({
      search: z.string().optional(),
      isActive: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: ListResponseSchema } } },
    400: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(listRoute, async (c) => {
  const orgId = c.get('orgId');
  const supabase = c.get('supabase');
  const { search, isActive } = c.req.valid('query');
  const { searchFilter, isActiveFilter } = buildSchoolListQuery({ search, isActive });

  let query = supabase
    .from('schools')
    .select('id, name, short_name, is_active, created_at, updated_at, students(count)', { count: 'exact' })
    .eq('org_id', orgId)
    .order('name', { ascending: true });

  if (searchFilter) query = query.or(searchFilter);
  if (isActiveFilter !== null) query = query.eq('is_active', isActiveFilter);

  const { data, error, count } = await query;
  if (error) return c.json({ error: error.message, code: 'DB_ERROR' }, 400);

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    shortName: r.short_name,
    isActive: r.is_active,
    studentCount: Array.isArray(r.students) ? (r.students[0]?.count ?? 0) : 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return c.json({ data: rows, meta: { total: count ?? rows.length } }, 200);
});
```

- [ ] **Step 2: 註冊路由**

修改 `apps/api/src/index.ts`：在既有 route 註冊（例如 campuses 之後）加一行：

```ts
import schoolsRoute from './routes/schools';
// ... 其他路由註冊後：
app.route('/schools', schoolsRoute);
```

- [ ] **Step 3: 啟動開發伺服器手動測試**

Run: `cd apps/api && npm run dev`（或依專案既有 script）
開啟 OpenAPI 文件檢查 `/schools` 是否出現；curl 測試：
```bash
curl -H "Authorization: Bearer <token>" http://localhost:8787/schools
```
Expected: 200 with `{ data: [...], meta: { total } }`。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/schools.ts apps/api/src/index.ts
git commit -m "feat(api): GET /schools list endpoint with counts"
```

---

### Task 6: `POST /schools`、`PATCH /schools/:id`、`DELETE /schools/:id`

**Files:**
- Modify: `apps/api/src/routes/schools.ts`

- [ ] **Step 1: 先寫 create/update/delete 路由**

附加到 `schools.ts`：

```ts
const CreateSchoolSchema = z.object({
  name: z.string().min(1).max(100),
  shortName: z.string().max(20).nullable().optional(),
  isActive: z.boolean().optional(),
}).openapi('CreateSchool');

const UpdateSchoolSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  shortName: z.string().max(20).nullable().optional(),
  isActive: z.boolean().optional(),
}).openapi('UpdateSchool');

const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['Schools'],
  summary: '建立學校',
  request: { body: { content: { 'application/json': { schema: CreateSchoolSchema } } } },
  responses: {
    201: { description: '建立成功', content: { 'application/json': { schema: z.object({ data: SchoolSchema }) } } },
    409: { description: '名稱重複', content: { 'application/json': { schema: ErrorSchema } } },
    400: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(createRouteDef, async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const supabase = c.get('supabase');
  const body = c.req.valid('json');

  const { data, error } = await supabase
    .from('schools')
    .insert({
      org_id: orgId,
      name: body.name.trim(),
      short_name: body.shortName?.trim() || null,
      is_active: body.isActive ?? true,
    })
    .select('id, name, short_name, is_active, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') return c.json({ error: '學校名稱重複', code: 'DUPLICATE' }, 409);
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    { orgId, userId, resourceType: 'school', resourceId: data.id, resourceName: data.name, action: 'school.create', details: {} },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json(
    {
      data: {
        id: data.id,
        name: data.name,
        shortName: data.short_name,
        isActive: data.is_active,
        studentCount: 0,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    },
    201,
  );
});

const updateRouteDef = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Schools'],
  summary: '更新學校',
  request: {
    params: z.object({ id: DbUuidSchema }),
    body: { content: { 'application/json': { schema: UpdateSchoolSchema } } },
  },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
    404: { description: '找不到', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: '名稱重複', content: { 'application/json': { schema: ErrorSchema } } },
    400: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(updateRouteDef, async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const supabase = c.get('supabase');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const payload: Record<string, unknown> = {};
  if (body.name !== undefined) payload['name'] = body.name.trim();
  if (body.shortName !== undefined) payload['short_name'] = body.shortName?.trim() || null;
  if (body.isActive !== undefined) payload['is_active'] = body.isActive;
  if (Object.keys(payload).length === 0) return c.json({ success: true }, 200);

  const { data, error } = await supabase
    .from('schools')
    .update(payload)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id, name')
    .single();

  if (error) {
    if (error.code === '23505') return c.json({ error: '學校名稱重複', code: 'DUPLICATE' }, 409);
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }
  if (!data) return c.json({ error: '找不到學校', code: 'NOT_FOUND' }, 404);

  logAudit(
    supabase,
    { orgId, userId, resourceType: 'school', resourceId: id, resourceName: data.name, action: 'school.update', details: payload },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json({ success: true }, 200);
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Schools'],
  summary: '刪除學校（需無學生關聯）',
  request: { params: z.object({ id: DbUuidSchema }) },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
    404: { description: '找不到', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: '仍有學生關聯', content: { 'application/json': { schema: ErrorSchema } } },
    400: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(deleteRouteDef, async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const supabase = c.get('supabase');
  const { id } = c.req.valid('param');

  // 檢查是否仍有學生 / schedule 關聯
  const { count: studentCount } = await supabase
    .from('students').select('id', { count: 'exact', head: true }).eq('school_id', id);
  if ((studentCount ?? 0) > 0) {
    return c.json({ error: '此學校仍有學生關聯，無法刪除', code: 'CONSTRAINT' }, 409);
  }
  const { count: scheduleCount } = await supabase
    .from('term_exam_schedules').select('id', { count: 'exact', head: true }).eq('school_id', id);
  if ((scheduleCount ?? 0) > 0) {
    return c.json({ error: '此學校仍有段考排程，無法刪除', code: 'CONSTRAINT' }, 409);
  }

  const { data, error } = await supabase
    .from('schools').delete().eq('id', id).eq('org_id', orgId).select('id, name').single();

  if (error) return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  if (!data) return c.json({ error: '找不到學校', code: 'NOT_FOUND' }, 404);

  logAudit(
    supabase,
    { orgId, userId, resourceType: 'school', resourceId: id, resourceName: data.name, action: 'school.delete', details: {} },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );
  return c.json({ success: true }, 200);
});
```

- [ ] **Step 2: 手動測試**

Run dev server，用 curl 建一筆：
```bash
curl -X POST http://localhost:8787/schools -H "Content-Type: application/json" -H "Authorization: Bearer <token>" -d '{"name":"測試國中"}'
```
Expected: 201 with data。重複建立 → 409。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/schools.ts
git commit -m "feat(api): schools create/update/delete with guards"
```

---

## Phase 3 — Students API

### Task 7: Students 改用 school relation

**Files:**
- Modify: `apps/api/src/routes/students.ts`
- Modify: `apps/api/src/routes/students.spec.ts`

- [ ] **Step 1: 調整 zod schema**

將 `school: z.string()` 從 student schema 中拿掉，改為：
```ts
school: z.object({ id: z.uuid(), name: z.string(), shortName: z.string().nullable() }).nullable(),
```

create/update 的 input 改為：
```ts
schoolId: z.uuid().nullable().optional(),
```

- [ ] **Step 2: 調整 SELECT 與回傳 mapping**

將 list / detail / create 的 SELECT 加上 `schools(id, name, short_name)`，去掉 `school`：
```ts
.select('..., schools(id, name, short_name), ...')
```
Mapping：
```ts
school: row.schools
  ? { id: row.schools.id, name: row.schools.name, shortName: row.schools.short_name }
  : null,
```

- [ ] **Step 3: 調整 search 子句**

原本 `name.ilike.%..%,school.ilike.%..%,id.in.(..)` → 改成只搜 name / id.in。學校搜尋改為前端用 `schoolId` 過濾。
若需要保留「跨欄位搜尋」，可在 backend 先查符合 name 的 schools、再把結果 ID 用 `school_id.in.(...)` 組進查詢。初版先只搜 name。

- [ ] **Step 4: 更新 create / update 處理**

```ts
// create 中
school_id: body.schoolId ?? null,
// update 中
if (body.schoolId !== undefined) updatePayload['school_id'] = body.schoolId;
```

- [ ] **Step 5: 調整現有 students.spec.ts**

若既有測試呼叫的純函式 signature / 回傳 shape 有改，同步調整。Run：
```bash
cd apps/api && npx vitest run src/routes/students.spec.ts
```
Expected: 全數 PASS。

- [ ] **Step 6: 啟動 dev 手動驗證**

Run dev server，curl `/students` 檢查回傳含 `school: { id, name, shortName }`。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/students.ts apps/api/src/routes/students.spec.ts
git commit -m "feat(api): students use school relation via school_id"
```

---

## Phase 4 — Term Exams API

### Task 8: Term exam schedules 寫入與回傳

**Files:**
- Modify: `apps/api/src/routes/term-exams.ts`

- [ ] **Step 1: 在 schema 加入 schedules 結構**

```ts
const TermExamScheduleSchema = z.object({
  schoolId: z.uuid(),
  schoolName: z.string(),
  examDate: z.string().nullable(),
}).openapi('TermExamSchedule');

// TermExamDetailSchema 中加入：
schedules: z.array(TermExamScheduleSchema),

// CreateTermExamSchema / UpdateTermExamSchema 中加入：
schedules: z.array(z.object({
  schoolId: z.uuid(),
  examDate: z.string().date().nullable().optional(),
})).optional(),
```

原本 top-level 的 `examDate` 欄位標記為 deprecated，保留讀取（為了 list summary 顯示「平均日期」或「最早日期」），但 create/update 不再寫入（若傳入則忽略）。

- [ ] **Step 2: 修改 create handler**

insert term_exams 時不再寫 exam_date。insert 成功後，對 `body.schedules ?? []` 做 bulk insert 到 `term_exam_schedules`。

```ts
if (body.schedules && body.schedules.length > 0) {
  const { error: schedErr } = await supabase.from('term_exam_schedules').insert(
    body.schedules.map((s) => ({
      term_exam_id: data.id,
      school_id: s.schoolId,
      exam_date: s.examDate ?? null,
    })),
  );
  if (schedErr) return c.json({ error: schedErr.message, code: 'DB_ERROR' }, 400);
}
```

- [ ] **Step 3: 修改 update handler（upsert schedule）**

```ts
if (body.schedules !== undefined) {
  // 簡化策略：全刪再全寫
  await supabase.from('term_exam_schedules').delete().eq('term_exam_id', id);
  if (body.schedules.length > 0) {
    const { error: schedErr } = await supabase.from('term_exam_schedules').insert(
      body.schedules.map((s) => ({
        term_exam_id: id,
        school_id: s.schoolId,
        exam_date: s.examDate ?? null,
      })),
    );
    if (schedErr) return c.json({ error: schedErr.message, code: 'DB_ERROR' }, 400);
  }
}
```

- [ ] **Step 4: detail SELECT 加入 schedules join**

```ts
.select('..., term_exam_schedules(school_id, exam_date, schools(id, name))')
```

Mapping：
```ts
schedules: (termExam.term_exam_schedules ?? []).map((s: any) => ({
  schoolId: s.school_id,
  schoolName: s.schools?.name ?? '',
  examDate: s.exam_date,
})),
```

- [ ] **Step 5: list endpoint 的 examDate 衍生策略**

list 仍舊要回 `examDate` 給列表顯示用。先以「schedules 中最早 exam_date」作為代表日期；沒有 schedule 時回 null。SQL 端可用 `term_exam_schedules(exam_date)` 關聯，後端 JS 做 min。

```ts
const rawRows = res.data ?? [];
const rows = rawRows.map((r: any) => {
  const dates = (r.term_exam_schedules ?? [])
    .map((s: any) => s.exam_date as string | null)
    .filter((d): d is string => !!d);
  const earliest = dates.length > 0 ? dates.sort()[0] : null;
  return {
    id: r.id,
    academicYear: r.academic_year,
    semester: r.semester,
    period: r.period,
    label: r.label,
    examDate: earliest,
    status: r.status,
    scoreCount: r.term_scores?.[0]?.count ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
});
```

- [ ] **Step 6: 手動測試**

- 透過 API 建立一場段考，帶 2 組 schedule
- GET detail 驗證 schedules 陣列回傳
- PATCH 覆寫 schedules，重查驗證覆寫生效
- 舊 `examDate` 欄位仍可正常顯示成 earliest 日期

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/term-exams.ts
git commit -m "feat(api): term exams support per-school schedules"
```

---

### Task 9: Score summary 以學生學校對應 schedule 為 cycle cutoff

**Files:**
- Modify: `apps/api/src/routes/scores.ts`

- [ ] **Step 1: 定位 studentSummary handler，重寫取數流程**

- 讀取學生 `school_id`（從 `students` 表）
- term_scores 改 join `term_exam_schedules!inner(school_id, exam_date)` 並過濾 `school_id = student.schoolId`
- 若學生 `school_id` 為 null，fallback 到 term_exams.exam_date（保底）
- cycleStartDate 改以「該學生學校最新段考日期」計算

關鍵 SELECT 片段：
```ts
supabase
  .from('term_scores')
  .select(`
    score, status, subject_id,
    subjects(name),
    term_exams!inner(
      org_id, academic_year, semester, period,
      term_exam_schedules!inner(school_id, exam_date)
    )
  `)
  .eq('student_id', studentId)
  .eq('term_exams.org_id', orgId)
  .eq('term_exams.term_exam_schedules.school_id', student.school_id)
```

（若 `student.school_id` 為 null，則不加此 filter，且後續以 `term_exams.exam_date` 最新者為 cutoff。）

- [ ] **Step 2: 調整 cycleStartDate 計算**

```ts
const cycleStartDate = termRows.reduce<string | null>((best, r) => {
  if (!r.examDate) return best;
  if (!best || r.examDate > best) return r.examDate;
  return best;
}, null);
```

— 此邏輯不變，但 `r.examDate` 現在是對應該學生學校的日期（從 schedule 取，否則回退到 term_exams.exam_date）。

- [ ] **Step 3: 手動測試**

資料準備：
- 建兩所學校 A / B
- 建一場段考，A 日期 2026-05-01、B 日期 2026-05-08
- 建一名學生 school = A，建段考成績（A 日期）與稍後的補習班成績
- 呼叫 `GET /scores/students/{id}/summary`
- 預期：academy 成績的 cutoff = 2026-05-01，晚於該日的補習班成績才會列入近期小考平均

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/scores.ts
git commit -m "feat(api): score summary uses school-specific term exam date as cycle cutoff"
```

---

## Phase 5 — Web Core

### Task 10: SchoolsService（core）

**Files:**
- Create: `apps/web/src/app/core/schools.service.ts`

- [ ] **Step 1: 以 `ng generate` 建立 service**

Run:
```bash
cd apps/web && npx ng g service core/schools --skip-tests=false
```
Expected: 產生 `schools.service.ts` + `schools.service.spec.ts`。

- [ ] **Step 2: 填入 service 實作**

```ts
// apps/web/src/app/core/schools.service.ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '@env/environment';

export interface School {
  readonly id: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly isActive: boolean;
  readonly studentCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SchoolListResponse {
  readonly data: School[];
  readonly meta: { total: number };
}

export interface CreateSchoolInput {
  readonly name: string;
  readonly shortName?: string | null;
  readonly isActive?: boolean;
}

export interface UpdateSchoolInput {
  readonly name?: string;
  readonly shortName?: string | null;
  readonly isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SchoolsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/schools`;

  private readonly _cache = signal<School[]>([]);
  readonly cache = this._cache.asReadonly();

  list(params: { search?: string; isActive?: boolean } = {}): Observable<SchoolListResponse> {
    const q: Record<string, string> = {};
    if (params.search) q['search'] = params.search;
    if (params.isActive !== undefined) q['isActive'] = String(params.isActive);
    return this.http.get<SchoolListResponse>(this.base, { params: q }).pipe(
      tap((res) => this._cache.set(res.data)),
    );
  }

  create(input: CreateSchoolInput): Observable<{ data: School }> {
    return this.http.post<{ data: School }>(this.base, input);
  }

  update(id: string, input: UpdateSchoolInput): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/${id}`, input);
  }

  delete(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }
}
```

- [ ] **Step 3: 撰寫最小 spec**

```ts
// apps/web/src/app/core/schools.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SchoolsService } from './schools.service';

describe('SchoolsService', () => {
  let service: SchoolsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SchoolsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GET /schools returns list', () => {
    service.list({ search: '中' }).subscribe((r) => expect(r.data.length).toBe(1));
    const req = http.expectOne((r) => r.url.endsWith('/schools') && r.params.get('search') === '中');
    req.flush({ data: [{ id: '1', name: '中正國中', shortName: null, isActive: true, studentCount: 0, createdAt: 't', updatedAt: 't' }], meta: { total: 1 } });
  });
});
```

- [ ] **Step 4: 執行測試**

Run: `cd apps/web && npx ng test --include='**/schools.service.spec.ts' --watch=false`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/core/schools.service.ts apps/web/src/app/core/schools.service.spec.ts
git commit -m "feat(web): add SchoolsService"
```

---

### Task 11: 更新 StudentsService types

**Files:**
- Modify: `apps/web/src/app/core/students.service.ts`

- [ ] **Step 1: 調整 Student 介面**

將：
```ts
school: string;
```
改為：
```ts
school: { id: string; name: string; shortName: string | null } | null;
```

移除 `StudentQueryParams.school`（改以 `schoolId` 取代）；在 `StudentQueryParams` / `CreateStudentInput` / `UpdateStudentInput` 中把 `school: string` 替換為 `schoolId?: string | null`。

- [ ] **Step 2: 跑 tsc 找出所有用到 `s.school` 的地方**

Run: `cd apps/web && npx tsc -p tsconfig.json --noEmit 2>&1 | head -80`
Expected: 列出所有呼叫端（student-form-dialog、students.page、student-detail.page、student-view 等）。

- [ ] **Step 3: 修正 students.service.ts 自身**

只改 type；邏輯不動。不在這個 task 修 UI。

- [ ] **Step 4: Commit（此時 tsc 尚有錯，留待下個 task 修）**

```bash
git add apps/web/src/app/core/students.service.ts
git commit -m "feat(web): student type uses school relation object"
```

---

### Task 12: 更新 TermExamsService types

**Files:**
- Modify: `apps/web/src/app/core/term-exams.service.ts`

- [ ] **Step 1: 加入 TermExamSchedule 與 schedules 欄位**

```ts
export interface TermExamSchedule {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly examDate: string | null;
}

// TermExamDetail 中：
readonly schedules: TermExamSchedule[];

// CreateTermExamInput / UpdateTermExamInput 中：
schedules?: Array<{ schoolId: string; examDate: string | null }>;
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/core/term-exams.service.ts
git commit -m "feat(web): term exam types include schedules"
```

---

## Phase 6 — Schools Admin Page

### Task 13: Routes-catalog 與 app.routes 註冊

**Files:**
- Modify: `apps/web/src/app/core/smart-enums/routes-catalog.ts`
- Modify: `apps/web/src/app/app.routes.ts`

- [ ] **Step 1: routes-catalog 新增 ADMIN_SCHOOLS**

在 `ADMIN_CAMPUSES` 旁邊補一條：
```ts
public static readonly ADMIN_SCHOOLS = this.register(
  'schools',
  '/admin/schools',
  '學校管理',
  UserType.ADMIN,
  'pi-building-columns',
  true,
  NavigationGroup.ADMIN_SETTINGS,
);
```

- [ ] **Step 2: app.routes.ts 增加 lazy route**

在 admin 區段補：
```ts
{
  path: 'schools',
  loadComponent: () =>
    import('./features/admin/pages/schools/schools.page').then((m) => m.SchoolsPage),
  canActivate: [authGuard, roleGuard(['admin'])],
  data: { page: RoutesCatalog.ADMIN_SCHOOLS },
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/core/smart-enums/routes-catalog.ts apps/web/src/app/app.routes.ts
git commit -m "feat(web): register /admin/schools route"
```

---

### Task 14: SchoolsPage — 列表 + CRUD hooks

**Files:**
- Create: `apps/web/src/app/features/admin/pages/schools/schools.page.ts`
- Create: `apps/web/src/app/features/admin/pages/schools/schools.page.html`
- Create: `apps/web/src/app/features/admin/pages/schools/schools.page.scss`

- [ ] **Step 1: 產生 component**

Run:
```bash
cd apps/web && npx ng g c features/admin/pages/schools/schools --type page --skip-tests=false
```

- [ ] **Step 2: 列表頁實作（signals + PrimeNG table）**

```ts
// schools.page.ts（主要邏輯）
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';

import { PageBreadcrumbComponent, type BreadcrumbItem } from '@shared/components/page-breadcrumb/page-breadcrumb.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { SchoolsService, type School } from '@core/schools.service';
import { SchoolFormDialogComponent, type SchoolFormResult } from './school-form-dialog.component';

@Component({
  selector: 'app-schools-page',
  standalone: true,
  imports: [
    FormsModule, TableModule, ButtonModule, InputTextModule, TagModule,
    ToastModule, ConfirmDialogModule, PageBreadcrumbComponent, EmptyStateComponent,
    SchoolFormDialogComponent,
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './schools.page.html',
  styleUrl: './schools.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolsPage implements OnInit {
  private readonly schoolsService = inject(SchoolsService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs: BreadcrumbItem[] = [
    { label: '系統設定' },
    { label: '學校管理' },
  ];

  protected readonly schools = signal<School[]>([]);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<School | null>(null);

  ngOnInit(): void { this.load(); }

  private load(): void {
    this.loading.set(true);
    this.schoolsService.list({ search: this.search() || undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => { this.schools.set(r.data); this.loading.set(false); },
        error: (e) => { this.loading.set(false); this.messageService.add({ severity: 'error', summary: '載入失敗', detail: e?.error?.error ?? '' }); },
      });
  }

  protected onSearch(v: string): void { this.search.set(v); this.load(); }

  protected openCreate(): void { this.editing.set(null); this.dialogOpen.set(true); }
  protected openEdit(s: School): void { this.editing.set(s); this.dialogOpen.set(true); }

  protected onSaved(result: SchoolFormResult): void {
    this.dialogOpen.set(false);
    this.messageService.add({ severity: 'success', summary: result.mode === 'create' ? '新增成功' : '更新成功' });
    this.load();
  }

  protected onDelete(s: School): void {
    if (s.studentCount > 0) {
      this.messageService.add({ severity: 'warn', summary: '無法刪除', detail: `此學校仍有 ${s.studentCount} 位學生` });
      return;
    }
    this.confirmationService.confirm({
      message: `確定刪除「${s.name}」？`,
      accept: () => {
        this.schoolsService.delete(s.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: () => { this.messageService.add({ severity: 'success', summary: '已刪除' }); this.load(); },
          error: (e) => this.messageService.add({ severity: 'error', summary: '刪除失敗', detail: e?.error?.error ?? '' }),
        });
      },
    });
  }
}
```

- [ ] **Step 3: 撰寫 template**

```html
<!-- schools.page.html -->
<div class="schools-page">
  <app-page-breadcrumb [items]="breadcrumbs" />

  <div class="schools-page__toolbar">
    <input pInputText placeholder="搜尋學校名稱..." [ngModel]="search()" (ngModelChange)="onSearch($event)" />
    <button pButton icon="pi pi-plus" label="新增學校" size="small" (click)="openCreate()"></button>
  </div>

  @if (loading()) {
    <div class="schools-page__loading"><i class="pi pi-spinner pi-spin"></i> 載入中…</div>
  } @else if (schools().length === 0) {
    <app-empty-state icon="pi pi-building-columns" title="尚無學校" description="點右上角「新增學校」建立第一筆" />
  } @else {
    <p-table [value]="schools()" styleClass="schools-page__table">
      <ng-template pTemplate="header">
        <tr>
          <th>名稱</th>
          <th>簡稱</th>
          <th>學生數</th>
          <th>狀態</th>
          <th style="width:140px">操作</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-s>
        <tr>
          <td>{{ s.name }}</td>
          <td>{{ s.shortName ?? '—' }}</td>
          <td>{{ s.studentCount }}</td>
          <td><p-tag [value]="s.isActive ? '啟用' : '停用'" [severity]="s.isActive ? 'success' : 'secondary'" /></td>
          <td>
            <button pButton icon="pi pi-pencil" severity="secondary" size="small" text (click)="openEdit(s)"></button>
            <button pButton icon="pi pi-trash" severity="danger" size="small" text (click)="onDelete(s)"></button>
          </td>
        </tr>
      </ng-template>
    </p-table>
  }

  @if (dialogOpen()) {
    <app-school-form-dialog
      [editing]="editing()"
      (saved)="onSaved($event)"
      (closed)="dialogOpen.set(false)"
    />
  }

  <p-toast />
  <p-confirmDialog />
</div>
```

- [ ] **Step 4: scss 採 BEM**

```scss
@use 'shared/breakpoints' as *;

.schools-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);

  &__toolbar {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
  }

  &__loading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-8);
    color: var(--zinc-500);
  }

  &__table {
    background: #fff;
    border: 1px solid var(--zinc-200);
    border-radius: var(--radius-lg);
  }
}

@include respond-to('tablet-portrait') {
  .schools-page { padding: var(--space-4); }
}
```

- [ ] **Step 5: 啟動 web 跑起來**

Run: `cd apps/web && npx ng serve`
開 `/admin/schools`，目前會因為缺 SchoolFormDialogComponent 建置失敗。下一 task 修。

- [ ] **Step 6: Commit（包含 dialog 之後）**

暫不 commit，與下一 task 一起 commit。

---

### Task 15: SchoolFormDialogComponent（新增 / 編輯）

**Files:**
- Create: `apps/web/src/app/features/admin/pages/schools/school-form-dialog.component.ts`
- Create: `apps/web/src/app/features/admin/pages/schools/school-form-dialog.component.html`
- Create: `apps/web/src/app/features/admin/pages/schools/school-form-dialog.component.scss`

- [ ] **Step 1: 產生檔案**

Run:
```bash
cd apps/web && npx ng g c features/admin/pages/schools/school-form-dialog --type component --skip-tests=true
```

- [ ] **Step 2: 實作 dialog**

```ts
// school-form-dialog.component.ts
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageService } from 'primeng/api';

import { SchoolsService, type School } from '@core/schools.service';

export interface SchoolFormResult {
  mode: 'create' | 'update';
  school: School | null;
}

@Component({
  selector: 'app-school-form-dialog',
  standalone: true,
  imports: [FormsModule, DialogModule, InputTextModule, ButtonModule, CheckboxModule],
  templateUrl: './school-form-dialog.component.html',
  styleUrl: './school-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolFormDialogComponent implements OnInit {
  readonly editing = input<School | null>(null);
  readonly saved = output<SchoolFormResult>();
  readonly closed = output<void>();

  private readonly schoolsService = inject(SchoolsService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly visible = signal(true);
  protected readonly name = signal('');
  protected readonly shortName = signal('');
  protected readonly isActive = signal(true);
  protected readonly submitting = signal(false);

  protected readonly mode = computed(() => (this.editing() ? 'update' : 'create'));
  protected readonly canSubmit = computed(() => this.name().trim().length > 0 && !this.submitting());

  ngOnInit(): void {
    const s = this.editing();
    if (s) {
      this.name.set(s.name);
      this.shortName.set(s.shortName ?? '');
      this.isActive.set(s.isActive);
    }
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    const payload = {
      name: this.name().trim(),
      shortName: this.shortName().trim() || null,
      isActive: this.isActive(),
    };
    const existing = this.editing();
    const obs = existing
      ? this.schoolsService.update(existing.id, payload)
      : this.schoolsService.create(payload);
    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.submitting.set(false);
        this.visible.set(false);
        this.saved.emit({ mode: existing ? 'update' : 'create', school: null });
      },
      error: (e) => {
        this.submitting.set(false);
        const detail = e?.error?.code === 'DUPLICATE' ? '學校名稱已存在' : (e?.error?.error ?? '');
        this.messageService.add({ severity: 'error', summary: '儲存失敗', detail });
      },
    });
  }

  protected onHide(): void {
    this.closed.emit();
  }
}
```

- [ ] **Step 3: 撰寫 template**

```html
<!-- school-form-dialog.component.html -->
<p-dialog
  [(visible)]="visible"
  [modal]="true"
  [header]="mode() === 'create' ? '新增學校' : '編輯學校'"
  [style]="{ width: '480px', maxWidth: '95vw' }"
  [closable]="true"
  [draggable]="false"
  [resizable]="false"
  (onHide)="onHide()"
>
  <div class="school-form">
    <label class="school-form__field">
      <span class="school-form__label">學校全名<span class="school-form__required">*</span></span>
      <input pInputText [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="例：台北市立明湖國中" />
    </label>

    <label class="school-form__field">
      <span class="school-form__label">簡稱（選填）</span>
      <input pInputText [ngModel]="shortName()" (ngModelChange)="shortName.set($event)" placeholder="例：明湖國中" />
    </label>

    <label class="school-form__field school-form__field--inline">
      <p-checkbox [(ngModel)]="isActive" [binary]="true" inputId="school-active" />
      <span>啟用</span>
    </label>
  </div>

  <ng-template #footer>
    <button pButton label="取消" severity="secondary" size="small" text (click)="visible.set(false)"></button>
    <button pButton label="儲存" size="small" [disabled]="!canSubmit()" [loading]="submitting()" (click)="submit()"></button>
  </ng-template>
</p-dialog>
```

- [ ] **Step 4: scss**

```scss
.school-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);

  &__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);

    &--inline {
      flex-direction: row;
      align-items: center;
      gap: var(--space-2);
    }
  }

  &__label { font-size: var(--text-sm); color: var(--zinc-700); }
  &__required { color: var(--red-600); margin-left: 2px; }
}
```

- [ ] **Step 5: build + 手動測試**

Run: `cd apps/web && npx ng build --configuration=development`
Expected: 0 errors（可能仍有 students/score-entry 呼叫 `s.school` 的錯）。若有，下一 Phase 修。
啟動 dev server 實際在 `/admin/schools` 新增/編輯/刪除測試完整流程。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/schools
git commit -m "feat(web): schools admin page with CRUD dialog"
```

---

## Phase 7 — Students UI 改 school 下拉

### Task 16: Student form dialog 改用 p-select + 新增學校

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/students/student-form-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/students/student-form-dialog.component.html`

- [ ] **Step 1: 注入 SchoolsService 與處理 school state**

在 component class 加：
```ts
private readonly schoolsService = inject(SchoolsService);
protected readonly schools = signal<School[]>([]);
protected readonly schoolId = signal<string | null>(null);
protected readonly creatingSchool = signal(false);
protected readonly newSchoolName = signal('');
```

`ngOnInit` 裡載入：
```ts
this.schoolsService.list({ isActive: true }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
  next: (r) => this.schools.set(r.data),
});
```

若 editing 帶入 student，預設 `schoolId = student.school?.id ?? null`。

- [ ] **Step 2: template 改為 p-select**

將原本 `<input ... [(ngModel)]="form.school">` 替換為：
```html
<div class="student-form__field">
  <label>學校<span class="student-form__required">*</span></label>
  <div class="student-form__school-row">
    <p-select
      [options]="schools()"
      [ngModel]="schoolId()"
      (ngModelChange)="schoolId.set($event)"
      optionLabel="name"
      optionValue="id"
      [filter]="true"
      filterBy="name,shortName"
      [showClear]="true"
      placeholder="選擇或搜尋學校"
      [style]="{ flex: 1 }"
      [appendTo]="'body'"
    />
    <button pButton icon="pi pi-plus" label="新增" size="small" severity="secondary" (click)="creatingSchool.set(true)"></button>
  </div>

  @if (creatingSchool()) {
    <div class="student-form__school-create">
      <input pInputText [ngModel]="newSchoolName()" (ngModelChange)="newSchoolName.set($event)" placeholder="輸入新學校全名" />
      <button pButton label="建立" size="small" (click)="quickCreateSchool()" [disabled]="!newSchoolName().trim()"></button>
      <button pButton label="取消" size="small" severity="secondary" text (click)="creatingSchool.set(false)"></button>
    </div>
  }
</div>
```

- [ ] **Step 3: `quickCreateSchool` 實作**

```ts
protected quickCreateSchool(): void {
  const name = this.newSchoolName().trim();
  if (!name) return;
  this.schoolsService.create({ name }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
    next: (r) => {
      this.schools.update((list) => [...list, r.data]);
      this.schoolId.set(r.data.id);
      this.creatingSchool.set(false);
      this.newSchoolName.set('');
    },
    error: (e) => this.messageService.add({ severity: 'error', summary: '新增失敗', detail: e?.error?.error ?? '' }),
  });
}
```

- [ ] **Step 4: submit 時改傳 `schoolId`**

將原本 `school: form.school` 改為 `schoolId: this.schoolId()`。

- [ ] **Step 5: 手動測試**

- 新學生：下拉選既有、或按「新增」即席建立、儲存後回到列表顯示正確學校名稱
- 編輯既有學生：預設選中對的學校、切換後儲存生效

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/students/student-form-dialog.component.ts \
        apps/web/src/app/features/admin/pages/students/student-form-dialog.component.html
git commit -m "feat(web): student form uses school select with quick create"
```

---

### Task 17: 更新學生列表 / 詳情 / Grade overview student-view 的 school 顯示

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/students/students.page.html`
- Modify: `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.html`

- [ ] **Step 1: 全域替換 `{{ s.school }}` / `{{ student.school }}` → `{{ s.school?.name ?? '—' }}`**

用 Grep 先掃出所有地方：
```bash
rg -n "\\.school[^_A-Za-z]" apps/web/src/app/features/admin/pages/students apps/web/src/app/features/admin/pages/grades/overview
```
逐檔把 `student.school` / `s.school` 顯示處改為 `?.name`。注意 `schoolId`、`school_id` 不要動。

- [ ] **Step 2: 同步修正 TS 裡的 filter/sort**

檢查 `*.page.ts` 內是否有 `s.school.localeCompare(...)` 等——換為 `s.school?.name ?? ''`。

- [ ] **Step 3: build + 手動瀏覽**

Run: `cd apps/web && npx ng build --configuration=development`
Expected: 0 errors。
瀏覽 `/admin/students`、學生詳情、`/admin/grades/overview` 學生視角，確認顯示正確。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/students apps/web/src/app/features/admin/pages/grades/overview
git commit -m "feat(web): display school name via school relation"
```

---

## Phase 8 — Term Exam UI

### Task 18: Term exam form dialog 支援多學校排程

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/term-exam-form-dialog/term-exam-form-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/term-exam-form-dialog/term-exam-form-dialog.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/term-exam-form-dialog/term-exam-form-dialog.component.scss`

- [ ] **Step 1: 閱讀現有 dialog 狀態**

Run: `Read` 這三個檔案，確認目前 form signals 與 submit 流程，再決定把 schedules 放在哪一個 section（預期是日期欄位附近）。

- [ ] **Step 2: 注入 SchoolsService + 新增 schedules signal**

```ts
protected readonly schools = signal<School[]>([]);
protected readonly schedules = signal<Array<{ schoolId: string | null; examDate: string | null }>>([]);
```

`ngOnInit` 中 `schoolsService.list({ isActive: true })` 取清單。編輯模式時用現有 `exam.schedules` 初始化。

- [ ] **Step 3: template 以表格呈現**

```html
<div class="term-exam-form__schedules">
  <div class="term-exam-form__schedules-header">
    <span>學校</span><span>考試日期</span><span></span>
  </div>
  @for (row of schedules(); track $index; let i = $index) {
    <div class="term-exam-form__schedule-row">
      <p-select
        [options]="schools()"
        [ngModel]="row.schoolId"
        (ngModelChange)="updateScheduleSchool(i, $event)"
        optionLabel="name"
        optionValue="id"
        [filter]="true"
        filterBy="name,shortName"
        placeholder="選擇學校"
        [appendTo]="'body'"
      />
      <p-datepicker
        [ngModel]="row.examDate"
        (ngModelChange)="updateScheduleDate(i, $event)"
        dateFormat="yy-mm-dd"
        [appendTo]="'body'"
      />
      <button pButton icon="pi pi-trash" size="small" severity="danger" text (click)="removeSchedule(i)"></button>
    </div>
  }
  <button pButton icon="pi pi-plus" label="新增學校排程" size="small" severity="secondary" (click)="addSchedule()"></button>
</div>
```

- [ ] **Step 4: schedule 操作 helper**

```ts
protected addSchedule(): void {
  this.schedules.update((list) => [...list, { schoolId: null, examDate: null }]);
}
protected removeSchedule(i: number): void {
  this.schedules.update((list) => list.filter((_, idx) => idx !== i));
}
protected updateScheduleSchool(i: number, schoolId: string | null): void {
  this.schedules.update((list) => list.map((r, idx) => idx === i ? { ...r, schoolId } : r));
}
protected updateScheduleDate(i: number, examDate: string | null): void {
  this.schedules.update((list) => list.map((r, idx) => idx === i ? { ...r, examDate } : r));
}
```

- [ ] **Step 5: submit 傳 schedules**

```ts
const validSchedules = this.schedules()
  .filter((r) => r.schoolId)
  .map((r) => ({ schoolId: r.schoolId!, examDate: r.examDate }));

this.termExamsService.create({ ...payload, schedules: validSchedules })... // 或 update
```

- [ ] **Step 6: 手動測試**

- 建立新段考，加 2 組學校+日期、儲存、重開 dialog 看有沒有正確載入
- 編輯時刪除一筆 schedule、新增一筆、儲存、重查驗證

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/term-exam-form-dialog
git commit -m "feat(web): term exam dialog manages per-school schedules"
```

---

### Task 19: Score-entry 頭部顯示所選 filter 對應學校的日期

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.ts`

- [ ] **Step 1: examInfo computed 改使用 schedules**

term 分支改為：

```ts
const exam = this.termExam();
if (!exam) return null;
const filter = this.termFilter();
const campusName = filter?.campusId
  ? (this.refData.campuses().find((c) => c.id === filter.campusId)?.name ?? null)
  : '全部分校';
const gradeLabel = filter?.grade
  ? (GRADE_LEVEL_LABELS[filter.grade as GradeLevel] ?? filter.grade)
  : '全部年級';

// schedules：若只有一筆 → 顯示該日期；多筆 → 顯示 "多校 N 日期"；無 → 日期未定
const schedules = exam.schedules ?? [];
let dateLabel = '日期未定';
if (schedules.length === 1) {
  dateLabel = schedules[0].examDate ?? '日期未定';
} else if (schedules.length > 1) {
  const dates = schedules.map((s) => s.examDate).filter((d): d is string => !!d).sort();
  dateLabel = dates.length > 0 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '多校排程';
}

const parts = [dateLabel, campusName, gradeLabel].filter(Boolean);
return { name: exam.label, metaLine: parts.join(' · '), status: exam.status };
```

- [ ] **Step 2: 手動測試**

段考綁兩所學校、各自日期 → 頭部顯示 `2026-05-01 ~ 2026-05-08 · 示範分校01 · 全部年級`。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.ts
git commit -m "feat(web): score entry header shows schedule span across schools"
```

---

### Task 20: Term score editor 新增 school filter（可選）

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.html`

- [ ] **Step 1: 載入 schools 清單**

注入 SchoolsService；signal `schoolFilter = signal<string | null>(null)`。

- [ ] **Step 2: template 加一個 p-select**

filter row 增加：
```html
<p-select
  [options]="schools()"
  [ngModel]="schoolFilter()"
  (ngModelChange)="onSchoolFilterChange($event)"
  optionLabel="name"
  optionValue="id"
  [showClear]="true"
  placeholder="全部學校"
  size="small"
  [filter]="true"
  filterBy="name,shortName"
/>
```

- [ ] **Step 3: 將 schoolId 帶入 `termExamsService.get({ ..., schoolId })` 或前端 `students().filter(s => s.school?.id === schoolFilter())`**

簡化做法：後端 list 不需改，前端 filter 即可。若學生數量大才改後端。

- [ ] **Step 4: 手動測試**

選擇學校後列表只顯示該校學生。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor
git commit -m "feat(web): term score editor supports school filter"
```

---

## Phase 9 — Verification

### Task 21: 端到端手動回歸

**Files:** None（驗證）

- [ ] **Step 1: 關鍵流程**

依序走完：
1. `/admin/schools` 新增 2 所學校
2. `/admin/students` 新增/編輯學生綁到學校
3. `/admin/grades/exams` 建立一場段考，兩所學校不同日期
4. 段考成績登錄：驗證 header 日期顯示、依分校/年級/學校過濾
5. `/admin/grades/overview` 學生視角：確認「近期小考」cutoff 以該學生學校的段考日期為基準

- [ ] **Step 2: tsc 全域**

Run: `cd apps/web && npx tsc -p tsconfig.json --noEmit`
Expected: 0 errors。

- [ ] **Step 3: vitest 全域**

Run: `cd apps/api && npx vitest run`
Expected: 全數 PASS。

- [ ] **Step 4: Build**

Run: `cd apps/web && npx ng build --configuration=development`
Expected: 0 errors。

- [ ] **Step 5: 若一切 OK 才結束**

若任一步出錯，回到對應 task 補修（不要強行 commit 綠燈）。

- [ ] **Step 6: Commit 最終 touch**

若過程中修了小東西，整理一個 `chore: verification fixes` commit。否則跳過。

---

## 檢查清單（完成前跑一遍）

- [ ] Migrations 三支皆能在 `supabase db reset` 乾淨完成
- [ ] `/schools` 四個 CRUD endpoint 全部回正確碼 + audit log 有進 `audit_logs`
- [ ] `/students` 回傳 `school: { id, name, shortName } | null`
- [ ] `/term-exams` detail 回傳 schedules 陣列；create/update 能寫入 schedules
- [ ] `/scores/students/{id}/summary` cycleStartDate 來自學生學校對應 schedule
- [ ] `/admin/schools` 頁能新增/編輯/刪除（有學生關聯時 409）
- [ ] 學生表單下拉能搜尋、能即席新增學校
- [ ] 學生列表、詳情、成績總覽學生視角顯示 `school.name`
- [ ] 段考 form 能輸入多組 school + date
- [ ] 成績登錄頭部顯示正確日期 + filter 狀態
- [ ] 手動走一次關鍵流程不 regression

## 風險與備案

- **Supabase PostgREST 巢狀 join 語法**：`term_exams.term_exam_schedules.school_id` 這種 dotted filter 若該版本不支援，改成後端分兩步查：先拿該學生 school_id，再直接 query schedules 篩 `school_id + term_exam_id`。
- **schedule 編輯採「全刪再全寫」**：若 `term_scores` 有外鍵依賴 schedule（目前設計沒有），就得改為 upsert/diff。目前 schema 只有 term_exam_id + school_id 兩欄，外鍵安全。
- **舊 `students.school` text 欄位被其他查詢讀到**：Task 3 完成後欄位會消失，若 API 仍有殘留字串參照會 400，可用全域 grep `"school"` 在 `apps/api` 再次巡查。
