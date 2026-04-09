# Enrollment 入班管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 enrollments 資料表、Enrollment API、開課班詳情頁（含學生名單 tab）、以及學生詳情頁「在籍班級」區塊。

**Architecture:** 後端新增 `enrollments` Hono 路由（`@hono/zod-openapi`），前端新增 `EnrollmentsService`、開課班詳情頁（獨立路由 `/admin/courses/:courseId/classes/:classId`）、學生選擇 Dialog、並更新學生詳情頁 placeholder。

**Tech Stack:** Supabase PostgreSQL、Hono + `@hono/zod-openapi`、Angular 21 Standalone Components + Signals、PrimeNG 21

---

## 檔案清單

### 新建

- `supabase/migrations/20260319000001_create_enrollments.sql` — enrollments 表 + enum + partial index + audit_logs 更新
- `apps/api/src/routes/enrollments.ts` — Enrollment CRUD + 狀態變更 API
- `apps/web/src/app/core/enrollments.service.ts` — Angular HTTP service
- `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts`
- `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html`
- `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.scss`
- `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.ts`
- `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.html`
- `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.scss`

### 修改

- `apps/api/src/index.ts` — 掛載 enrollmentsRoute
- `apps/web/src/app/core/smart-enums/routes-catalog.ts` — 新增 `ADMIN_CLASS_DETAIL`
- `apps/web/src/app/app.routes.ts` — 新增開課班詳情頁路由
- `apps/web/src/app/features/admin/pages/courses/courses.page.ts` — 班級點擊導航至詳情頁
- `apps/web/src/app/features/admin/pages/courses/courses.page.html` — 班級名稱改為可點擊連結
- `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.html` — 取代「在籍班級」placeholder
- `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.ts` — 載入 enrollments
- `apps/web/src/app/shared/components/confirm-dialog/confirm-dialog.component.ts` — 支援 requireNotes
- `apps/web/src/app/shared/components/confirm-dialog/confirm-dialog.component.html` — 加入 notes textarea

---

## Task 0：擴充 ConfirmDialogComponent 支援備註輸入

停權／退班操作需要填寫原因，現有 `ConfirmDialogComponent` 不支援。需擴充其介面，讓需要原因的操作能在 confirm dialog 內收集 notes 並回傳。

**Files:**

- Modify: `apps/web/src/app/shared/components/confirm-dialog/confirm-dialog.component.ts`
- Modify: `apps/web/src/app/shared/components/confirm-dialog/confirm-dialog.component.html`

- [ ] **Step 1: 擴充 `confirm-dialog.component.ts`**

將 `ConfirmDialogData` 介面加入 `requireNotes` 選項，並在 `accept()` 時一併回傳 notes：

```typescript
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';

export interface ConfirmDialogData {
  message: string;
  acceptLabel?: string;
  rejectLabel?: string;
  acceptSeverity?: 'danger' | 'warn' | 'success' | 'secondary';
  requireNotes?: boolean; // 若 true，顯示備註 textarea，且必填
  notesPlaceholder?: string; // 備註欄 placeholder
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [ButtonModule, FormsModule, TextareaModule],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  protected readonly config = inject(DynamicDialogConfig<ConfirmDialogData>);

  protected get data(): ConfirmDialogData {
    return this.config.data;
  }

  protected notes = '';

  protected get canAccept(): boolean {
    if (this.data.requireNotes) return this.notes.trim().length > 0;
    return true;
  }

  protected accept(): void {
    if (!this.canAccept) return;
    this.ref.close(this.data.requireNotes ? { notes: this.notes.trim() } : true);
  }

  protected reject(): void {
    this.ref.close(false);
  }
}
```

- [ ] **Step 2: 更新 `confirm-dialog.component.html`**

```html
<div class="confirm-dialog">
  <p class="confirm-dialog__message">{{ data.message }}</p>

  @if (data.requireNotes) {
  <div class="confirm-dialog__notes">
    <textarea
      pTextarea
      [(ngModel)]="notes"
      [placeholder]="data.notesPlaceholder ?? '請填寫原因（必填）'"
      rows="3"
      class="w-full"
    ></textarea>
  </div>
  }

  <div class="confirm-dialog__actions">
    <p-button
      [label]="data.rejectLabel ?? '取消'"
      [outlined]="true"
      severity="secondary"
      (onClick)="reject()"
    />
    <p-button
      [label]="data.acceptLabel ?? '確認'"
      [severity]="data.acceptSeverity ?? 'danger'"
      [disabled]="!canAccept"
      (onClick)="accept()"
    />
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/shared/components/confirm-dialog/
git commit -m "feat(shared): extend ConfirmDialogComponent to support requireNotes"
```

---

## Task 1：資料庫 Migration

**Files:**

- Create: `supabase/migrations/20260319000001_create_enrollments.sql`

- [ ] **Step 1: 建立 migration 檔案**

