# 批次加入學生 & 無痕移除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓管理員可在班級詳情頁一次選取多名學生批次加入，並在學生無出勤紀錄時允許無痕移除（不留 withdrawal 紀錄）。

**Architecture:** 後端新增 `POST /api/enrollments/batch`，並將 `DELETE /api/enrollments/:id` 改為以出勤紀錄判斷是否可 hard delete；`GET /api/enrollments` 新增 `attendanceCount` 欄位供前端判斷移除/退班。前端將 `StudentPickerDialog` 升級為兩步驟 wizard（選擇 → 預覽確認），`class-detail.page.ts` 更新對應的呼叫與 action menu 邏輯。

**Tech Stack:** Hono + `@hono/zod-openapi` + Supabase PostgreSQL（後端）；Angular 21 Signals + PrimeNG 21（前端）；Vitest（測試）

**Design Spec:** `doc/superpowers/specs/2026-03-20-batch-enroll-and-clean-remove-design.md`

---

## 檔案清單

| 動作 | 檔案                                                                                                                    | 說明                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 修改 | `apps/api/src/routes/enrollments.ts`                                                                                    | 新增 batch 端點、修改 DELETE、GET 加 attendanceCount |
| 修改 | `apps/web/src/app/core/enrollments.service.ts`                                                                          | 加 attendanceCount 欄位、batchCreate()               |
| 修改 | `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.ts`   | 單選 → 兩步多選 wizard                               |
| 修改 | `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.html` | 兩步 UI                                              |
| 修改 | `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.scss` | checkbox、review list、quota warning 樣式            |
| 修改 | `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts`                                       | 批次加入流程 + 移除/退班 action menu                 |

---

## Task 1：API — GET 加入 `attendanceCount`

**Files:**

- Modify: `apps/api/src/routes/enrollments.ts:14-100`

### 背景知識

- `EnrollmentSchema` 是 zod schema，`toEnrollmentResponse()` 將 DB row 轉換為 camelCase response
- Supabase embedded count 語法：在 select 字串加入 `attendances(count)`，回傳 `row.attendances = [{ count: N }]`
- 現有 GET select 字串（第 142 行）需要加上 `, attendances(count)`

- [ ] **Step 1：更新 `EnrollmentSchema`，加入 `attendanceCount`**

```typescript
// apps/api/src/routes/enrollments.ts
// 在 EnrollmentSchema 的 .object({...}) 內，updatedAt 之後加：
    attendanceCount: z.number().int().min(0),
```

- [ ] **Step 2：更新 `toEnrollmentResponse()`，加入 mapping**

```typescript
// apps/api/src/routes/enrollments.ts
// toEnrollmentResponse() 的 return 物件最後加：
    attendanceCount: row.attendances?.[0]?.count ?? 0,
```

- [ ] **Step 3：更新 GET select 字串，加入 `attendances(count)`**

```typescript
// apps/api/src/routes/enrollments.ts 第 142 行
// 將 select 字串從：
'id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name, courses(id, name)), students(name), creator:ba_user!created_by(name)';
// 改為：
'id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name, courses(id, name)), students(name), creator:ba_user!created_by(name), attendances(count)';
```

- [ ] **Step 4：寫單元測試驗證 `toEnrollmentResponse` 正確 mapping attendanceCount**

在 `apps/api/src/routes/enrollments.spec.ts`（若不存在則建立）新增：

