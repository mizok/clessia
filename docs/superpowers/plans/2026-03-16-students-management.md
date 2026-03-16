# 學生管理 (Students Management) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實作 `/admin/students` 學生管理功能，包含學生列表（搜尋/篩選）、新增/編輯 Popup、及學生詳情頁。

**Architecture:** 遵循 AGENT_GUIDE.md 分階段開發：Phase 2-4 委派 Codex 執行（DB → API → Service），Phase 5 由 Claude 實作 UI。後端使用 Hono + `@hono/zod-openapi`，前端使用 Angular 21 Signals + PrimeNG 21，Pattern 與現有 `CampusesPage` 保持一致（包含 `logAudit`）。

**設計決策：**
- **緊急聯絡人**：規格原文為單一文字欄「姓名+電話」，本計劃拆分為 `emergency_contact_name` + `emergency_contact_phone` 兩欄，以利未來資料查詢與驗證，UX 呈現仍與規格一致。
- **分校篩選（campusId）**：規格要求「依報名的開課班所屬分校」篩選，但此需要 `enrollments` → `classes` → `campuses` JOIN，而 enrollments 表尚未建立。**本計劃將分校篩選標記為 Deferred Scope**，API 保留 `campusId` 參數（noop），UI 顯示禁用的分校下拉，待 enrollments 功能完成後實作。

**Tech Stack:** Angular 21 (Signals, Standalone), PrimeNG 21, Hono 4 (`@hono/zod-openapi`), Zod 4, Supabase PostgreSQL

---

## Chunk 1: Phase 2 — Database Migration

### Task 1: 建立 students / parents / parent_student_relations Migration

> **委派 Codex**：Phase 2 (Database)
> sessionId: `students-phase2-db`

**Files:**
- Create: `supabase/migrations/20260316110000_create_students_and_parents.sql`
- Modify: `supabase/seed.sql`

- [ ] **Step 1: 建立 migration 檔案**

```sql
-- supabase/migrations/20260316110000_create_students_and_parents.sql

-- 1. Enums
CREATE TYPE public.grade_level AS ENUM (
  'K',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'J1', 'J2', 'J3',
  'S1', 'S2', 'S3'
);

CREATE TYPE public.student_gender AS ENUM (
  'male', 'female', 'prefer_not_to_say'
);

-- 2. Students table
CREATE TABLE public.students (
  id                      UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID           NOT NULL REFERENCES public.organizations(id),
  name                    TEXT           NOT NULL,
  grade                   public.grade_level NOT NULL,
  school                  TEXT           NOT NULL,
  birthday                DATE,
  gender                  public.student_gender,
  phone                   TEXT,
  address                 TEXT,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  notes                   TEXT,
  is_active               BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX students_org_id_idx ON public.students (org_id);
CREATE INDEX students_name_idx   ON public.students USING gin(to_tsvector('simple', name));
CREATE INDEX students_grade_idx  ON public.students (grade);
CREATE INDEX students_active_idx ON public.students (is_active);

CREATE TRIGGER students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 3. Parents table
CREATE TABLE public.parents (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES public.organizations(id),
  name       TEXT        NOT NULL,
  phone      TEXT,
  email      TEXT,
  notes      TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX parents_org_id_idx ON public.parents (org_id);
CREATE INDEX parents_name_idx   ON public.parents (name);

CREATE TRIGGER parents_updated_at
  BEFORE UPDATE ON public.parents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 4. Parent-Student relations table
CREATE TABLE public.parent_student_relations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  UUID        NOT NULL REFERENCES public.parents(id)  ON DELETE CASCADE,
  student_id UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  relation   TEXT,
  is_primary BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(parent_id, student_id)
);

CREATE INDEX psr_student_id_idx ON public.parent_student_relations (student_id);
CREATE INDEX psr_parent_id_idx  ON public.parent_student_relations (parent_id);
```

- [ ] **Step 2: 更新 seed.sql — 新增 students 與 parents 示範資料**

在 `supabase/seed.sql` 的 demo org 資料區塊末尾加入（在最後的 `END $$;` 之前），新增以下邏輯：