```sql
-- 20260319000001_create_enrollments.sql

-- ============================================================
-- enrollment_status enum
-- ============================================================
CREATE TYPE public.enrollment_status AS ENUM (
  'pending_payment',
  'active',
  'suspended',
  'withdrawal',
  'void'
);

-- ============================================================
-- payment_cycle enum
-- ============================================================
CREATE TYPE public.payment_cycle AS ENUM (
  'monthly',
  'semester'
);

-- ============================================================
-- enrollments 表
-- ============================================================
CREATE TABLE public.enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  status public.enrollment_status NOT NULL DEFAULT 'active',
  payment_cycle public.payment_cycle,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  notes text,
  created_by text REFERENCES public.ba_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX enrollments_org_id_idx ON public.enrollments (org_id);
CREATE INDEX enrollments_class_id_idx ON public.enrollments (class_id);
CREATE INDEX enrollments_student_id_idx ON public.enrollments (student_id);
CREATE INDEX enrollments_status_idx ON public.enrollments (status);

-- 同一學生在同一班只能有一筆非終態 enrollment（允許退班後重新加入）
CREATE UNIQUE INDEX enrollments_active_class_student_unique
  ON public.enrollments (class_id, student_id)
  WHERE status NOT IN ('withdrawal', 'void');

CREATE TRIGGER enrollments_updated_at
  BEFORE UPDATE ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read enrollments in own organization"
  ON public.enrollments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.org_id = enrollments.org_id
    )
  );

CREATE POLICY "Admins can manage enrollments"
  ON public.enrollments FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE p.id = (SELECT auth.uid())
        AND p.org_id = enrollments.org_id
        AND ur.role = 'admin'::public.user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE p.id = (SELECT auth.uid())
        AND p.org_id = enrollments.org_id
        AND ur.role = 'admin'::public.user_role
    )
  );

-- ============================================================
-- 更新 audit_logs resource_type constraint（加入 enrollment、student）
-- ============================================================
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_resource_type_check;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_resource_type_check
  CHECK (resource_type IN ('class', 'course', 'campus', 'staff', 'session', 'student', 'enrollment'));
```

- [ ] **Step 2: 套用 migration**

```bash
cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia
supabase db reset
```

確認輸出無錯誤，`enrollments` 表建立成功。

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260319000001_create_enrollments.sql
git commit -m "feat(db): create enrollments table with status enum and partial unique index"
```

---

## Task 2：Enrollment API

**Files:**

- Create: `apps/api/src/routes/enrollments.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: 建立 `apps/api/src/routes/enrollments.ts`**

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

// ============================================================
// Schemas
// ============================================================

const EnrollmentStatusSchema = z
  .enum(['pending_payment', 'active', 'suspended', 'withdrawal', 'void'])
  .openapi('EnrollmentStatus');

const PaymentCycleSchema = z.enum(['monthly', 'semester']).openapi('PaymentCycle');

const EnrollmentSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    classId: z.uuid(),
    className: z.string(),
    studentId: z.uuid(),
    studentName: z.string(),
    status: EnrollmentStatusSchema,
    paymentCycle: PaymentCycleSchema.nullable(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
    notes: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdByName: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Enrollment');

const EnrollmentListResponseSchema = z
  .object({
    data: z.array(EnrollmentSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('EnrollmentListResponse');

const CreateEnrollmentSchema = z
  .object({
    classId: z.uuid(),
    studentId: z.uuid(),
    status: z.enum(['pending_payment', 'active']).default('active'),
    paymentCycle: PaymentCycleSchema.optional(),
    effectiveFrom: z.string().date().optional(),
    effectiveTo: z.string().date().nullable().optional(),
    notes: z.string().max(2000).optional(),
  })
  .openapi('CreateEnrollment');

const UpdateEnrollmentSchema = z
  .object({
    paymentCycle: PaymentCycleSchema.nullable().optional(),
    effectiveFrom: z.string().date().optional(),
    effectiveTo: z.string().date().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .openapi('UpdateEnrollment');

const UpdateEnrollmentStatusSchema = z
  .object({
    status: EnrollmentStatusSchema,
    notes: z.string().max(2000).optional(),
  })
  .openapi('UpdateEnrollmentStatus');

// ============================================================
// Helper
// ============================================================

function toEnrollmentResponse(row: any): z.infer<typeof EnrollmentSchema> {
  return {
    id: row.id,
    orgId: row.org_id,
    classId: row.class_id,
    className: row.classes?.name ?? '',
    studentId: row.student_id,
    studentName: row.students?.name ?? '',
    status: row.status,
    paymentCycle: row.payment_cycle ?? null,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to ?? null,
    notes: row.notes ?? null,
    createdBy: row.created_by ?? null,
    createdByName: row.creator?.name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/enrollments
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Enrollments'],
    request: {
      query: z.object({
        classId: z.uuid().optional(),
        studentId: z.uuid().optional(),
        status: EnrollmentStatusSchema.optional(),
        page: z.coerce.number().int().min(1).default(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: {
        content: { 'application/json': { schema: EnrollmentListResponseSchema } },
        description: 'OK',
      },
    },
  }),
  async (c) => {
    const { classId, studentId, status, page = 1, pageSize = 20 } = c.req.valid('query');
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');

    let query = supabase
      .from('enrollments')
      .select(
        'id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name), students(name), creator:ba_user!created_by(name)',
        { count: 'exact' },
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (classId) query = query.eq('class_id', classId);
    if (studentId) query = query.eq('student_id', studentId);
    if (status) query = query.eq('status', status);

    const { data, count, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    const total = count ?? 0;
    return c.json({
      data: (data ?? []).map(toEnrollmentResponse),
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  },
);

// POST /api/enrollments
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Enrollments'],
    request: { body: { content: { 'application/json': { schema: CreateEnrollmentSchema } } } },
    responses: {
      201: {
        content: { 'application/json': { schema: z.object({ data: EnrollmentSchema }) } },
        description: 'Created',
      },
      400: {
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
        description: 'Bad Request',
      },
      409: {
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
        description: 'Conflict',
      },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const supabase = c.get('supabase');

    const { data, error } = await supabase
      .from('enrollments')
      .insert({
        org_id: orgId,
        class_id: body.classId,
        student_id: body.studentId,
        status: body.status ?? 'active',
        payment_cycle: body.paymentCycle ?? null,
        effective_from: body.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        effective_to: body.effectiveTo ?? null,
        notes: body.notes ?? null,
        created_by: userId,
      })
      .select(
        'id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name), students(name), creator:ba_user!created_by(name)',
      )
      .single();

    if (error) {
      if (error.code === '23505') return c.json({ error: 'ALREADY_ENROLLED' }, 409);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ data: toEnrollmentResponse(data) }, 201);
  },
);

// PATCH /api/enrollments/:id
app.openapi(
  createRoute({
    method: 'patch',
    path: '/:id',
    tags: ['Enrollments'],
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateEnrollmentSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ data: EnrollmentSchema }) } },
        description: 'OK',
      },
      404: {
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
        description: 'Not Found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');

    const updates: Record<string, unknown> = {};
    if (body.paymentCycle !== undefined) updates.payment_cycle = body.paymentCycle;
    if (body.effectiveFrom !== undefined) updates.effective_from = body.effectiveFrom;
    if (body.effectiveTo !== undefined) updates.effective_to = body.effectiveTo;
    if (body.notes !== undefined) updates.notes = body.notes;

    const { data, error } = await supabase
      .from('enrollments')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select(
        'id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name), students(name), creator:ba_user!created_by(name)',
      )
      .single();

    if (error) return c.json({ error: 'NOT_FOUND' }, 404);
    return c.json({ data: toEnrollmentResponse(data) });
  },
);

// PATCH /api/enrollments/:id/status
app.openapi(
  createRoute({
    method: 'patch',
    path: '/:id/status',
    tags: ['Enrollments'],
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateEnrollmentStatusSchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ data: EnrollmentSchema }) } },
        description: 'OK',
      },
      400: {
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
        description: 'Bad Request',
      },
      404: {
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
        description: 'Not Found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { status, notes } = c.req.valid('json');
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');

    // notes 必填：suspended / withdrawal / void
    if (['suspended', 'withdrawal', 'void'].includes(status) && !notes?.trim()) {
      return c.json({ error: 'NOTES_REQUIRED' }, 400);
    }

    // 查詢現有狀態
    const { data: existing } = await supabase
      .from('enrollments')
      .select('status')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!existing) return c.json({ error: 'NOT_FOUND' }, 404);

    // 終態不可轉換
    if (['withdrawal', 'void'].includes(existing.status)) {
      return c.json({ error: 'TERMINAL_STATE' }, 400);
    }

    // pending_payment 不可轉 suspended
    if (existing.status === 'pending_payment' && status === 'suspended') {
      return c.json({ error: 'INVALID_TRANSITION' }, 400);
    }

    const updates: Record<string, unknown> = { status };
    if (notes) updates.notes = notes;
    // 終態自動填 effective_to
    if (['withdrawal', 'void'].includes(status)) {
      updates.effective_to = new Date().toISOString().slice(0, 10);
    }

    const { data, error } = await supabase
      .from('enrollments')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select(
        'id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name), students(name), creator:ba_user!created_by(name)',
      )
      .single();

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ data: toEnrollmentResponse(data) });
  },
);

// DELETE /api/enrollments/:id（只允許 pending_payment）
app.openapi(
  createRoute({
    method: 'delete',
    path: '/:id',
    tags: ['Enrollments'],
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      204: { description: 'No Content' },
      400: {
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
        description: 'Bad Request',
      },
      404: {
        content: { 'application/json': { schema: z.object({ error: z.string() }) } },
        description: 'Not Found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');

    const { data: existing } = await supabase
      .from('enrollments')
      .select('status')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!existing) return c.json({ error: 'NOT_FOUND' }, 404);
    if (existing.status !== 'pending_payment') return c.json({ error: 'CANNOT_DELETE' }, 400);

    await supabase.from('enrollments').delete().eq('id', id);
    return new Response(null, { status: 204 });
  },
);

export default app;
```

- [ ] **Step 2: 掛載至 `apps/api/src/index.ts`**

在 `parentsRoute` import 下方新增：

```typescript
import enrollmentsRoute from './routes/enrollments';
```

在 `app.route('/api/parents', parentsRoute)` 下方新增：

```typescript
app.route('/api/enrollments', enrollmentsRoute);
```

- [ ] **Step 3: 啟動 API 確認無編譯錯誤**

```bash
cd apps/api && npx wrangler dev --local
```

確認 `/api/enrollments` 路由出現在 Swagger UI（http://localhost:8787/ui）。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/enrollments.ts apps/api/src/index.ts
git commit -m "feat(api): add enrollments CRUD routes with status machine"
```

---

## Task 3：前端 EnrollmentsService

**Files:**

- Create: `apps/web/src/app/core/enrollments.service.ts`