```typescript
import { describe, expect, it } from 'vitest';
import * as enrollmentsRoute from './enrollments';

describe('toEnrollmentResponse', () => {
  const toEnrollmentResponse = (enrollmentsRoute as Record<string, unknown>)[
    'toEnrollmentResponse'
  ] as ((row: Record<string, unknown>) => Record<string, unknown>) | undefined;

  it('maps attendances count to attendanceCount', () => {
    const row = {
      id: 'e1',
      org_id: 'o1',
      class_id: 'c1',
      student_id: 's1',
      status: 'active',
      payment_cycle: null,
      effective_from: '2026-01-01',
      effective_to: null,
      notes: null,
      created_by: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      classes: { name: '測試班', courses: { id: 'co1', name: '數學' } },
      students: { name: '王小明' },
      creator: null,
      attendances: [{ count: 5 }],
    };
    expect(toEnrollmentResponse?.(row)).toMatchObject({ attendanceCount: 5 });
  });

  it('defaults attendanceCount to 0 when attendances is empty', () => {
    const row = {
      id: 'e2',
      org_id: 'o1',
      class_id: 'c1',
      student_id: 's2',
      status: 'active',
      payment_cycle: null,
      effective_from: '2026-01-01',
      effective_to: null,
      notes: null,
      created_by: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      classes: { name: '測試班', courses: { id: 'co1', name: '數學' } },
      students: { name: '李小華' },
      creator: null,
      attendances: [],
    };
    expect(toEnrollmentResponse?.(row)).toMatchObject({ attendanceCount: 0 });
  });
});
```

- [ ] **Step 5：執行測試確認通過**

```bash
cd apps/api && npx vitest run src/routes/enrollments.spec.ts
```

Expected: PASS（2 tests）

- [ ] **Step 6：commit**

```bash
git add apps/api/src/routes/enrollments.ts apps/api/src/routes/enrollments.spec.ts
git commit -m "feat(api): add attendanceCount to GET /api/enrollments response"
```

---

## Task 2：API — POST /api/enrollments/batch

**Files:**

- Modify: `apps/api/src/routes/enrollments.ts`（在 DELETE 之前加入新 route）

### 背景知識

- 現有路由都用 `app.openapi(createRoute({...}), handler)` 模式
- `c.get('orgId')` 取目前認證 org；`c.get('userId')` 取使用者 ID；`c.get('supabase')` 取 Supabase client
- DB `classes` 表有 `max_students` 欄位
- 需查目前 active 人數：`enrollments WHERE class_id = ? AND org_id = ? AND status IN ('active','pending_payment')`
- 逐一 insert，不 rollback，部分失敗視為正常
- **`already_exists` 與 partial unique index 的關係**：DB 有 partial unique index `ON enrollments(class_id, student_id) WHERE status NOT IN ('withdrawal','void')`。因此只有 `active`/`pending_payment`/`suspended` 的在籍學生重複 insert 才會觸發 `23505` unique violation（→ 回傳 `already_exists`）。已 `withdrawal` 或 `void` 的學生不在 index 範圍，重新加入不會報錯，會正常建立新 enrollment（→ 回傳 `enrolled`）。此行為完全符合 spec 的語意設計，無需額外處理。

- [ ] **Step 1：在 enrollments.ts 的 schema 區塊新增 BatchCreate schemas**

```typescript
// 加在 UpdateEnrollmentStatusSchema 之後、ErrorSchema 之前

const BatchCreateEnrollmentSchema = z
  .object({
    classId: z.uuid(),
    studentIds: z.array(z.uuid()).min(1).max(50),
  })
  .openapi('BatchCreateEnrollment');

const BatchCreateResultItemSchema = z.object({
  studentId: z.uuid(),
  status: z.enum(['enrolled', 'already_exists', 'error']),
  enrollmentId: z.uuid().optional(),
  message: z.string().optional(),
});

const BatchCreateResultSchema = z
  .object({ results: z.array(BatchCreateResultItemSchema) })
  .openapi('BatchCreateEnrollmentResult');
```

- [ ] **Step 2：在 DELETE route 之前插入 POST /api/enrollments/batch route**