```sql
-- ===== Students & Parents seed =====
DECLARE
  student_names TEXT[] := ARRAY[
    '林子璿', '陳宇翔', '張品妍', '王柏睿', '李語涵',
    '黃承恩', '劉靖雯', '吳宥廷', '鄭詠晴', '謝家豪',
    '楊欣妍', '蔡昱辰', '許怡君', '邱冠廷', '曾沛蓉'
  ];
  student_grades TEXT[] := ARRAY['J1','J2','J3','J1','P6','J3','S1','J2','P5','S2','J1','J3','P6','J2','S1'];
  student_schools TEXT[] := ARRAY[
    '台北市立文山國中', '新北市立景美國中', '台北市立木柵國中',
    '台北市立信義國中', '台北市立大安國小', '新北市立永和國中',
    '台北市立中正高中', '台北市立萬芳國中', '台北市立興隆國小',
    '台北市立南港高中', '台北市立內湖國中', '新北市立土城國中',
    '台北市立大直國小', '台北市立松山國中', '台北市立南港高中'
  ];
  parent_last_names TEXT[] := ARRAY['林', '陳', '張', '王', '李', '黃', '劉', '吳'];
  parent_given_names TEXT[] := ARRAY['志明', '淑芬', '建國', '美玲', '宗翰', '雅雯', '俊賢', '秀蘭'];
  v_student_id UUID;
  v_parent_id UUID;
  student_index INTEGER;
BEGIN
  FOR student_index IN 1..array_length(student_names, 1) LOOP
    INSERT INTO public.students (org_id, name, grade, school, is_active)
    VALUES (
      demo_org_id,
      student_names[student_index],
      student_grades[student_index]::public.grade_level,
      student_schools[student_index],
      TRUE
    )
    RETURNING id INTO v_student_id;

    -- 建立家長
    INSERT INTO public.parents (org_id, name, phone, is_active)
    VALUES (
      demo_org_id,
      parent_last_names[((student_index - 1) % 8) + 1] || parent_given_names[((student_index - 1) % 8) + 1],
      '09' || LPAD((student_index * 12345678 % 100000000)::TEXT, 8, '0'),
      TRUE
    )
    RETURNING id INTO v_parent_id;

    -- 關聯家長與學生
    INSERT INTO public.parent_student_relations (parent_id, student_id, relation, is_primary)
    VALUES (v_parent_id, v_student_id, 'parent', TRUE);
  END LOOP;
END;
```

> **重要**：seed.sql 是單一 `DO $$ DECLARE ... BEGIN ... END $$;` 區塊，**不能**在其中插入新的 DECLARE。請在整個 DO 區塊之後（最後的 `END $$;` 之後）加上獨立的 DO 區塊：
>
> ```sql
> -- 在 seed.sql 末尾加上
> DO $$
> DECLARE
>   demo_org_id UUID := '11111111-1111-1111-1111-111111111111';
>   student_names TEXT[] := ARRAY[...];
>   ...
> BEGIN
>   -- 先 cleanup（確保 idempotent）
>   DELETE FROM public.parent_student_relations
>     WHERE student_id IN (SELECT id FROM public.students WHERE org_id = demo_org_id);
>   DELETE FROM public.parents WHERE org_id = demo_org_id;
>   DELETE FROM public.students WHERE org_id = demo_org_id;
>
>   -- 插入 students & parents（如上方 seed 邏輯）
>   FOR student_index IN 1..array_length(student_names, 1) LOOP
>     ...
>   END LOOP;
> END $$;
> ```

- [ ] **Step 3: 驗證 DB Migration**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
supabase db reset
```

預期：無錯誤，所有 migration 成功套用

- [ ] **Step 4: 驗證 seed 資料**

```bash
supabase db reset
# 然後用 psql 或 Supabase Studio 查驗
# 確認 students 表有 15 筆資料，parents 表有 15 筆，parent_student_relations 有 15 筆
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260316110000_create_students_and_parents.sql supabase/seed.sql
git commit -m "feat: add students, parents, parent_student_relations tables and seed data"
```

---

## Chunk 2: Phase 3 — API Routes

### Task 2: 建立 students API Route

> **委派 Codex**：Phase 3 (API)
> sessionId: `students-phase3-api`

**Files:**
- Create: `apps/api/src/routes/students.ts`
- Create: `apps/api/src/routes/students.spec.ts`
- Modify: `apps/api/src/index.ts`

#### 版本資訊（Codex prompt 必須包含）
- hono: ^4.11.9
- @hono/zod-openapi: ^1.2.1
- zod: ^4.3.6（使用 Zod 4 API：`z.uuid()`、`z.email()`，非 `z.string().uuid()`）

#### 2a: 建立 students.ts

- [ ] **Step 1: 先寫純函式的單元測試（TDD Red）**

建立 `apps/api/src/routes/students.spec.ts`：

```typescript
import { describe, expect, it } from 'vitest';
import * as studentsRoute from './students';

describe('buildStudentSummary', () => {
  it('counts active students from rows', () => {
    const buildStudentSummary = (studentsRoute as Record<string, unknown>)[
      'buildStudentSummary'
    ] as ((rows: Array<{ is_active: boolean }>, total: number) => {
      total: number;
      activeCount: number;
    }) | undefined;

    expect(buildStudentSummary).toBeTypeOf('function');

    const result = buildStudentSummary?.(
      [{ is_active: true }, { is_active: false }, { is_active: true }],
      3,
    );

    expect(result).toEqual({ total: 3, activeCount: 2 });
  });
});