- [ ] **Step 1: 建立 service**

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type EnrollmentStatus = 'pending_payment' | 'active' | 'suspended' | 'withdrawal' | 'void';
export type PaymentCycle = 'monthly' | 'semester';

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  pending_payment: '待付款',
  active: '在籍',
  suspended: '暫停',
  withdrawal: '退班',
  void: '失效',
};

export interface Enrollment {
  id: string;
  orgId: string;
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  status: EnrollmentStatus;
  paymentCycle: PaymentCycle | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEnrollmentInput {
  classId: string;
  studentId: string;
  status?: 'pending_payment' | 'active';
  paymentCycle?: PaymentCycle;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  notes?: string;
}

export interface UpdateEnrollmentInput {
  paymentCycle?: PaymentCycle | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  notes?: string | null;
}

export interface EnrollmentListResponse {
  data: Enrollment[];
  meta: { total: number; page: number; pageSize: number; totalPages: number };
}

export interface EnrollmentQueryParams {
  classId?: string;
  studentId?: string;
  status?: EnrollmentStatus;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class EnrollmentsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/enrollments`;

  list(params: EnrollmentQueryParams = {}): Observable<EnrollmentListResponse> {
    const query = new URLSearchParams();
    if (params.classId) query.set('classId', params.classId);
    if (params.studentId) query.set('studentId', params.studentId);
    if (params.status) query.set('status', params.status);
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return this.http.get<EnrollmentListResponse>(`${this.base}?${query}`);
  }

  create(input: CreateEnrollmentInput): Observable<{ data: Enrollment }> {
    return this.http.post<{ data: Enrollment }>(this.base, input);
  }

  update(id: string, input: UpdateEnrollmentInput): Observable<{ data: Enrollment }> {
    return this.http.patch<{ data: Enrollment }>(`${this.base}/${id}`, input);
  }

  updateStatus(
    id: string,
    status: EnrollmentStatus,
    notes?: string,
  ): Observable<{ data: Enrollment }> {
    return this.http.patch<{ data: Enrollment }>(`${this.base}/${id}/status`, { status, notes });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/core/enrollments.service.ts
git commit -m "feat(service): add EnrollmentsService"
```

---

## Task 4：RoutesCatalog + 路由設定

**Files:**

- Modify: `apps/web/src/app/core/smart-enums/routes-catalog.ts`
- Modify: `apps/web/src/app/app.routes.ts`

- [ ] **Step 1: 在 `routes-catalog.ts` 的 `ADMIN_COURSES` 下方新增**

```typescript
public static readonly ADMIN_CLASS_DETAIL = this.register(
  'courses/:courseId/classes/:classId',
  '/admin/courses/:courseId/classes/:classId',
  '開課班詳情',
  UserType.ADMIN,
  'pi-users',
  false,
  '課務管理',
);
```

- [ ] **Step 2: 在 `app.routes.ts` 的 admin children 中，於 `ADMIN_COURSES` 路由下方新增**

```typescript
{
  path: RoutesCatalog.ADMIN_CLASS_DETAIL.relativePath,
  loadComponent: () =>
    import('@features/admin/pages/courses/class-detail/class-detail.page').then(
      (m) => m.ClassDetailPage,
    ),
  canActivate: [authGuard, roleGuard(['admin'])],
  data: { page: RoutesCatalog.ADMIN_CLASS_DETAIL },
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/core/smart-enums/routes-catalog.ts apps/web/src/app/app.routes.ts
git commit -m "feat(routes): add ADMIN_CLASS_DETAIL route"
```

---

## Task 5：學生選擇 Dialog

**Files:**

- Create: `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.ts`
- Create: `.../student-picker-dialog.component.html`
- Create: `.../student-picker-dialog.component.scss`

- [ ] **Step 1: 建立 component（使用 ng generate）**

```bash
cd apps/web
npx ng generate component features/admin/pages/courses/class-detail/student-picker-dialog \
  --type component --standalone --no-spec
```

- [ ] **Step 2: 實作 `student-picker-dialog.component.ts`**

```typescript
import { Component, OnInit, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import {
  StudentsService,
  Student,
  GradeLevel,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
} from '@core/students.service';

@Component({
  selector: 'app-student-picker-dialog',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TagModule,
    SkeletonModule,
    IconFieldModule,
    InputIconModule,
  ],
  templateUrl: './student-picker-dialog.component.html',
  styleUrl: './student-picker-dialog.component.scss',
})
export class StudentPickerDialogComponent implements OnInit {
  private readonly studentsService = inject(StudentsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchSubject = new Subject<string>();

  protected readonly loading = signal(true);
  protected readonly students = signal<Student[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly PAGE_SIZE = 8;

  protected readonly searchQuery = signal('');
  // ngModel 用 plain properties（signals 不相容 [(ngModel)] two-way binding）
  protected selectedGrade: GradeLevel | null = null;
  protected selectedGender: string | null = null;
  protected selectedIsActive: boolean | null = null;

  // 已在班的學生 ID 列表（從 config.data 傳入）
  private readonly existingStudentIds = new Set<string>(this.config.data?.existingStudentIds ?? []);

  protected readonly gradeOptions = [
    { label: '全部年級', value: null },
    ...GRADE_LEVELS.map((g) => ({ label: GRADE_LEVEL_LABELS[g], value: g })),
  ];
  protected readonly gradeLabelMap = GRADE_LEVEL_LABELS;
  protected readonly genderOptions = [
    { label: '全部性別', value: null },
    { label: '男', value: 'male' },
    { label: '女', value: 'female' },
    { label: '不提供', value: 'prefer_not_to_say' },
  ];
  protected readonly isActiveOptions = [
    { label: '全部狀態', value: null },
    { label: '在籍', value: true },
    { label: '停用', value: false },
  ];
  protected readonly hasEnrollmentOptions = [
    { label: '全部', value: null },
    { label: '已有報名班級', value: true },
    { label: '尚未報名', value: false },
  ];

  protected readonly filteredStudents = computed(() =>
    this.students().filter((s) => !this.existingStudentIds.has(s.id)),
  );

  ngOnInit(): void {
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.searchQuery.set(value);
        this.currentPage.set(1);
        this.load();
      });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.studentsService
      .list({
        search: this.searchQuery() || undefined,
        grade: this.selectedGrade ?? undefined,
        isActive: this.selectedIsActive ?? undefined,
        page: this.currentPage(),
        pageSize: this.PAGE_SIZE,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.students.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  protected onSearchChange(value: string): void {
    this.searchSubject.next(value);
  }

  protected onFilterChange(): void {
    this.currentPage.set(1);
    this.load();
  }

  protected select(student: Student): void {
    this.ref.close(student);
  }

  protected cancel(): void {
    this.ref.close();
  }
}
```

- [ ] **Step 3: 實作 `student-picker-dialog.component.html`**

```html
<div class="student-picker">
  <div class="dialog-header-inline">
    <span class="dialog-header-inline__title">選擇學生</span>
    <button type="button" class="dialog-header-inline__close" (click)="cancel()" aria-label="關閉">
      <i class="pi pi-times"></i>
    </button>
  </div>

  <!-- 搜尋 + 篩選 -->
  <div class="student-picker__filters">
    <p-iconfield class="student-picker__search">
      <p-inputicon styleClass="pi pi-search" />
      <input
        type="text"
        pInputText
        placeholder="搜尋學生姓名"
        (input)="onSearchChange($any($event.target).value)"
        class="w-full"
      />
    </p-iconfield>
    <div class="student-picker__filter-row">
      <p-select
        [options]="gradeOptions"
        [ngModel]="selectedGrade"
        (ngModelChange)="selectedGrade = $event; onFilterChange()"
        optionLabel="label"
        optionValue="value"
        placeholder="年級"
        styleClass="w-full"
      />
      <p-select
        [options]="genderOptions"
        [ngModel]="selectedGender"
        (ngModelChange)="selectedGender = $event; onFilterChange()"
        optionLabel="label"
        optionValue="value"
        placeholder="性別"
        styleClass="w-full"
      />
      <p-select
        [options]="isActiveOptions"
        [ngModel]="selectedIsActive"
        (ngModelChange)="selectedIsActive = $event; onFilterChange()"
        optionLabel="label"
        optionValue="value"
        placeholder="狀態"
        styleClass="w-full"
      />
    </div>
  </div>

  <!-- 學生列表 -->
  <div class="student-picker__list">
    @if (loading()) { @for (i of [1,2,3,4,5]; track i) {
    <div class="student-picker__skeleton">
      <p-skeleton height="48px" />
    </div>
    } } @else if (filteredStudents().length === 0) {
    <div class="student-picker__empty">
      <i class="pi pi-users"></i>
      <span>沒有符合條件的學生</span>
    </div>
    } @else { @for (student of filteredStudents(); track student.id) {
    <button type="button" class="student-picker__item" (click)="select(student)">
      <div class="student-picker__item-info">
        <span class="student-picker__item-name">{{ student.name }}</span>
        <span class="student-picker__item-meta"
          >{{ gradeLabelMap[student.grade] }} · {{ student.school }}</span
        >
      </div>
      <i class="pi pi-chevron-right student-picker__item-arrow"></i>
    </button>
    } }
  </div>

  <div class="student-picker__footer">
    <p-button label="取消" [text]="true" severity="secondary" (onClick)="cancel()" />
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/
git commit -m "feat(ui): add StudentPickerDialogComponent"
```

---

## Task 6：開課班詳情頁

**Files:**

- Create: `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts`
- Create: `.../class-detail.page.html`
- Create: `.../class-detail.page.scss`

- [ ] **Step 1: 建立 page component**

```bash
npx ng generate component features/admin/pages/courses/class-detail/class-detail \
  --type page --standalone --no-spec
```

- [ ] **Step 2: 實作 `class-detail.page.ts`**

```typescript
import { Component, OnInit, inject, signal, computed, DestroyRef, input } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TabsModule } from 'primeng/tabs';
import { MenuModule } from 'primeng/menu';
import { Menu } from 'primeng/menu';
import { SkeletonModule } from 'primeng/skeleton';
import { MessageService } from 'primeng/api';
import type { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { ClassesService, Class } from '@core/classes.service';
import {
  EnrollmentsService,
  Enrollment,
  EnrollmentStatus,
  ENROLLMENT_STATUS_LABELS,
} from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { StudentPickerDialogComponent } from './student-picker-dialog/student-picker-dialog.component';
import type { Student } from '@core/students.service';
import { viewChild } from '@angular/core';

@Component({
  selector: 'app-class-detail',
  standalone: true,
  imports: [ButtonModule, TagModule, ToastModule, TabsModule, MenuModule, SkeletonModule],
  providers: [MessageService, DialogService],
  templateUrl: './class-detail.page.html',
  styleUrl: './class-detail.page.scss',
})
export class ClassDetailPage implements OnInit {
  private readonly classesService = inject(ClassesService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly page = input.required<RouteObj>();

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  protected readonly cls = signal<Class | null>(null);
  protected readonly enrollments = signal<Enrollment[]>([]);
  protected readonly loading = signal(true);
  protected readonly enrollmentsLoading = signal(true);

  protected readonly statusLabels = ENROLLMENT_STATUS_LABELS;

  protected readonly actionMenu = viewChild.required<Menu>('actionMenu');
  protected readonly selectedEnrollment = signal<Enrollment | null>(null);
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const e = this.selectedEnrollment();
    if (!e) return [];
    const items: MenuItem[] = [];
    if (e.status === 'active') {
      items.push({ label: '停權', icon: 'pi pi-lock', command: () => this.confirmSuspend(e) });
    }
    if (e.status === 'suspended') {
      items.push({
        label: '恢復在籍',
        icon: 'pi pi-unlock',
        command: () => this.changeStatus(e, 'active'),
      });
    }
    if (e.status === 'pending_payment') {
      items.push({
        label: '確認收款',
        icon: 'pi pi-check',
        command: () => this.changeStatus(e, 'active'),
      });
      items.push({ label: '刪除', icon: 'pi pi-trash', command: () => this.confirmDelete(e) });
    }
    if (!['withdrawal', 'void'].includes(e.status)) {
      items.push({ separator: true });
      items.push({
        label: '退班',
        icon: 'pi pi-sign-out',
        command: () => this.confirmWithdrawal(e),
      });
    }
    return items;
  });

  // route params（由 ActivatedRoute 取得，透過 input binding）
  // 注意：需搭配 withComponentInputBinding() in app.config.ts
  readonly courseId = input.required<string>();
  readonly classId = input.required<string>();

  ngOnInit(): void {
    this.loadClass();
    this.loadEnrollments();
  }

  protected loadClass(): void {
    this.classesService
      .get(this.classId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.cls.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '載入失敗',
            detail: '無法載入班級資料',
          });
          this.loading.set(false);
        },
      });
  }

  protected loadEnrollments(): void {
    this.enrollmentsLoading.set(true);
    this.enrollmentsService
      .list({ classId: this.classId(), pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.enrollments.set(res.data);
          this.enrollmentsLoading.set(false);
        },
        error: () => this.enrollmentsLoading.set(false),
      });
  }

  protected openActionMenu(event: MouseEvent, enrollment: Enrollment): void {
    this.selectedEnrollment.set(enrollment);
    this.actionMenu().toggle(event);
  }

  protected openStudentPicker(): void {
    const existingStudentIds = this.enrollments()
      .filter((e) => !['withdrawal', 'void'].includes(e.status))
      .map((e) => e.studentId);

    const ref = this.dialogService.open(StudentPickerDialogComponent, {
      width: '560px',
      modal: true,
      showHeader: false,
      appendTo: this.overlayContainer || 'body',
      data: { existingStudentIds },
    });

    ref.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((student?: Student) => {
      if (!student) return;
      this.addStudent(student);
    });
  }

  private addStudent(student: Student): void {
    const activeCount = this.enrollments().filter((e) =>
      ['active', 'pending_payment'].includes(e.status),
    ).length;
    const maxStudents = this.cls()?.maxStudents ?? 0;

    this.enrollmentsService
      .create({
        classId: this.classId(),
        studentId: student.id,
        status: 'active',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (activeCount >= maxStudents) {
            this.messageService.add({
              severity: 'warn',
              summary: '已超過人數上限',
              detail: `班級人數已達 ${maxStudents} 人，已超額加入`,
            });
          } else {
            this.messageService.add({
              severity: 'success',
              summary: '已加入',
              detail: `「${student.name}」已加入班級`,
            });
          }
          this.loadEnrollments();
        },
        error: (err) => {
          const code = err.error?.error;
          const detail = code === 'ALREADY_ENROLLED' ? '該學生已在此班' : '請稍後再試';
          this.messageService.add({ severity: 'error', summary: '加入失敗', detail });
        },
      });
  }

  protected changeStatus(enrollment: Enrollment, status: EnrollmentStatus, notes?: string): void {
    this.enrollmentsService
      .updateStatus(enrollment.id, status, notes)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: '狀態已更新',
            detail: ENROLLMENT_STATUS_LABELS[status],
          });
          this.loadEnrollments();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: '更新失敗', detail: '請稍後再試' });
        },
      });
  }

  private confirmSuspend(enrollment: Enrollment): void {
    this.openConfirmDialog(
      '停權',
      {
        message: `確定要停權「${enrollment.studentName}」嗎？請填寫停權原因。`,
        acceptLabel: '停權',
        rejectLabel: '取消',
        acceptSeverity: 'warn',
        requireNotes: true,
      },
      (notes) => this.changeStatus(enrollment, 'suspended', notes),
    );
  }

  private confirmWithdrawal(enrollment: Enrollment): void {
    this.openConfirmDialog(
      '退班',
      {
        message: `確定要讓「${enrollment.studentName}」退班嗎？`,
        acceptLabel: '退班',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
        requireNotes: true,
      },
      (notes) => this.changeStatus(enrollment, 'withdrawal', notes),
    );
  }

  private confirmDelete(enrollment: Enrollment): void {
    this.openConfirmDialog(
      '刪除報名',
      {
        message: `確定要刪除「${enrollment.studentName}」的報名記錄嗎？`,
        acceptLabel: '刪除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => {
        this.enrollmentsService
          .delete(enrollment.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.messageService.add({ severity: 'success', summary: '已刪除' });
              this.loadEnrollments();
            },
          });
      },
    );
  }

  private openConfirmDialog(
    header: string,
    data: ConfirmDialogData,
    onAccept: (notes?: string) => void,
  ): void {
    const ref = this.dialogService.open(ConfirmDialogComponent, {
      header,
      width: '420px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data,
    });
    ref.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (result) onAccept(typeof result === 'object' ? result.notes : undefined);
    });
  }

  protected getStatusSeverity(
    status: EnrollmentStatus,
  ): 'success' | 'warn' | 'secondary' | 'danger' {
    if (status === 'active') return 'success';
    if (status === 'pending_payment') return 'warn';
    if (status === 'suspended') return 'secondary';
    return 'danger';
  }

  protected goBack(): void {
    this.router.navigate(['/admin/courses']);
  }
}
```

- [ ] **Step 3: 實作 `class-detail.page.html`**

```html
<p-toast position="top-center" [baseZIndex]="30000" />
<p-menu
  #actionMenu
  [model]="actionMenuItems()"
  [popup]="true"
  [appendTo]="overlayContainer || 'body'"
/>

<div class="class-detail">
  <div class="class-detail__nav">
    <p-button
      label="課程列表"
      icon="pi pi-arrow-left"
      [text]="true"
      severity="secondary"
      (onClick)="goBack()"
    />
  </div>

  @if (loading()) {
  <div class="class-detail__loading">
    <i class="pi pi-spinner pi-spin" style="font-size: 2rem; color: var(--zinc-400)"></i>
  </div>
  } @else if (cls()) {
  <div class="class-detail__header">
    <div class="class-detail__title-row">
      <h1 class="class-detail__title">{{ cls()!.name }}</h1>
      <p-tag
        [value]="cls()!.isActive ? '開班中' : '已停班'"
        [severity]="cls()!.isActive ? 'success' : 'secondary'"
      />
    </div>
    <div class="class-detail__meta">
      <span>{{ cls()!.courseName }}</span>
      <span class="class-detail__sep">·</span>
      <span>上限 {{ cls()!.maxStudents }} 人</span>
    </div>
  </div>

  <p-tabs value="0">
    <p-tablist>
      <p-tab value="0">學生名單</p-tab>
      <p-tab value="1">課表</p-tab>
    </p-tablist>

    <p-tabpanels>
      <!-- 學生名單 tab -->
      <p-tabpanel value="0">
        <div class="class-detail__tab-actions">
          <p-button
            label="加入學生"
            icon="pi pi-user-plus"
            (onClick)="openStudentPicker()"
            [disabled]="!cls()!.isActive"
          />
        </div>

        @if (enrollmentsLoading()) {
        <div class="class-detail__skeletons">
          @for (i of [1,2,3]; track i) {
          <p-skeleton height="56px" styleClass="mb-2" />
          }
        </div>
        } @else if (enrollments().length === 0) {
        <div class="class-detail__empty">
          <i class="pi pi-users"></i>
          <span>尚未加入任何學生</span>
        </div>
        } @else {
        <div class="class-detail__student-list">
          @for (enrollment of enrollments(); track enrollment.id) {
          <div class="class-detail__student-item">
            <div class="class-detail__student-avatar">
              <i class="pi pi-user"></i>
            </div>
            <div class="class-detail__student-info">
              <span class="class-detail__student-name">{{ enrollment.studentName }}</span>
              <span class="class-detail__student-since">自 {{ enrollment.effectiveFrom }}</span>
            </div>
            <p-tag
              [value]="statusLabels[enrollment.status]"
              [severity]="getStatusSeverity(enrollment.status)"
            />
            <button
              type="button"
              class="class-detail__action-btn"
              (click)="openActionMenu($event, enrollment)"
              aria-label="操作"
            >
              <i class="pi pi-ellipsis-v"></i>
            </button>
          </div>
          }
        </div>
        }
      </p-tabpanel>

      <!-- 課表 tab -->
      <p-tabpanel value="1">
        <div class="class-detail__schedules">
          @if (cls()!.schedules?.length === 0) {
          <div class="class-detail__empty">
            <i class="pi pi-calendar"></i>
            <span>尚未設定課表</span>
          </div>
          } @else { @for (schedule of cls()!.schedules ?? []; track schedule.id) {
          <div class="class-detail__schedule-item">
            <span class="class-detail__schedule-day">{{ getWeekdayLabel(schedule.weekday) }}</span>
            <span class="class-detail__schedule-time"
              >{{ schedule.startTime }} – {{ schedule.endTime }}</span
            >
            @if (schedule.teacherName) {
            <span class="class-detail__schedule-teacher">{{ schedule.teacherName }}</span>
            }
          </div>
          } }
        </div>
      </p-tabpanel>
    </p-tabpanels>
  </p-tabs>
  }
</div>
```

> 注意：`getWeekdayLabel()` 方法需在 `.ts` 中補上：
>
> ```typescript
> protected getWeekdayLabel(weekday: number): string {
>   return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
> }
> ```

- [ ] **Step 4: 確認 `ClassesService` 有 `get(id)` 方法**

查看 `apps/web/src/app/core/classes.service.ts`，若無 `get(id): Observable<{ data: Class }>` 方法則補上：

```typescript
get(id: string): Observable<{ data: Class }> {
  return this.http.get<{ data: Class }>(`${this.base}/${id}?includeSchedules=true`);
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/class-detail/
git commit -m "feat(ui): add ClassDetailPage with student list tab"
```

---

## Task 7：courses 列表頁 — 班級點擊導航

**Files:**

- Modify: `apps/web/src/app/features/admin/pages/courses/courses.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/courses/courses.page.html`

- [ ] **Step 1: 在 `courses.page.ts` 注入 Router，新增導航方法**

```typescript
// 在 inject() 區塊新增：
private readonly router = inject(Router);

// 新增方法：
protected navigateToClass(courseId: string, classId: string): void {
  this.router.navigate(['/admin/courses', courseId, 'classes', classId]);
}
```

- [ ] **Step 2: 在 `courses.page.html` 的班級名稱處改為可點擊**

找到顯示班級名稱的元素，改為：

```html
<button type="button" class="class-name-link" (click)="navigateToClass(course.id, cls.id)">
  {{ cls.name }}
</button>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/courses.page.ts apps/web/src/app/features/admin/pages/courses/courses.page.html
git commit -m "feat(ui): navigate to class detail page from courses list"
```

---

## Task 8：學生詳情頁 — 在籍班級區塊

**Files:**

- Modify: `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.html`

- [ ] **Step 1: 在 `student-detail.page.ts` 載入 enrollments**

新增以下 inject 和 signal：

```typescript
private readonly enrollmentsService = inject(EnrollmentsService);
protected readonly enrollments = signal<Enrollment[]>([]);
protected readonly enrollmentsLoading = signal(false);
protected readonly ENROLLMENT_STATUS_LABELS = ENROLLMENT_STATUS_LABELS;
```

在 `ngOnInit` 或 `loadStudent()` 成功後呼叫：

```typescript
private loadEnrollments(studentId: string): void {
  this.enrollmentsLoading.set(true);
  this.enrollmentsService.list({
    studentId,
    pageSize: 50,
    // 不帶 status 篩選，client-side 過濾 active + pending_payment
  }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
    next: (res) => {
      this.enrollments.set(
        res.data.filter((e) => ['active', 'pending_payment'].includes(e.status)),
      );
      this.enrollmentsLoading.set(false);
    },
    error: () => this.enrollmentsLoading.set(false),
  });
}
```

- [ ] **Step 2: 取代 `student-detail.page.html` 的「報名課程」placeholder**

將以下 deferred placeholder：

```html
<!-- Deferred: Enrollments -->
<div class="student-detail__section-card student-detail__section-card--deferred">...</div>
```

替換為：

```html
<!-- 在籍班級 -->
<div class="student-detail__section-card">
  <h2 class="student-detail__section-title">在籍班級</h2>
  @if (enrollmentsLoading()) {
  <p-skeleton height="48px" />
  } @else if (enrollments().length === 0) {
  <div class="student-detail__empty-section">
    <i class="pi pi-list"></i>
    <span>尚未加入任何班級</span>
  </div>
  } @else {
  <div class="student-detail__enrollments-list">
    @for (enrollment of enrollments(); track enrollment.id) {
    <div class="student-detail__enrollment-item">
      <div class="student-detail__enrollment-info">
        <span class="student-detail__enrollment-class">{{ enrollment.className }}</span>
        <span class="student-detail__enrollment-since">自 {{ enrollment.effectiveFrom }}</span>
      </div>
      <p-tag
        [value]="ENROLLMENT_STATUS_LABELS[enrollment.status]"
        [severity]="enrollment.status === 'active' ? 'success' : 'warn'"
      />
    </div>
    }
  </div>
  }
</div>
```

- [ ] **Step 3: 確認 EnrollmentsService import 加入 `student-detail.page.ts`**

```typescript
import {
  EnrollmentsService,
  Enrollment,
  ENROLLMENT_STATUS_LABELS,
} from '@core/enrollments.service';
import { SkeletonModule } from 'primeng/skeleton';
```

並在 `imports` 陣列加入 `SkeletonModule`。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/students/detail/
git commit -m "feat(ui): replace enrollment placeholder with real 在籍班級 section"
```

---

## Task 9：手動驗收

- [ ] `supabase db reset` 確認無 migration 錯誤
- [ ] 啟動 API：`cd apps/api && npx wrangler dev --local`
- [ ] 啟動前端：`cd apps/web && npx ng serve`
- [ ] 測試流程：
  1. 進入課程管理 → 點擊班級名稱 → 確認導航至 `/admin/courses/:courseId/classes/:classId`
  2. 學生名單 tab：點「加入學生」→ 學生選擇 dialog 開啟 → 選擇學生 → 確認出現在名單
  3. 點操作 menu → 停權（需填備註）→ 狀態變更
  4. 進入學生詳情頁 → 確認「在籍班級」區塊顯示剛加入的班級
  5. 退班後重新加入同一班（驗證 partial unique index 正常運作）
- [ ] **Final Commit**

```bash
git add -A
git commit -m "chore: enrollment PR1 complete — class detail page + student enrollment"
```