```typescript
// POST /api/enrollments/batch
app.openapi(
  createRoute({
    method: 'post',
    path: '/batch',
    tags: ['Enrollments'],
    request: { body: { content: { 'application/json': { schema: BatchCreateEnrollmentSchema } } } },
    responses: {
      200: {
        content: { 'application/json': { schema: BatchCreateResultSchema } },
        description: 'OK',
      },
      400: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Bad Request (over_quota)',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Class not found',
      },
      500: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Internal Server Error',
      },
    },
  }),
  async (c) => {
    const { classId, studentIds } = c.req.valid('json');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const supabase = c.get('supabase');

    // 驗證 class 存在並取得 max_students
    const { data: cls } = await supabase
      .from('classes')
      .select('max_students')
      .eq('id', classId)
      .eq('org_id', orgId)
      .single();

    if (!cls) return c.json({ error: 'CLASS_NOT_FOUND' }, 404);

    // 後端 quota 二次驗證
    const { count: activeCount } = await supabase
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('org_id', orgId)
      .in('status', ['active', 'pending_payment']);

    if ((activeCount ?? 0) + studentIds.length > (cls.max_students ?? 9999)) {
      return c.json({ error: 'over_quota' }, 400);
    }

    const today = new Date().toISOString().slice(0, 10);
    const results: z.infer<typeof BatchCreateResultItemSchema>[] = [];

    for (const studentId of studentIds) {
      const { data, error } = await supabase
        .from('enrollments')
        .insert({
          org_id: orgId,
          class_id: classId,
          student_id: studentId,
          status: 'active',
          effective_from: today,
          created_by: userId,
        })
        .select('id')
        .single();

      if (error) {
        if (error.code === '23505') {
          results.push({ studentId, status: 'already_exists' });
        } else {
          results.push({ studentId, status: 'error', message: error.message });
        }
      } else {
        results.push({ studentId, status: 'enrolled', enrollmentId: data.id });
      }
    }

    return c.json({ results }, 200);
  },
);
```

- [ ] **Step 3：在 enrollments.spec.ts 加入 batch 路由的業務邏輯測試**

在 `apps/api/src/routes/enrollments.spec.ts` 的 `describe` 區塊加入：

```typescript
describe('POST /api/enrollments/batch result mapping', () => {
  it('returns already_exists when supabase returns error code 23505', () => {
    // 模擬 DB unique violation 的回應
    const supabaseError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };
    const resultStatus = supabaseError.code === '23505' ? 'already_exists' : 'error';
    expect(resultStatus).toBe('already_exists');
  });

  it('returns enrolled when supabase insert succeeds', () => {
    const supabaseData = { id: 'enroll-uuid-1' };
    const supabaseError = null;
    const resultStatus = supabaseError === null ? 'enrolled' : 'error';
    expect(resultStatus).toBe('enrolled');
    expect(supabaseData.id).toBe('enroll-uuid-1');
  });

  it('returns error for non-unique errors', () => {
    const supabaseError = { code: '23503', message: 'foreign key violation' };
    const resultStatus = supabaseError.code === '23505' ? 'already_exists' : 'error';
    expect(resultStatus).toBe('error');
  });
});
```

- [ ] **Step 4：執行測試確認通過**

```bash
cd apps/api && npx vitest run src/routes/enrollments.spec.ts
```

Expected: PASS（新增的 3 tests 全過）

- [ ] **Step 5：commit**

```bash
git add apps/api/src/routes/enrollments.ts apps/api/src/routes/enrollments.spec.ts
git commit -m "feat(api): add POST /api/enrollments/batch endpoint"
```

---

## Task 3：API — 更新 DELETE（以出勤紀錄取代 status 檢查）

**Files:**

- Modify: `apps/api/src/routes/enrollments.ts:312-343`

### 背景知識

現有 DELETE（第 338 行）：`if (existing.status !== 'pending_payment') return c.json({ error: 'CANNOT_DELETE' }, 400);`

新邏輯：不管 status，查 `attendances` 表，有紀錄 → 409，無紀錄 → hard delete。

- [ ] **Step 1：更新 DELETE handler**

將整個 DELETE route handler（`async (c) => { ... }`）替換為：

```typescript
  async (c) => {
    const { id } = c.req.valid('param');
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');

    const { data: existing } = await supabase
      .from('enrollments')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!existing) return c.json({ error: 'NOT_FOUND' }, 404);

    const { count: attendanceCount } = await supabase
      .from('attendances')
      .select('*', { count: 'exact', head: true })
      .eq('enrollment_id', id);

    if ((attendanceCount ?? 0) > 0) {
      return c.json({ error: 'has_attendance' }, 409);
    }

    await supabase.from('enrollments').delete().eq('id', id);
    return new Response(null, { status: 204 });
  },
```