describe('toStudentResponse', () => {
  it('maps snake_case DB row to camelCase response', () => {
    const toStudentResponse = (studentsRoute as Record<string, unknown>)[
      'toStudentResponse'
    ] as ((row: Record<string, unknown>, parentNames?: string[]) => Record<string, unknown>) | undefined;

    expect(toStudentResponse).toBeTypeOf('function');

    const row = {
      id: 'abc-123',
      org_id: 'org-456',
      name: '林子璿',
      grade: 'J1',
      school: '台北市立文山國中',
      birthday: '2010-05-15',
      gender: 'male',
      phone: null,
      address: null,
      emergency_contact_name: '林志明',
      emergency_contact_phone: '0912345678',
      notes: null,
      is_active: true,
      created_at: '2026-03-16T00:00:00Z',
      updated_at: '2026-03-16T00:00:00Z',
    };

    const result = toStudentResponse?.(row, ['林志明']);

    expect(result).toMatchObject({
      id: 'abc-123',
      orgId: 'org-456',
      name: '林子璿',
      grade: 'J1',
      school: '台北市立文山國中',
      birthday: '2010-05-15',
      gender: 'male',
      emergencyContactName: '林志明',
      emergencyContactPhone: '0912345678',
      isActive: true,
      parentNames: ['林志明'],
    });
  });

  it('handles null optional fields', () => {
    const toStudentResponse = (studentsRoute as Record<string, unknown>)[
      'toStudentResponse'
    ] as ((row: Record<string, unknown>, parentNames?: string[]) => Record<string, unknown>) | undefined;

    const row = {
      id: 'abc-123', org_id: 'org-456', name: '林子璿', grade: 'J1',
      school: '學校', birthday: null, gender: null, phone: null,
      address: null, emergency_contact_name: null, emergency_contact_phone: null,
      notes: null, is_active: false, created_at: '2026-01-01', updated_at: '2026-01-01',
    };

    const result = toStudentResponse?.(row);

    expect(result?.['birthday']).toBeNull();
    expect(result?.['gender']).toBeNull();
    expect(result?.['emergencyContactName']).toBeNull();
    expect(result?.['parentNames']).toEqual([]);
  });
});
```

> **注意**：`toStudentResponse` 需在 `students.ts` 中 export（加上 `export` 關鍵字）以便測試。

- [ ] **Step 2: 執行測試，確認失敗**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
npx nx test api --testFile=apps/api/src/routes/students.spec.ts
```

預期：FAIL（students.ts 不存在）

- [ ] **Step 3: 建立 `apps/api/src/routes/students.ts`**

參考 `apps/api/src/routes/campuses.ts` 的模式。完整實作如下：

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';

// ============================================================
// Schemas
// ============================================================

const GradeLevelSchema = z
  .enum(['K', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J2', 'J3', 'S1', 'S2', 'S3'])
  .openapi('GradeLevel');

const StudentGenderSchema = z
  .enum(['male', 'female', 'prefer_not_to_say'])
  .openapi('StudentGender');

const StudentSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    name: z.string(),
    grade: GradeLevelSchema,
    school: z.string(),
    birthday: z.string().nullable(),
    gender: StudentGenderSchema.nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    emergencyContactName: z.string().nullable(),
    emergencyContactPhone: z.string().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),
    parentNames: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Student');

const StudentDetailParentSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    relation: z.string().nullable(),
    isPrimary: z.boolean(),
  })
  .openapi('StudentDetailParent');

const StudentDetailSchema = StudentSchema.extend({
  parents: z.array(StudentDetailParentSchema),
}).openapi('StudentDetail');