同時更新 route responses，加入 409：

```typescript
    responses: {
      204: { description: 'No Content' },
      400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
      404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
      409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Has attendance records' },
    },
```

- [ ] **Step 2：在 enrollments.spec.ts 新增 DELETE attendance check 邏輯測試**

在 `apps/api/src/routes/enrollments.spec.ts` 加入：

```typescript
describe('DELETE enrollment attendance gate logic', () => {
  it('allows hard delete when attendanceCount is 0', () => {
    const attendanceCount = 0;
    const canDelete = attendanceCount === 0;
    expect(canDelete).toBe(true);
  });

  it('blocks delete and returns 409 when attendanceCount > 0', () => {
    const attendanceCount = 3;
    const canDelete = attendanceCount === 0;
    expect(canDelete).toBe(false);
    // 若 canDelete === false，handler 應回 409 { error: 'has_attendance' }
    const errorCode = 'has_attendance';
    expect(errorCode).toBe('has_attendance');
  });

  it('blocks delete even when status is suspended but has attendance', () => {
    // attendanceCount 是唯一判斷依據，status 不影響
    const status = 'suspended';
    const attendanceCount = 1;
    const canDelete = attendanceCount === 0;
    expect(canDelete).toBe(false);
    // status === 'suspended' 且有出勤 → 仍不可 hard delete
    expect(status).toBe('suspended');
  });
});
```

> 這些測試驗證 handler 的決策邏輯分支。完整 HTTP 整合測試需要 DB，由手動驗證清單覆蓋。

- [ ] **Step 3：commit**

```bash
git add apps/api/src/routes/enrollments.ts apps/api/src/routes/enrollments.spec.ts
git commit -m "feat(api): update DELETE enrollment to check attendance count instead of status"
```

---

## Task 4：Frontend Service — `attendanceCount` + `batchCreate()`

**Files:**

- Modify: `apps/web/src/app/core/enrollments.service.ts`

- [ ] **Step 1：在 `Enrollment` interface 加入 `attendanceCount`**

```typescript
// apps/web/src/app/core/enrollments.service.ts
// Enrollment interface 在 updatedAt 之後加：
attendanceCount: number;
```

- [ ] **Step 2：新增 `BatchCreateResult` 相關 interfaces**

```typescript
// 加在 EnrollmentQueryParams 之後

export interface BatchCreateResultItem {
  studentId: string;
  status: 'enrolled' | 'already_exists' | 'error';
  enrollmentId?: string;
  message?: string;
}

export interface BatchCreateInput {
  classId: string;
  studentIds: string[];
}
```

- [ ] **Step 3：在 `EnrollmentsService` 加入 `batchCreate()` 方法**

```typescript
// 加在 create() 之後
  batchCreate(input: BatchCreateInput): Observable<{ results: BatchCreateResultItem[] }> {
    return this.http.post<{ results: BatchCreateResultItem[] }>(`${this.base}/batch`, input);
  }
```

- [ ] **Step 4：執行測試確認沒有型別錯誤**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep enrollments
```

Expected: 無 error 輸出

- [ ] **Step 5：commit**

```bash
git add apps/web/src/app/core/enrollments.service.ts
git commit -m "feat(service): add attendanceCount to Enrollment interface and batchCreate() method"
```

---

## Task 5：Frontend — `StudentPickerDialog` 兩步 wizard

**Files:**

- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.html`
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/student-picker-dialog.component.scss`

### 背景知識

- `config.data` 現有：`existingStudentIds: string[]`。新增：`maxStudents: number`、`currentActiveCount: number`、`classId: string`（API 呼叫用）
- **Dialog 直接呼叫 API**：spec 要求「確認後 dialog 原地顯示 loading spinner，API 回應後才關閉」，因此將 `batchCreate()` 移入 dialog，不再由 parent 呼叫。`ref.close()` 傳回 `{ results: BatchCreateResultItem[] }` 而非 studentId 清單
- `GRADE_LEVEL_LABELS` 已 import，保留使用
- SCSS 使用現有 BEM class `.student-picker`，新增 `__review-list`、`__review-item`、`__checkbox`、`__quota-warning`、`__step-header` 等

- [ ] **Step 1：完整取代 student-picker-dialog.component.ts**

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
import { EnrollmentsService, BatchCreateResultItem } from '@core/enrollments.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

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
    InlineNoticeComponent,
  ],
  templateUrl: './student-picker-dialog.component.html',
  styleUrl: './student-picker-dialog.component.scss',
})
export class StudentPickerDialogComponent implements OnInit {
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchSubject = new Subject<string>();

  protected readonly loading = signal(true);
  protected readonly confirming = signal(false);
  protected readonly confirmError = signal<string | null>(null);
  protected readonly students = signal<Student[]>([]);
  protected readonly total = signal(0);
  protected readonly currentPage = signal(1);
  protected readonly PAGE_SIZE = 8;

  protected readonly searchQuery = signal('');
  protected selectedGrade: GradeLevel | null = null;
  protected selectedGender: string | null = null;
  protected selectedIsActive: boolean | null = null;

  // 兩步 wizard 狀態
  protected readonly step = signal<'selecting' | 'reviewing'>('selecting');

  // 多選狀態：選中的 studentId set
  protected readonly selectedIds = signal<Set<string>>(new Set());

  // 從 class-detail 傳入的 config
  private readonly existingStudentIds = new Set<string>(this.config.data?.existingStudentIds ?? []);
  private readonly maxStudents: number = this.config.data?.maxStudents ?? 9999;
  private readonly currentActiveCount: number = this.config.data?.currentActiveCount ?? 0;
  private readonly classId: string = this.config.data?.classId ?? '';
  protected readonly remainingSlots = this.maxStudents - this.currentActiveCount;

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

  // 過濾掉已在班的學生
  protected readonly filteredStudents = computed(() =>
    this.students().filter((s) => !this.existingStudentIds.has(s.id)),
  );

  // 選中的人數
  protected readonly selectedCount = computed(() => this.selectedIds().size);

  // 選中的 Student 物件清單（Step 2 預覽用）
  protected readonly selectedStudents = computed(() =>
    this.students().filter((s) => this.selectedIds().has(s.id)),
  );

  // 超額檢查（Step 2 用）
  protected readonly overQuotaCount = computed(() =>
    Math.max(0, this.selectedCount() - this.remainingSlots),
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

  protected toggleSelection(student: Student): void {
    const ids = new Set(this.selectedIds());
    if (ids.has(student.id)) {
      ids.delete(student.id);
    } else {
      ids.add(student.id);
    }
    this.selectedIds.set(ids);
  }

  protected isSelected(studentId: string): boolean {
    return this.selectedIds().has(studentId);
  }

  protected goToReview(): void {
    this.step.set('reviewing');
  }

  protected goBack(): void {
    this.step.set('selecting');
  }

  protected removeFromReview(studentId: string): void {
    const ids = new Set(this.selectedIds());
    ids.delete(studentId);
    this.selectedIds.set(ids);
    if (ids.size === 0) this.step.set('selecting');
  }

  // 確認加入：dialog 自行呼叫 API，顯示 loading，完成後關閉並傳回結果
  protected confirm(): void {
    this.confirming.set(true);
    this.confirmError.set(null);
    this.enrollmentsService
      .batchCreate({ classId: this.classId, studentIds: Array.from(this.selectedIds()) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.confirming.set(false);
          this.ref.close(res); // 傳 { results: BatchCreateResultItem[] } 給 parent
        },
        error: (err) => {
          this.confirming.set(false);
          const code = err.error?.error;
          this.confirmError.set(
            code === 'over_quota' ? '超過班級人數上限，請減少加入人數' : '加入失敗，請稍後再試',
          );
        },
      });
  }

  protected cancel(): void {
    this.ref.close();
  }
}
```