const StudentListResponseSchema = z
  .object({
    data: z.array(StudentSchema),
    summary: z.object({ total: z.number(), activeCount: z.number() }),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('StudentListResponse');

const CreateStudentSchema = z
  .object({
    name: z.string().min(1, '姓名不得為空'),
    grade: GradeLevelSchema,
    school: z.string().min(1, '就讀學校不得為空'),
    birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD').nullable().optional(),
    gender: StudentGenderSchema.nullable().optional(),
    phone: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    emergencyContactName: z.string().nullable().optional(),
    emergencyContactPhone: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .openapi('CreateStudent');

const UpdateStudentSchema = CreateStudentSchema.partial()
  .extend({ isActive: z.boolean().optional() })
  .openapi('UpdateStudent');

// ============================================================
// Helpers (exported for unit testing)
// ============================================================

export function buildStudentSummary(
  rows: Array<{ is_active: boolean }>,
  total: number,
): { total: number; activeCount: number } {
  return {
    total,
    activeCount: rows.filter((r) => r.is_active).length,
  };
}

export function toStudentResponse(row: Record<string, unknown>, parentNames: string[] = []) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    name: row['name'] as string,
    grade: row['grade'] as string,
    school: row['school'] as string,
    birthday: (row['birthday'] as string | null) ?? null,
    gender: (row['gender'] as string | null) ?? null,
    phone: (row['phone'] as string | null) ?? null,
    address: (row['address'] as string | null) ?? null,
    emergencyContactName: (row['emergency_contact_name'] as string | null) ?? null,
    emergencyContactPhone: (row['emergency_contact_phone'] as string | null) ?? null,
    notes: (row['notes'] as string | null) ?? null,
    isActive: row['is_active'] as boolean,
    parentNames,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/students
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Students'],
    summary: '取得學生列表',
    request: {
      query: z.object({
        search: z.string().optional(),
        grade: GradeLevelSchema.optional(),
        // campusId: deferred — 需要 enrollments 表，待 enrollments 功能完成後實作
        // campusId: z.uuid().optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
        isActive: z.coerce.boolean().optional(),
      }),
    },
    responses: {
      200: {
        description: '學生列表',
        content: { 'application/json': { schema: StudentListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { search, grade, page = 1, pageSize = 20, isActive } = c.req.valid('query');

    let query = supabase
      .from('students')
      .select(
        `*, parent_student_relations(is_primary, relation, parents(id, name))`,
        { count: 'exact' },
      )
      .eq('org_id', orgId)
      .order('name');

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }
    if (grade) {
      query = query.eq('grade', grade);
    }
    if (isActive !== undefined) {
      query = query.eq('is_active', isActive);
    }

    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      return c.json({ error: '讀取學生列表失敗', message: error.message }, 500);
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const total = count ?? 0;

    // 獨立 query 取得全量 activeCount（不受 isActive filter 影響）
    const { count: activeCount } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_active', true);

    const students = rows.map((row) => {
      const relations = (row['parent_student_relations'] as Array<{
        is_primary: boolean;
        relation: string | null;
        parents: { id: string; name: string } | null;
      }>) ?? [];
      const parentNames = relations
        .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
        .map((r) => r.parents?.name ?? '')
        .filter(Boolean);
      return toStudentResponse(row, parentNames);
    });

    return c.json(
      {
        data: students,
        summary: { total, activeCount: activeCount ?? 0 },
        meta: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      },
      200,
    );
  },
);

// POST /api/students
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Students'],
    summary: '新增學生',
    request: {
      body: { content: { 'application/json': { schema: CreateStudentSchema } } },
    },
    responses: {
      201: {
        description: '學生建立成功',
        content: { 'application/json': { schema: z.object({ data: StudentSchema }) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    const { data, error } = await supabase
      .from('students')
      .insert({
        org_id: orgId,
        name: body.name,
        grade: body.grade,
        school: body.school,
        birthday: body.birthday ?? null,
        gender: body.gender ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        emergency_contact_name: body.emergencyContactName ?? null,
        emergency_contact_phone: body.emergencyContactPhone ?? null,
        notes: body.notes ?? null,
      })
      .select()
      .single();

    if (error) {
      return c.json({ error: '新增學生失敗', message: error.message }, 500);
    }

    const student = toStudentResponse(data as Record<string, unknown>);

    await logAudit(supabase, {
      orgId,
      userId: c.get('userId'),
      resourceType: 'student',
      resourceId: student.id,
      action: 'create',
      newValue: student,
    });

    return c.json({ data: student }, 201);
  },
);

// GET /api/students/:id
app.openapi(
  createRoute({
    method: 'get',
    path: '/:id',
    tags: ['Students'],
    summary: '取得學生詳情',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '學生詳情',
        content: { 'application/json': { schema: z.object({ data: StudentDetailSchema }) } },
      },
      404: { description: '學生不存在' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { data, error } = await supabase
      .from('students')
      .select(
        `*, parent_student_relations(
          id, is_primary, relation,
          parents(id, name, phone, email)
        )`,
      )
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (error || !data) {
      return c.json({ error: '學生不存在' }, 404);
    }

    const row = data as Record<string, unknown>;
    const relations = (row['parent_student_relations'] as Array<{
      id: string;
      is_primary: boolean;
      relation: string | null;
      parents: { id: string; name: string; phone: string | null; email: string | null } | null;
    }>) ?? [];

    const parents = relations
      .filter((r) => r.parents)
      .map((r) => ({
        id: r.parents!.id,
        name: r.parents!.name,
        phone: r.parents!.phone,
        email: r.parents!.email,
        relation: r.relation,
        isPrimary: r.is_primary,
      }));

    const parentNames = parents
      .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))
      .map((p) => p.name);

    return c.json(
      { data: { ...toStudentResponse(row, parentNames), parents } },
      200,
    );
  },
);

// PUT /api/students/:id
app.openapi(
  createRoute({
    method: 'put',
    path: '/:id',
    tags: ['Students'],
    summary: '更新學生資料',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateStudentSchema } } },
    },
    responses: {
      200: {
        description: '更新成功',
        content: { 'application/json': { schema: z.object({ data: StudentSchema }) } },
      },
      404: { description: '學生不存在' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const updatePayload: Record<string, unknown> = {};
    if (body.name !== undefined) updatePayload['name'] = body.name;
    if (body.grade !== undefined) updatePayload['grade'] = body.grade;
    if (body.school !== undefined) updatePayload['school'] = body.school;
    if (body.birthday !== undefined) updatePayload['birthday'] = body.birthday;
    if (body.gender !== undefined) updatePayload['gender'] = body.gender;
    if (body.phone !== undefined) updatePayload['phone'] = body.phone;
    if (body.address !== undefined) updatePayload['address'] = body.address;
    if (body.emergencyContactName !== undefined) updatePayload['emergency_contact_name'] = body.emergencyContactName;
    if (body.emergencyContactPhone !== undefined) updatePayload['emergency_contact_phone'] = body.emergencyContactPhone;
    if (body.notes !== undefined) updatePayload['notes'] = body.notes;
    if (body.isActive !== undefined) updatePayload['is_active'] = body.isActive;

    const { data, error } = await supabase
      .from('students')
      .update(updatePayload)
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single();

    if (error || !data) {
      return c.json({ error: '學生不存在或更新失敗' }, 404);
    }

    const updated = toStudentResponse(data as Record<string, unknown>);

    await logAudit(supabase, {
      orgId,
      userId: c.get('userId'),
      resourceType: 'student',
      resourceId: id,
      action: 'update',
      newValue: updated,
    });

    return c.json({ data: updated }, 200);
  },
);

// DELETE /api/students/:id (soft delete)
app.openapi(
  createRoute({
    method: 'delete',
    path: '/:id',
    tags: ['Students'],
    summary: '停用學生（軟刪除）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: { description: '停用成功' },
      404: { description: '學生不存在' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { error } = await supabase
      .from('students')
      .update({ is_active: false })
      .eq('id', id)
      .eq('org_id', orgId);

    if (error) {
      return c.json({ error: '停用失敗', message: error.message }, 500);
    }

    await logAudit(supabase, {
      orgId,
      userId: c.get('userId'),
      resourceType: 'student',
      resourceId: id,
      action: 'deactivate',
    });

    return c.json({ success: true }, 200);
  },
);

export default app;
```

- [ ] **Step 4: 在 index.ts 掛載 studentsRoute**

修改 `apps/api/src/index.ts`：

```typescript
// 新增 import（在現有 imports 下方）
import studentsRoute from './routes/students';

// 在 app.route('/api/sessions', sessionsRoute); 之後新增
app.route('/api/students', studentsRoute);
```

- [ ] **Step 5: 執行單元測試，確認通過**

```bash
npx nx test api --testFile=apps/api/src/routes/students.spec.ts
```

預期：PASS

- [ ] **Step 6: Build API 驗證**

```bash
npx nx build api
```

預期：Build 成功，無 TypeScript 錯誤

- [ ] **Step 7: 用 curl 驗證 API 端點**

確保 local Supabase 運行中（`supabase start`）且 API 服務運行（`npx nx serve api`）

```bash
# 取得 token（用 demo admin 登入）
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.clessia.app","password":"password123"}' \
  | jq -r '.token')

# 列出學生
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8787/api/students | jq '.meta'
```

預期：`meta.total >= 15`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/students.ts apps/api/src/routes/students.spec.ts apps/api/src/index.ts
git commit -m "feat: add students CRUD API with parent relations"
```

---

## Chunk 3: Phase 4 — Frontend Service

### Task 3: 建立 students.service.ts

> **委派 Codex**：Phase 4 (Frontend Service)
> sessionId: `students-phase4-service`

**Files:**
- Create: `apps/web/src/app/core/students.service.ts`

#### 版本資訊（Codex prompt 必須包含）
- Angular: ^21.1.0
- Pattern 參考：`apps/web/src/app/core/campuses.service.ts`

- [ ] **Step 1: 建立 `apps/web/src/app/core/students.service.ts`**

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type GradeLevel =
  | 'K'
  | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6'
  | 'J1' | 'J2' | 'J3'
  | 'S1' | 'S2' | 'S3';

export type StudentGender = 'male' | 'female' | 'prefer_not_to_say';

export interface Student {
  id: string;
  orgId: string;
  name: string;
  grade: GradeLevel;
  school: string;
  birthday: string | null;
  gender: StudentGender | null;
  phone: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  isActive: boolean;
  parentNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StudentDetailParent {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  relation: string | null;
  isPrimary: boolean;
}

export interface StudentDetail extends Student {
  parents: StudentDetailParent[];
}

export interface StudentListResponse {
  data: Student[];
  summary: { total: number; activeCount: number };
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface StudentQueryParams {
  search?: string;
  grade?: GradeLevel;
  page?: number;
  pageSize?: number;
  isActive?: boolean;
}

export interface CreateStudentInput {
  name: string;
  grade: GradeLevel;
  school: string;
  birthday?: string | null;
  gender?: StudentGender | null;
  phone?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  notes?: string | null;
}

export type UpdateStudentInput = Partial<CreateStudentInput> & { isActive?: boolean };

export const GRADE_LEVELS: GradeLevel[] = [
  'K',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'J1', 'J2', 'J3',
  'S1', 'S2', 'S3',
];

export const GRADE_LEVEL_LABELS: Record<GradeLevel, string> = {
  K: '幼稚園',
  P1: '小一', P2: '小二', P3: '小三', P4: '小四', P5: '小五', P6: '小六',
  J1: '國一', J2: '國二', J3: '國三',
  S1: '高一', S2: '高二', S3: '高三',
};

@Injectable({ providedIn: 'root' })
export class StudentsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.apiUrl}/api/students`;

  list(params?: StudentQueryParams): Observable<StudentListResponse> {
    return this.http.get<StudentListResponse>(this.endpoint, {
      params: this.toQueryParams(params),
    });
  }

  get(id: string): Observable<{ data: StudentDetail }> {
    return this.http.get<{ data: StudentDetail }>(`${this.endpoint}/${id}`);
  }

  create(input: CreateStudentInput): Observable<{ data: Student }> {
    return this.http.post<{ data: Student }>(this.endpoint, input);
  }

  update(id: string, input: UpdateStudentInput): Observable<{ data: Student }> {
    return this.http.put<{ data: Student }>(`${this.endpoint}/${id}`, input);
  }

  deactivate(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.endpoint}/${id}`);
  }

  private toQueryParams(params?: StudentQueryParams): Record<string, string | number | boolean> {
    if (!params) return {};
    const q: Record<string, string | number | boolean> = {};
    if (params.search !== undefined) q['search'] = params.search;
    if (params.grade !== undefined) q['grade'] = params.grade;
    if (params.page !== undefined) q['page'] = params.page;
    if (params.pageSize !== undefined) q['pageSize'] = params.pageSize;
    if (params.isActive !== undefined) q['isActive'] = params.isActive;
    return q;
  }
}
```

- [ ] **Step 2: Build 驗證**

```bash
npx nx build web --configuration=development
```

預期：Build 成功，無 TypeScript 錯誤

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/core/students.service.ts
git commit -m "feat: add StudentsService with CRUD methods and type definitions"
```

---

## Chunk 4: Phase 5 — Frontend UI

> **執行者：Claude（需設計判斷）**
> 實作前必須參考設計系統 + 現有 CampusesPage 模式

### Task 4: 更新 StudentsPage（列表 + 篩選）

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/students/students.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/students/students.page.html`
- Modify: `apps/web/src/app/features/admin/pages/students/students.page.scss`

> 設計原則：
> - 參考 `campuses.page.ts` 的 Signals + RxJS 混用模式
> - PrimeNG Table + 篩選工具列（搜尋框 + 年級下拉 + 篩選狀態）
> - 每列顯示：姓名、年級、學校、關聯家長、報名課程數（暫顯 `-`）、狀態 Tag
> - 點擊姓名 → 導向詳情頁 `/admin/students/:id`
> - 右側「新增學生」按鈕 → 開啟 `StudentFormDialogComponent`
> - 使用 `EmptyStateComponent` 處理空列表

- [ ] **Step 1: 使用 ui-ux-pro-max skill 設計 UI**

在開始前，invoke `ui-ux-pro-max` skill 確認設計方向（延續現有設計系統）。

- [ ] **Step 2: 更新 students.page.ts**

主要邏輯（參考 campuses.page.ts 結構）：
- Signals: `students`, `loading`, `searchQuery`, `gradeFilter`, `currentPage`, `total`, `summary`
- `inject(StudentsService)`, `inject(Router)`, `inject(MessageService)`, `inject(DialogService)`
- `ngOnInit()` → `loadStudents()`
- `onSearchChange()`, `onGradeChange()`, `onPageChange()` → reset page + reload
- `openCreateDialog()` → `StudentFormDialogComponent` → reload on close
- `openEditDialog(student)` → `StudentFormDialogComponent` → reload on close
- `navigateToDetail(id)` → `this.router.navigate(['/admin/students', id])`
- `confirmDeactivate(student)` → ConfirmDialogComponent → deactivate on confirm

- [ ] **Step 3: 更新 students.page.html**

結構：
```html
<p-toast />

<!-- Page Header (參考 subjects.page.html 的 page-header 樣式) -->
<div class="page-header">
  <div class="page-header__info">
    <h1>學生資料</h1>
    <span class="page-header__subtitle">共 {{ summary().total }} 位學生</span>
  </div>
  <div class="page-header__actions">
    <p-button label="新增學生" icon="pi pi-plus" (onClick)="openCreateDialog()" />
  </div>
</div>

<!-- Filter Bar -->
<div class="filter-bar">
  <p-iconfield iconPosition="left">
    <p-inputicon styleClass="pi pi-search" />
    <input pInputText placeholder="搜尋姓名..." (input)="onSearchChange($event.target.value)" />
  </p-iconfield>
  <p-select [options]="gradeOptions" placeholder="年級" [(ngModel)]="selectedGrade" (onChange)="onGradeChange($event.value)" />
  <!-- 分校篩選：Deferred - 需要 enrollments 表 -->
  <p-select [options]="campusOptions" placeholder="分校" [disabled]="true"
    pTooltip="分校篩選需報名功能上線後啟用" tooltipPosition="bottom" />
</div>

<!-- Table -->
<p-table [value]="students()" [loading]="loading()" ...>
  <!-- 姓名（可點擊）、年級、學校、關聯家長、課程數（-）、狀態、操作 -->
</p-table>

<!-- Paginator -->
<p-paginator ... />

<!-- Confirm Dialog -->
<app-confirm-dialog ... />
```

- [ ] **Step 4: Build 驗證**

```bash
npx nx build web --configuration=development
```

預期：Build 成功

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/students/
git commit -m "feat: implement students list page with search, filter, and pagination"
```

---

### Task 5: 建立 StudentFormDialogComponent

**Files:**
- Create: `apps/web/src/app/features/admin/pages/students/student-form-dialog.component.ts`
- Create: `apps/web/src/app/features/admin/pages/students/student-form-dialog.component.html`
- Create: `apps/web/src/app/features/admin/pages/students/student-form-dialog.component.scss`

> 設計原則：
> - 參考 `campus-form-dialog.component.ts` 的 DynamicDialogRef + DynamicDialogConfig 模式
> - `inject(DynamicDialogConfig)` 取得 `data.student`（編輯模式）或無（新增模式）
> - `inject(DynamicDialogRef)` 關閉時傳回 student（成功）或 undefined（取消）
> - 使用 PrimeNG Fluid + ReactiveFormsModule 建立 FormGroup
> - 欄位按規格：姓名*、年級*、就讀學校*、生日、性別、電話、地址、緊急聯絡人姓名、緊急聯絡人電話、備註
> - 年級使用 `<p-select [options]="gradeLevelOptions">` 展示中文標籤（K=幼稚園，P1=小一...）
> - 性別使用 `<p-select>` 或 Radio：男/女/不透露

- [ ] **Step 1: 使用 ng generate 建立 component**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
npx ng g c features/admin/pages/students/student-form-dialog --type component --project web
```

- [ ] **Step 2: 實作 student-form-dialog.component.ts**

關鍵實作點：
- `inject(DynamicDialogConfig<{ student?: Student }>)` 取得傳入資料
- `inject(DynamicDialogRef)` 控制 dialog 關閉
- FormGroup 含所有欄位，編輯時 patchValue
- `onSubmit()` → create 或 update → ref.close(savedStudent)
- 顯示 loading 狀態，避免重複提交

- [ ] **Step 3: Build 驗證**

```bash
npx nx build web --configuration=development
```

預期：Build 成功

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/students/student-form-dialog.component.*
git commit -m "feat: add StudentFormDialogComponent for create/edit students"
```

---

### Task 6: 更新 RoutesCatalog + app.routes.ts（學生詳情頁路由）

**Files:**
- Modify: `apps/web/src/app/core/smart-enums/routes-catalog.ts`
- Modify: `apps/web/src/app/app.routes.ts`

- [ ] **Step 1: 在 RoutesCatalog 新增 ADMIN_STUDENT_DETAIL**

在 `routes-catalog.ts` 的 `ADMIN_STUDENTS` 定義之後新增：

```typescript
public static readonly ADMIN_STUDENT_DETAIL = this.register(
  'students/:id',
  '/admin/students/:id',
  '學生詳情',
  UserType.ADMIN,
  'pi-user',
  false,           // 不顯示在 sidebar
  '學務管理',
);
```

- [ ] **Step 2: 在 app.routes.ts 的 admin 區塊新增詳情頁路由**

在 `ADMIN_STUDENTS` 路由之後新增：

```typescript
{
  path: RoutesCatalog.ADMIN_STUDENT_DETAIL.relativePath,
  loadComponent: () =>
    import('@features/admin/pages/students/detail/student-detail.page').then(
      (m) => m.StudentDetailPage,
    ),
  data: { page: RoutesCatalog.ADMIN_STUDENT_DETAIL },
},
```

> 注意：`relativePath` 為 `'students/:id'`（含 param），Angular Router 會正確解析。

- [ ] **Step 3: Build 驗證**

```bash
npx nx build web --configuration=development
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/core/smart-enums/routes-catalog.ts apps/web/src/app/app.routes.ts
git commit -m "feat: add student detail route to RoutesCatalog and app.routes"
```

---

### Task 7: 建立 StudentDetailPage

**Files:**
- Create: `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.ts`
- Create: `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.html`
- Create: `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.scss`

> 設計原則：
> - 頁面頂端：返回按鈕（← 學生資料）+ 學生姓名標題 + 「編輯」按鈕
> - 使用 `inject(ActivatedRoute)` 取得 `:id` param
> - 使用 Signals: `student`, `loading`, `error`
> - 區塊一：基本資料（唯讀展示所有欄位，或直接開啟 form dialog 編輯）
> - 區塊二：關聯家長列表（PrimeNG Table，顯示姓名/電話/關係）
> - 區塊三：**[Deferred Scope]** 報名課程列表 — 使用 `EmptyStateComponent`，說明「報名功能上線後顯示」（規格要求連結到報名頁，但 enrollments 表尚未建立）
> - 區塊四：**[Deferred Scope]** 出勤統計摘要 — 使用 `EmptyStateComponent`，說明「出勤功能上線後顯示」
> - 區塊五：**[Deferred Scope]** 成績統計摘要 — 使用 `EmptyStateComponent`，說明「成績功能上線後顯示」

- [ ] **Step 1: 使用 ng generate 建立 page component**

```bash
npx ng g c features/admin/pages/students/detail/student-detail --type page --project web
```

- [ ] **Step 2: 使用 ui-ux-pro-max skill 設計詳情頁佈局**

invoke `ui-ux-pro-max` 確認 detail page 的卡片佈局設計。

- [ ] **Step 3: 實作 student-detail.page.ts**

關鍵邏輯：
```typescript
private readonly route = inject(ActivatedRoute);
private readonly studentsService = inject(StudentsService);
private readonly router = inject(Router);

readonly student = signal<StudentDetail | null>(null);
readonly loading = signal(true);

ngOnInit(): void {
  const id = this.route.snapshot.paramMap.get('id');
  if (!id) { this.router.navigate(['/admin/students']); return; }
  this.studentsService.get(id).subscribe({
    next: (res) => { this.student.set(res.data); this.loading.set(false); },
    error: () => { this.router.navigate(['/admin/students']); },
  });
}

openEditDialog(): void {
  // 開啟 StudentFormDialogComponent，關閉後重新 load
}
```

- [ ] **Step 4: Build 驗證**

```bash
npx nx build web --configuration=development
```

預期：Build 成功

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/students/detail/
git commit -m "feat: add StudentDetailPage with basic info, parents list, and placeholder sections"
```

---

## Chunk 5: Phase 6 — E2E Validation

### Task 8: 端到端驗證

> **委派 Codex**：Phase 6 (E2E)
> sessionId: `students-phase6-e2e`

- [ ] **Step 1: 確認 local Supabase 運行且 seed 資料存在**

```bash
supabase db reset
supabase start
```

- [ ] **Step 2: 啟動 API 和 Web**

```bash
# Terminal 1
npx nx serve api

# Terminal 2
npx ng serve
```

- [ ] **Step 3: 手動驗證完整流程**

| 測試情境 | 步驟 | 預期結果 |
|---------|------|---------|
| 列表載入 | 開啟 `/admin/students` | 顯示 15 筆學生，含姓名/年級/學校/家長 |
| 搜尋篩選 | 輸入「林」 | 即時過濾只顯示姓名含「林」的學生 |
| 年級篩選 | 選擇「國一」 | 只顯示 J1 學生 |
| 新增學生 | 點擊「新增學生」，填寫表單，送出 | 學生出現在列表，顯示 Toast 成功訊息 |
| 編輯學生 | 點擊學生列的編輯按鈕，修改學校，送出 | 學生資料更新，顯示 Toast 成功訊息 |
| 詳情頁 | 點擊學生姓名 | 導向詳情頁，顯示基本資料 + 家長列表 |
| 返回列表 | 點擊「← 學生資料」 | 返回列表頁 |
| 停用學生 | 點擊停用按鈕 → 確認 | 學生從 active 列表消失 |

- [ ] **Step 4: Build 最終驗證**

```bash
npx nx build web --configuration=production
```

預期：Production build 成功

---

## 注意事項

1. **Codex 委派時**：prompt 必須包含版本資訊（Angular 21, PrimeNG 21, Hono 4, Zod 4），並附上參考檔案路徑
2. **Zod 4 語法**：使用 `z.uuid()` 而非 `z.string().uuid()`，`z.email()` 而非 `z.string().email()`
3. **RoutesCatalog 的 `register` 第 6 個參數**（`showInMenu = false`）確保詳情頁不出現在側欄
4. **Parent section in detail page** 目前只顯示已有資料，家長 CRUD（新增/移除家長關聯）是 parent feature 的範疇
5. **Deferred Scope**：`enrollments` / `attendances` / `grades` 相關功能及分校篩選均標記為 deferred，使用 EmptyState + disabled UI 佔位
6. **toStudentResponse 需 export**：在 `students.ts` 中改為 `export function toStudentResponse`，以便 unit test 引用
7. **audit_log resource_type**：`audit_logs` 表的 `resource_type` check constraint 目前只含 `'class', 'course', 'campus', 'staff', 'session'`，需在 migration 中加入 `'student'`。在 `20260316110000_create_students_and_parents.sql` 末尾加上：
   ```sql
   ALTER TABLE public.audit_logs
     DROP CONSTRAINT audit_logs_resource_type_check;
   ALTER TABLE public.audit_logs
     ADD CONSTRAINT audit_logs_resource_type_check
     CHECK (resource_type IN ('class', 'course', 'campus', 'staff', 'session', 'student'));
   ```