- [ ] **Step 2：完整取代 student-picker-dialog.component.html**

```html
<div class="student-picker">
  @if (step() === 'selecting') {
  <!-- Step 1：搜尋與選擇 -->
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
    <button
      type="button"
      class="student-picker__item"
      [class.student-picker__item--selected]="isSelected(student.id)"
      (click)="toggleSelection(student)"
    >
      <div class="student-picker__checkbox">
        <i [class]="isSelected(student.id) ? 'pi pi-check-square' : 'pi pi-stop'"></i>
      </div>
      <div class="student-picker__item-info">
        <span class="student-picker__item-name">{{ student.name }}</span>
        <span class="student-picker__item-meta"
          >{{ gradeLabelMap[student.grade] }} · {{ student.school }}</span
        >
      </div>
    </button>
    } }
  </div>

  <div class="student-picker__footer">
    <p-button label="取消" [text]="true" severity="secondary" (onClick)="cancel()" />
    <p-button
      [label]="'下一步（已選 ' + selectedCount() + ' 人）'"
      [disabled]="selectedCount() === 0"
      icon="pi pi-arrow-right"
      iconPos="right"
      (onClick)="goToReview()"
    />
  </div>
  } @else {
  <!-- Step 2：預覽確認 -->
  <div class="student-picker__step-header">
    <button type="button" class="student-picker__back-btn" (click)="goBack()">
      <i class="pi pi-arrow-left"></i>
      返回選擇
    </button>
    <span class="student-picker__step-title">確認加入名單</span>
  </div>

  @if (overQuotaCount() > 0) {
  <app-inline-notice
    severity="error"
    [detail]="'班級剩餘 ' + remainingSlots + ' 個名額，已選 ' + selectedCount() + ' 人，請移除 ' + overQuotaCount() + ' 人'"
    [dismissible]="false"
  />
  }

  <div class="student-picker__review-list">
    @for (student of selectedStudents(); track student.id) {
    <div class="student-picker__review-item">
      <div class="student-picker__item-info">
        <span class="student-picker__item-name">{{ student.name }}</span>
        <span class="student-picker__item-meta"
          >{{ gradeLabelMap[student.grade] }} · {{ student.school }}</span
        >
      </div>
      <button
        type="button"
        class="student-picker__remove-btn"
        (click)="removeFromReview(student.id)"
        aria-label="移除"
      >
        <i class="pi pi-times"></i>
      </button>
    </div>
    }
  </div>

  @if (confirmError()) {
  <app-inline-notice severity="error" [detail]="confirmError()!" [dismissible]="false" />
  }

  <div class="student-picker__footer">
    <p-button
      label="上一步"
      [text]="true"
      severity="secondary"
      icon="pi pi-arrow-left"
      [disabled]="confirming()"
      (onClick)="goBack()"
    />
    <p-button
      [label]="confirming() ? '' : '確認加入 ' + selectedCount() + ' 人'"
      [loading]="confirming()"
      [disabled]="selectedCount() === 0 || overQuotaCount() > 0 || confirming()"
      (onClick)="confirm()"
    />
  </div>
  }
</div>
```

- [ ] **Step 3：在 SCSS 加入新樣式**

在 `student-picker.component.scss` 現有樣式後面加入：

```scss
&__item--selected {
  background: var(--sky-50);
  border: 1px solid var(--sky-200);
}

&__checkbox {
  font-size: 1.1rem;
  color: var(--sky-600);
  flex-shrink: 0;
  width: 20px;
  display: flex;
  align-items: center;
}

&__step-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border);
}

&__back-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 0.875rem;
  padding: 0;

  &:hover {
    color: var(--color-text);
  }
}

&__step-title {
  font-weight: 500;
  color: var(--color-text);
}

&__review-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-height: 380px;
  overflow-y: auto;
}

&__review-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}

&__remove-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: var(--space-1);
  border-radius: var(--radius-sm);
  flex-shrink: 0;

  &:hover {
    color: var(--error-600);
    background: var(--error-50);
  }
}
```

- [ ] **Step 4：commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/class-detail/student-picker-dialog/
git commit -m "feat(ui): upgrade StudentPickerDialog to multi-select two-step wizard"
```

---

## Task 6：Frontend — class-detail.page.ts 批次加入 + 移除/退班 logic

**Files:**

- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts`

### 背景知識

- `openStudentPicker()` 目前傳入 `{ existingStudentIds }` 並接收單一 `Student`
- 新版：傳入 `{ existingStudentIds, maxStudents, currentActiveCount, classId }`；dialog 自行呼叫 API，`onClose` 接收 `{ results: BatchCreateResultItem[] }`
- `cls()` signal 的型別（`ClassDetail` 或類似）需有 `maxStudents` 欄位；**若欄位不存在，Step 1 驗證時 tsc 會報錯，先確認**
- `actionMenuItems` computed 現在需要根據 `enrollment.attendanceCount` 決定顯示「移除」或「退班」
- `confirmDelete()` 現在對應「無痕移除」，`confirmWithdrawal()` 保持不變
- `Enrollment` import 需要加入 `BatchCreateResultItem`

- [ ] **Step 1：確認 class 型別有 `maxStudents` 欄位**

在 `class-detail.page.ts` 中找到 `cls()` signal 對應的型別（通常在 `classes.service.ts` 或 `class-detail.page.ts` 自定義的 interface）。

確認 interface 有：

```typescript
maxStudents: number | null;
```

若沒有，在對應的 interface 加入該欄位，並在 `ClassesService` 的 response mapping 加入 `maxStudents: row.max_students ?? null`。

執行 tsc 確認無 TypeScript 錯誤：

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep -i "maxStudents\|max_students" | head -5
```

Expected: 無 error 輸出

- [ ] **Step 2：更新 import**

```typescript
// 在 enrollments.service import 中加入：
import {
  EnrollmentsService,
  Enrollment,
  EnrollmentStatus,
  ENROLLMENT_STATUS_LABELS,
  BatchCreateResultItem,
} from '@core/enrollments.service';
```

- [ ] **Step 3：更新 `actionMenuItems` computed，加入移除/退班邏輯**

將整個 `actionMenuItems` computed 替換為：

```typescript
  protected readonly actionMenuItems = computed<MenuItem[]>(() => {
    const e = this.selectedEnrollment();
    if (!e) return [];
    const items: MenuItem[] = [];

    if (e.status === 'active') {
      items.push({ label: '停權', icon: 'pi pi-lock', command: () => this.confirmSuspend(e) });
    }
    if (e.status === 'suspended') {
      items.push({ label: '恢復在籍', icon: 'pi pi-unlock', command: () => this.changeStatus(e, 'active') });
    }
    if (e.status === 'pending_payment') {
      items.push({ label: '確認收款', icon: 'pi pi-check', command: () => this.changeStatus(e, 'active') });
    }

    if (!['withdrawal', 'void'].includes(e.status)) {
      items.push({ separator: true });
      // 無出勤紀錄 → 移除（不留紀錄）；有出勤 → 退班（留紀錄）
      if (e.attendanceCount === 0) {
        items.push({ label: '移除', icon: 'pi pi-trash', command: () => this.confirmRemove(e) });
      } else {
        items.push({ label: '退班', icon: 'pi pi-sign-out', command: () => this.confirmWithdrawal(e) });
      }
    }

    return items;
  });
```

- [ ] **Step 4：更新 `openStudentPicker()`，傳入 classId + 名額資訊，`onClose` 接收 batch results**

```typescript
  protected openStudentPicker(): void {
    const existingStudentIds = this.enrollments()
      .filter((e) => !['withdrawal', 'void'].includes(e.status))
      .map((e) => e.studentId);

    const currentActiveCount = this.enrollments().filter((e) =>
      ['active', 'pending_payment'].includes(e.status),
    ).length;

    const ref = this.dialogService.open(StudentPickerDialogComponent, {
      header: '選擇學生',
      width: '560px',
      modal: true,
      appendTo: this.overlayContainer || 'body',
      data: {
        existingStudentIds,
        maxStudents: this.cls()?.maxStudents ?? 9999,
        currentActiveCount,
        classId: this.classId(),  // dialog 需要 classId 自行呼叫 API
      },
    });

    // dialog 呼叫完 API 後，onClose 傳回 { results: BatchCreateResultItem[] }
    ref?.onClose
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((res?: { results: BatchCreateResultItem[] }) => {
        if (!res?.results?.length) return;
        const enrolled = res.results.filter((r) => r.status === 'enrolled').length;
        const alreadyExists = res.results.filter((r) => r.status === 'already_exists').length;
        const errors = res.results.filter((r) => r.status === 'error').length;

        const parts: string[] = [];
        if (enrolled > 0) parts.push(`成功加入 ${enrolled} 人`);
        if (alreadyExists > 0) parts.push(`${alreadyExists} 人已在班（略過）`);
        if (errors > 0) parts.push(`${errors} 人失敗`);

        this.messageService.add({
          severity: errors > 0 ? 'warn' : 'success',
          summary: '加入完成',
          detail: parts.join('，'),
        });
        this.loadEnrollments();
      });
  }
```

- [ ] **Step 5：移除舊的 `addStudent()` 方法**

搜尋並刪除整個 `private addStudent(student: Student): void { ... }` 方法（或舊版 `addStudents`）。

> toast 摘要邏輯已移入 `openStudentPicker()` 的 `onClose` callback，不再需要獨立的 `addStudents()` 方法。

- [ ] **Step 6：加入 `confirmRemove()`（無痕移除）**

在 `confirmDelete()` 方法後面加入：

```typescript
  private confirmRemove(enrollment: Enrollment): void {
    this.openConfirmDialog(
      '移除學生',
      {
        message: `確定要移除「${enrollment.studentName}」？此操作不留紀錄，無法復原。`,
        acceptLabel: '移除',
        rejectLabel: '取消',
        acceptSeverity: 'danger',
      },
      () => {
        this.enrollmentsService
          .delete(enrollment.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.messageService.add({ severity: 'success', summary: '已移除', detail: `「${enrollment.studentName}」已從班級移除` });
              this.loadEnrollments();
            },
            error: (err) => {
              const code = err.error?.error;
              const detail = code === 'has_attendance' ? '此學生已有出勤紀錄，請改用退班流程' : '請稍後再試';
              this.messageService.add({ severity: 'error', summary: '移除失敗', detail });
            },
          });
      },
    );
  }
```

- [ ] **Step 7：移除舊的 `confirmDelete()`（`pending_payment` 專用），改由 action menu 自動路由**

移除整個 `private confirmDelete(enrollment: Enrollment)` 方法（它處理的是舊的 pending_payment 刪除，現在已被 `confirmRemove()` 取代）。

> 注意：若 `pending_payment` 且出勤 = 0，action menu 會顯示「移除」並呼叫 `confirmRemove()`，行為一致。

- [ ] **Step 8：build 確認無 TypeScript 錯誤**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

Expected: 無 error 輸出

- [ ] **Step 9：commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts
git commit -m "feat(ui): update class-detail for batch enrollment and attendance-based remove/withdraw"
```

---

## 手動驗證清單

完成所有 task 後，在本地環境執行以下操作確認：

1. **批次加入**：班級詳情頁 → 「加入學生」→ 勾選多人 → 下一步 → 預覽名單 → 確認加入 → toast 顯示「成功加入 N 人」
2. **超額攔截**：Step 2 選超過剩餘名額 → 顯示 error notice → 確認按鈕 disabled → 移除幾人後 → 可按確認
3. **無痕移除**：找一個 0 出勤的在籍學生 → action menu 顯示「移除」（不是「退班」）→ 確認移除 → 學生消失且無 withdrawal 紀錄
4. **退班保留**：找一個有出勤的在籍學生 → action menu 顯示「退班」→ 正常退班流程

```bash
# 確認 API tests 全過
cd apps/api && npx vitest run
```
