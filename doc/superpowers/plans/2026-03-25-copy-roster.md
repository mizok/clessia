# 從既有班級複製名單 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在班級詳情頁新增「從既有班級複製名單」功能，讓管理者一鍵將另一班級的學生（依狀態篩選）批次加入當前班級。

**Architecture:** 後端在 `enrollments.ts` 新增 `POST /api/enrollments/copy-from-class` 路由，執行去重 + batch insert。前端新增獨立的 `CopyRosterDialogComponent`（3 步驟流程：選班級 → 篩狀態 → 執行結果），從班級詳情頁的空班 empty state 和 list header 兩個入口觸發。

**Tech Stack:** Angular 21 Standalone + Signals, PrimeNG 21 (Select/Checkbox/Button), Hono `@hono/zod-openapi`, Supabase PostgREST

**Spec:** `doc/superpowers/specs/2026-03-25-copy-roster-design.md`

---

## File Map

| Action | File |
|--------|------|
| Modify | `apps/api/src/routes/enrollments.ts` |
| Modify | `apps/web/src/app/core/enrollments.service.ts` |
| Create | `apps/web/src/app/features/admin/pages/courses/class-detail/copy-roster-dialog/copy-roster-dialog.component.ts` |
| Create | `apps/web/src/app/features/admin/pages/courses/class-detail/copy-roster-dialog/copy-roster-dialog.component.html` |
| Create | `apps/web/src/app/features/admin/pages/courses/class-detail/copy-roster-dialog/copy-roster-dialog.component.scss` |
| Modify | `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts` |
| Modify | `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html` |

---

## Task 1: Backend — POST /api/enrollments/copy-from-class

**Files:**
- Modify: `apps/api/src/routes/enrollments.ts`
- Test: `apps/api/src/routes/enrollments.spec.ts`

### 背景說明（給 Codex）

`apps/api/src/routes/enrollments.ts` 使用 `@hono/zod-openapi` 的 `createRoute()` 模式。`requireAdminMiddleware` 已定義於 `apps/api/src/middleware/auth.ts`，在 `parents.ts` 已使用相同模式：`middleware: [requireAdminMiddleware] as const`。

現有 `POST /api/enrollments/batch` 路由邏輯可參考（L381–469）：它先查 `max_students`、計算 `activeCount`（只算 `active` + `pending_payment`），再 for loop insert。本 task 的新路由邏輯類似，但來源不是前端傳入的 studentIds，而是從 source class 的 enrollments 撈取。

- - -

- [ ] **Step 1: 在 enrollments.ts 的 import 區塊加入 requireAdminMiddleware**

在 `apps/api/src/routes/enrollments.ts` 頂端（已有其他 import），加入：

```typescript
import { requireAdminMiddleware } from '../middleware/auth';
```

確認位置：在 `import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';` 之後。

- [ ] **Step 2: 在 enrollments.ts 的 Schemas 區塊新增 CopyFromClass schemas**

在 `BatchMatchResponseSchema` 之後（L135 附近）加入：

```typescript
const CopyFromClassBodySchema = z
  .object({
    targetClassId: z.uuid(),
    sourceClassId: z.uuid(),
    statuses: z
      .array(z.enum(['pending_payment', 'active', 'suspended', 'withdrawal', 'void']))
      .min(1),
  })
  .openapi('CopyFromClassBody');

const CopyFromClassResponseSchema = z
  .object({
    copied: z.number().int().min(0),
    skipped: z.number().int().min(0),
  })
  .openapi('CopyFromClassResponse');
```

- [ ] **Step 3: 在 enrollments.ts 新增 POST /copy-from-class 路由**

在 `// POST /api/enrollments/batch` 路由區塊之後（L469 之後）加入：

```typescript
// POST /api/enrollments/copy-from-class
app.openapi(
  createRoute({
    method: 'post',
    path: '/copy-from-class',
    tags: ['Enrollments'],
    middleware: [requireAdminMiddleware] as const,
    request: {
      body: { content: { 'application/json': { schema: CopyFromClassBodySchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: CopyFromClassResponseSchema } },
        description: 'OK',
      },
      400: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Bad Request (SAME_CLASS / OVER_QUOTA / invalid statuses)',
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
    const { targetClassId, sourceClassId, statuses } = c.req.valid('json');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const supabase = c.get('supabase');

    // 1. 驗證 sourceClassId !== targetClassId
    if (sourceClassId === targetClassId) {
      return c.json({ error: '來源班級不能與目標班級相同', code: 'SAME_CLASS' }, 400);
    }

    // 2. 驗證 targetClass 存在且屬本 org
    const { data: targetClass, error: targetClassError } = await supabase
      .from('classes')
      .select('id, max_students')
      .eq('id', targetClassId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (targetClassError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);
    if (!targetClass) return c.json({ error: 'TARGET_CLASS_NOT_FOUND' }, 404);

    // 3. 驗證 sourceClass 存在且屬本 org
    const { data: sourceClass, error: sourceClassError } = await supabase
      .from('classes')
      .select('id')
      .eq('id', sourceClassId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (sourceClassError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);
    if (!sourceClass) return c.json({ error: 'SOURCE_CLASS_NOT_FOUND' }, 404);

    // 4. 查出 source class 中符合 statuses 的 student_ids
    const { data: sourceEnrollments, error: sourceEnrollmentsError } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('class_id', sourceClassId)
      .eq('org_id', orgId)
      .in('status', statuses);

    if (sourceEnrollmentsError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);

    if (!sourceEnrollments || sourceEnrollments.length === 0) {
      return c.json({ copied: 0, skipped: 0 }, 200);
    }

    const sourceStudentIds = [...new Set(sourceEnrollments.map((e) => e.student_id))];

    // 5. 查出目標班級「有效在班」的 student_ids（active/pending_payment/suspended）
    const { data: activeEnrollments, error: activeEnrollmentsError } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('class_id', targetClassId)
      .eq('org_id', orgId)
      .in('status', ['active', 'pending_payment', 'suspended']);

    if (activeEnrollmentsError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);

    const alreadyInSet = new Set((activeEnrollments ?? []).map((e) => e.student_id));

    // 6. 過濾掉已在班的學生
    const toInsert = sourceStudentIds.filter((id) => !alreadyInSet.has(id));
    const skipped = sourceStudentIds.length - toInsert.length;

    if (toInsert.length === 0) {
      return c.json({ copied: 0, skipped }, 200);
    }

    // 7. OVER_QUOTA 檢查：currentActiveCount = active + pending_payment（不含 suspended）
    const { count: currentActiveCount, error: countError } = await supabase
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', targetClassId)
      .eq('org_id', orgId)
      .in('status', ['active', 'pending_payment']);

    if (countError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);

    if ((currentActiveCount ?? 0) + toInsert.length > (targetClass.max_students ?? 9999)) {
      return c.json({ error: '人數已達上限', code: 'OVER_QUOTA' }, 400);
    }

    // 8. Batch insert
    const today = new Date().toISOString().slice(0, 10);
    const rows = toInsert.map((studentId) => ({
      org_id: orgId,
      class_id: targetClassId,
      student_id: studentId,
      status: 'active' as const,
      effective_from: today,
      created_by: userId,
    }));

    const { error: insertError } = await supabase.from('enrollments').insert(rows);

    if (insertError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);

    return c.json({ copied: toInsert.length, skipped }, 200);
  },
);
```

- [ ] **Step 4: 啟動 API dev server，手動驗證路由存在**

```bash
# 在 apps/api 目錄下
cd apps/api && pnpm dev
```

用 curl 或 browser 確認 `POST http://localhost:8787/api/enrollments/copy-from-class` 回傳 401（未登入），代表路由已掛載且 requireAdminMiddleware 生效。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/enrollments.ts
git commit -m "feat(api): add POST /enrollments/copy-from-class route"
```

---

## Task 2: Frontend Service — EnrollmentsService.copyFromClass()

**Files:**
- Modify: `apps/web/src/app/core/enrollments.service.ts`

- [ ] **Step 1: 在 enrollments.service.ts 新增介面與方法**

在 `EnrollmentsService` class 的最後一個 method 之後，加入：

首先在 class 外的 interfaces 區塊（`BatchCreateInput` 之後）加入：

```typescript
export interface CopyFromClassInput {
  targetClassId: string;
  sourceClassId: string;
  statuses: EnrollmentStatus[];
}

export interface CopyFromClassResult {
  copied: number;
  skipped: number;
}
```

然後在 `EnrollmentsService` class 內加入 method：

```typescript
copyFromClass(input: CopyFromClassInput): Observable<CopyFromClassResult> {
  return this.http.post<CopyFromClassResult>(`${this.base}/copy-from-class`, input);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/core/enrollments.service.ts
git commit -m "feat(frontend): add copyFromClass method to EnrollmentsService"
```

---

## Task 3: CopyRosterDialogComponent — 建立對話框元件

**Files:**
- Create: `apps/web/src/app/features/admin/pages/courses/class-detail/copy-roster-dialog/copy-roster-dialog.component.ts`
- Create: `apps/web/src/app/features/admin/pages/courses/class-detail/copy-roster-dialog/copy-roster-dialog.component.html`
- Create: `apps/web/src/app/features/admin/pages/courses/class-detail/copy-roster-dialog/copy-roster-dialog.component.scss`

### 背景說明（給 Codex）

**對話框流程（3 步驟，以 signal 控制）：**
- `step = signal<1 | 2 | 3>(1)`
- Step 1：選來源班級（`p-select`，可搜尋，顯示課程名 + 已結束 tag）
- Step 2：篩選狀態（checkboxes），即時顯示「共 N 位學生將被複製」
- Step 3：執行後顯示摘要或 OVER_QUOTA 錯誤

**資料流：**
1. 對話框開啟時從 `config.data` 取得 `{ classId: string }`（目標班級 ID）
2. `ngOnInit` 呼叫 `GET /api/classes?pageSize=200`（含歷史班級：`includeHistorical=true`），過濾掉自身，建立選項清單
3. 使用者選班級後，呼叫 `GET /api/enrollments?classId=<sourceId>&pageSize=100`，結果存入 `sourceEnrollments` signal
4. 勾選狀態改變時，`filteredCount = computed()`（client-side filter）
5. 點「複製」時呼叫 `enrollmentsService.copyFromClass()`

**API 回傳的 Class 物件：**
```typescript
interface Class {
  id: string;
  name: string;
  courseName?: string;  // 課程名
  endDate?: string | null; // 'yyyy-MM-dd'，若 < today 則已結束
  isActive: boolean;
}
```

**`ClassesService.list()` 呼叫方式：**
```typescript
classesService.list({ pageSize: 200, includeHistorical: true })
// 回傳 ClassListResponse: { data: Class[], meta: {...} }
```

**`ENROLLMENT_STATUS_LABELS`（從 `@core/enrollments.service` 匯入）：**
```typescript
{ pending_payment: '待付款', active: '在籍', suspended: '暫停', withdrawal: '退班', void: '失效' }
```

---

- [ ] **Step 1: 產生元件檔案**

```bash
cd apps/web
npx ng generate component features/admin/pages/courses/class-detail/copy-roster-dialog \
  --type component --standalone --skip-tests
```

這會建立：
- `copy-roster-dialog.component.ts`
- `copy-roster-dialog.component.html`
- `copy-roster-dialog.component.scss`

- [ ] **Step 2: 實作 copy-roster-dialog.component.ts**

用以下完整內容覆寫產生的檔案：

```typescript
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';
import { ClassesService, Class } from '@core/classes.service';
import {
  EnrollmentsService,
  Enrollment,
  EnrollmentStatus,
  ENROLLMENT_STATUS_LABELS,
  CopyFromClassInput,
} from '@core/enrollments.service';
import { InlineNoticeComponent } from '@shared/components/inline-notice/inline-notice.component';

interface ClassOption {
  label: string;         // 班級名稱（顯示用）
  courseName: string;    // 課程名稱（副標題）
  value: string;         // class id
  isEnded: boolean;      // end_date < today
}

@Component({
  selector: 'app-copy-roster-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    SelectModule,
    CheckboxModule,
    TagModule,
    SkeletonModule,
    InlineNoticeComponent,
  ],
  templateUrl: './copy-roster-dialog.component.html',
  styleUrl: './copy-roster-dialog.component.scss',
})
export class CopyRosterDialogComponent implements OnInit {
  private readonly classesService = inject(ClassesService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  /** 目標班級 ID（從呼叫端透過 config.data 傳入） */
  private readonly targetClassId: string = this.config.data?.classId ?? '';

  protected readonly step = signal<1 | 2 | 3>(1);
  protected readonly classesLoading = signal(true);
  protected readonly enrollmentsLoading = signal(false);
  protected readonly submitting = signal(false);

  /** Step 1: 班級選項清單 */
  protected readonly classOptions = signal<ClassOption[]>([]);
  protected readonly selectedClassId = signal<string | null>(null);
  protected readonly selectedClassName = signal<string>('');

  /** Step 2: 來源班級的所有 enrollments（fetch 後 cache） */
  protected readonly sourceEnrollments = signal<Enrollment[]>([]);

  /** Step 2: 勾選的狀態 */
  protected readonly selectedStatuses = signal<EnrollmentStatus[]>(['active', 'pending_payment']);

  /** Step 2: 依選中狀態 client-side filter 出的學生數 */
  protected readonly filteredCount = computed(() => {
    const statuses = this.selectedStatuses();
    return this.sourceEnrollments().filter((e) => statuses.includes(e.status)).length;
  });

  /** Step 3: 執行結果 */
  protected readonly copyResult = signal<{ copied: number; skipped: number } | null>(null);
  protected readonly copyError = signal<string | null>(null);

  protected readonly statusOptions: { label: string; value: EnrollmentStatus }[] = [
    { label: ENROLLMENT_STATUS_LABELS.active, value: 'active' },
    { label: ENROLLMENT_STATUS_LABELS.pending_payment, value: 'pending_payment' },
    { label: ENROLLMENT_STATUS_LABELS.suspended, value: 'suspended' },
    { label: ENROLLMENT_STATUS_LABELS.withdrawal, value: 'withdrawal' },
    { label: ENROLLMENT_STATUS_LABELS.void, value: 'void' },
  ];

  ngOnInit(): void {
    this.loadClasses();
  }

  private loadClasses(): void {
    this.classesLoading.set(true);
    const today = new Date().toISOString().slice(0, 10);

    this.classesService.list({ pageSize: 200, includeHistorical: true }).subscribe({
      next: (res) => {
        const options: ClassOption[] = res.data
          .filter((cls) => cls.id !== this.targetClassId)
          .map((cls) => ({
            label: cls.name,
            courseName: cls.courseName ?? '',
            value: cls.id,
            isEnded: !!cls.endDate && cls.endDate < today,
          }));
        this.classOptions.set(options);
        this.classesLoading.set(false);
      },
      error: () => {
        this.classesLoading.set(false);
      },
    });
  }

  protected onClassSelect(classId: string | null): void {
    if (!classId) return;
    const option = this.classOptions().find((o) => o.value === classId);
    this.selectedClassName.set(option?.label ?? '');
    this.fetchSourceEnrollments(classId);
  }

  private fetchSourceEnrollments(classId: string): void {
    this.enrollmentsLoading.set(true);
    this.enrollmentsService.list({ classId, pageSize: 100 }).subscribe({
      next: (res) => {
        this.sourceEnrollments.set(res.data);
        this.enrollmentsLoading.set(false);
        this.step.set(2);
      },
      error: () => {
        this.enrollmentsLoading.set(false);
      },
    });
  }

  protected toggleStatus(status: EnrollmentStatus, checked: boolean): void {
    this.selectedStatuses.update((list) =>
      checked ? [...list, status] : list.filter((s) => s !== status),
    );
  }

  protected isStatusChecked(status: EnrollmentStatus): boolean {
    return this.selectedStatuses().includes(status);
  }

  protected submit(): void {
    const sourceClassId = this.selectedClassId();
    if (!sourceClassId || this.selectedStatuses().length === 0) return;

    this.submitting.set(true);
    this.copyError.set(null);

    const input: CopyFromClassInput = {
      targetClassId: this.targetClassId,
      sourceClassId,
      statuses: this.selectedStatuses(),
    };

    this.enrollmentsService.copyFromClass(input).subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.copyResult.set(result);
        this.step.set(3);
      },
      error: (err) => {
        this.submitting.set(false);
        if (err?.error?.code === 'OVER_QUOTA') {
          this.copyError.set('人數已達上限，請縮減篩選的學生狀態後重試。');
        } else {
          this.copyError.set('複製失敗，請稍後再試。');
        }
      },
    });
  }

  protected done(): void {
    const result = this.copyResult();
    this.ref.close(result && result.copied > 0 ? 'copied' : undefined);
  }

  protected cancel(): void {
    this.ref.close();
  }

  protected back(): void {
    this.step.set(1);
    this.selectedClassId.set(null);
    this.sourceEnrollments.set([]);
    this.selectedStatuses.set(['active', 'pending_payment']);
  }
}
```

- [ ] **Step 3: 實作 copy-roster-dialog.component.html**

```html
<div class="copy-roster-dialog">
  <!-- Step 1: 選來源班級 -->
  @if (step() === 1) {
    <div class="copy-roster-dialog__body">
      <p class="copy-roster-dialog__hint">選擇要複製名單的來源班級：</p>

      @if (classesLoading()) {
        <p-skeleton height="42px" borderRadius="8px" />
      } @else {
        <p-select
          [options]="classOptions()"
          [ngModel]="selectedClassId()"
          (ngModelChange)="selectedClassId.set($event); onClassSelect($event)"
          optionLabel="label"
          optionValue="value"
          placeholder="搜尋或選擇班級…"
          [filter]="true"
          filterBy="label,courseName"
          [showClear]="true"
          styleClass="w-full"
          [appendTo]="'body'"
          [disabled]="enrollmentsLoading()"
        >
          <ng-template #selectedItem let-opt>
            <div class="copy-roster-dialog__select-item">
              <span>{{ opt.label }}</span>
              @if (opt.isEnded) {
                <span class="copy-roster-dialog__ended-tag">已結束</span>
              }
            </div>
          </ng-template>
          <ng-template #item let-opt>
            <div class="copy-roster-dialog__option">
              <div class="copy-roster-dialog__option-main">
                <span class="copy-roster-dialog__option-name">{{ opt.label }}</span>
                @if (opt.isEnded) {
                  <span class="copy-roster-dialog__ended-tag">已結束</span>
                }
              </div>
              @if (opt.courseName) {
                <span class="copy-roster-dialog__option-course">{{ opt.courseName }}</span>
              }
            </div>
          </ng-template>
        </p-select>
      }

      @if (enrollmentsLoading()) {
        <div class="copy-roster-dialog__loading-hint">
          <i class="pi pi-spinner pi-spin"></i>
          <span>正在載入學生名單…</span>
        </div>
      }
    </div>

    <div class="copy-roster-dialog__footer">
      <p-button label="取消" [text]="true" severity="secondary" (onClick)="cancel()" />
    </div>
  }

  <!-- Step 2: 篩選狀態 -->
  @if (step() === 2) {
    <div class="copy-roster-dialog__body">
      <p class="copy-roster-dialog__source-name">
        <i class="pi pi-arrow-right-arrow-left"></i>
        來源：<strong>{{ selectedClassName() }}</strong>
      </p>

      <p class="copy-roster-dialog__hint">選擇要複製的學生狀態：</p>

      <div class="copy-roster-dialog__checkboxes">
        @for (opt of statusOptions; track opt.value) {
          <div class="copy-roster-dialog__checkbox-row">
            <p-checkbox
              [ngModel]="isStatusChecked(opt.value)"
              (ngModelChange)="toggleStatus(opt.value, $event)"
              [binary]="true"
              [inputId]="'status-' + opt.value"
            />
            <label [for]="'status-' + opt.value" class="copy-roster-dialog__checkbox-label">
              {{ opt.label }}
            </label>
          </div>
        }
      </div>

      <p class="copy-roster-dialog__preview">
        共 <strong>{{ filteredCount() }}</strong> 位學生將被複製
      </p>

      @if (copyError()) {
        <app-inline-notice severity="error" [detail]="copyError()" [dismissible]="false" />
      }
    </div>

    <div class="copy-roster-dialog__footer">
      <p-button label="上一步" [text]="true" severity="secondary" (onClick)="back()" [disabled]="submitting()" />
      <p-button
        label="複製"
        icon="pi pi-copy"
        [loading]="submitting()"
        [disabled]="selectedStatuses().length === 0 || filteredCount() === 0"
        (onClick)="submit()"
      />
    </div>
  }

  <!-- Step 3: 結果 -->
  @if (step() === 3) {
    <div class="copy-roster-dialog__body copy-roster-dialog__body--result">
      <div class="copy-roster-dialog__result-icon">
        <i class="pi pi-check-circle"></i>
      </div>
      <p class="copy-roster-dialog__result-main">
        成功加入 <strong>{{ copyResult()?.copied ?? 0 }}</strong> 位學生
      </p>
      @if ((copyResult()?.skipped ?? 0) > 0) {
        <p class="copy-roster-dialog__result-skip">
          <i class="pi pi-info-circle"></i>
          {{ copyResult()!.skipped }} 位學生已在本班，已略過
        </p>
      }
    </div>

    <div class="copy-roster-dialog__footer">
      <p-button label="完成" icon="pi pi-check" (onClick)="done()" />
    </div>
  }
</div>
```

- [ ] **Step 4: 實作 copy-roster-dialog.component.scss**

```scss
.copy-roster-dialog {
  display: flex;
  flex-direction: column;
  min-height: 240px;

  &__body {
    flex: 1;
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    &--result {
      align-items: center;
      justify-content: center;
      gap: var(--space-3);
      text-align: center;
      padding: var(--space-8) var(--space-5);
    }
  }

  &__hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--zinc-600);
  }

  &__source-name {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--zinc-500);
    display: flex;
    align-items: center;
    gap: var(--space-2);

    strong {
      color: var(--zinc-800);
    }

    .pi {
      font-size: 12px;
      color: var(--zinc-400);
    }
  }

  &__select-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  &__option {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__option-main {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  &__option-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--zinc-800);
  }

  &__option-course {
    font-size: 11px;
    color: var(--zinc-400);
  }

  &__ended-tag {
    font-size: 11px;
    font-weight: var(--font-medium);
    color: var(--zinc-500);
    background: var(--zinc-100);
    border: 1px solid var(--zinc-200);
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  &__loading-hint {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--zinc-500);
  }

  &__checkboxes {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  &__checkbox-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  &__checkbox-label {
    font-size: var(--text-sm);
    color: var(--zinc-700);
    cursor: pointer;
    user-select: none;
  }

  &__preview {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--zinc-500);
    border-top: 1px solid var(--zinc-100);
    padding-top: var(--space-3);

    strong {
      color: var(--accent-600);
    }
  }

  &__footer {
    padding: var(--space-4) var(--space-5);
    border-top: 1px solid var(--zinc-100);
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  &__result-icon {
    .pi {
      font-size: 2.5rem;
      color: #22c55e;
    }
  }

  &__result-main {
    margin: 0;
    font-size: var(--text-base);
    color: var(--zinc-700);

    strong {
      color: var(--zinc-900);
      font-size: 1.25rem;
    }
  }

  &__result-skip {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--zinc-500);
    display: flex;
    align-items: center;
    gap: var(--space-1);

    .pi {
      font-size: 13px;
    }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/class-detail/copy-roster-dialog/
git commit -m "feat(frontend): add CopyRosterDialogComponent"
```

---

## Task 4: 整合入 ClassDetailPage

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html`

### 背景說明（給 Codex）

**現有 class-detail.page.ts 結構：**
- imports: `ClassesService`, `EnrollmentsService`, `DialogService`, `StudentPickerDialogComponent`, `StudentExcelImportDialogComponent`
- `openStudentPicker()` 和 `openExcelImport()` 展示了 dialog 開啟模式
- `ref.onClose.subscribe()` 後 `loadEnrollments()` 刷新名單

**class-detail.page.html 入口位置：**

（1）空班 empty state（第 95–111 行）：
```html
@if (cls()!.isActive) {
  <div class="class-detail__empty-actions">
    <p-button label="Excel 匯入" ... />
    <p-button label="加入第一位學生" ... />
  </div>
}
```
→ 在「加入第一位學生」按鈕之後加入「複製名單」按鈕

（2）list header（第 119–137 行）：
```html
@if (cls()!.isActive) {
  <div class="class-detail__list-actions">
    <p-button label="Excel 匯入" ... />
    <p-button label="加入學生" ... />
  </div>
}
```
→ 在「加入學生」按鈕之後加入「複製名單」按鈕

---

- [ ] **Step 1: 在 class-detail.page.ts 的 imports 加入 CopyRosterDialogComponent**

在 `StudentExcelImportDialogComponent` import 之後加入：

```typescript
import { CopyRosterDialogComponent } from './copy-roster-dialog/copy-roster-dialog.component';
```

並在 `@Component` 的 `imports` 陣列加入 `CopyRosterDialogComponent`。

- [ ] **Step 2: 在 class-detail.page.ts 新增 openCopyRoster() method**

在 `openExcelImport()` method 之後新增：

```typescript
protected openCopyRoster(): void {
  const cls = this.cls();
  if (!cls) return;

  const ref = this.dialogService.open(CopyRosterDialogComponent, {
    header: '從既有班級複製名單',
    width: '480px',
    modal: true,
    appendTo: this.overlayContainer || 'body',
    data: { classId: cls.id },
  });
  ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
    if (result === 'copied') this.loadEnrollments();
  });
}
```

- [ ] **Step 3: 在 class-detail.page.html 的空班 empty-actions 加入「複製名單」按鈕**

在 `class-detail__empty-actions` div 內，`加入第一位學生` 按鈕之後加入：

```html
<p-button
  label="複製名單"
  icon="pi pi-copy"
  severity="secondary"
  [outlined]="true"
  (onClick)="openCopyRoster()"
/>
```

- [ ] **Step 4: 在 class-detail.page.html 的 list-actions 加入「複製名單」按鈕**

在 `class-detail__list-actions` div 內，`加入學生` 按鈕之後加入：

```html
<p-button
  label="複製名單"
  icon="pi pi-copy"
  size="small"
  severity="secondary"
  [outlined]="true"
  (onClick)="openCopyRoster()"
/>
```

- [ ] **Step 5: 啟動前端 dev server 手動驗證**

```bash
cd apps/web && npx ng serve
```

驗證以下項目：
1. 班級詳情頁（有學生的班）list header 顯示「複製名單」按鈕
2. 空班的 empty state 顯示「複製名單」按鈕
3. 點擊「複製名單」→ 對話框開啟，Step 1 顯示班級選單（含已結束班級有灰色 tag）
4. 選一個班級 → 進入 Step 2，顯示勾選框和學生數預覽
5. 點「複製」→ API 呼叫，Step 3 顯示結果，完成後名單刷新

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/class-detail/
git commit -m "feat(frontend): integrate copy-roster dialog into class-detail page"
```

---

## 完成驗收條件

- [ ] `POST /api/enrollments/copy-from-class` 回傳正確的 `{ copied, skipped }`
- [ ] 相同 class 回傳 `SAME_CLASS` 400
- [ ] 已在班（active/pending_payment/suspended）的學生不重複加入（計入 skipped）
- [ ] withdrawal/void 的學生可被重新加入（不計入 skipped）
- [ ] OVER_QUOTA 回傳 400，前端顯示 inline error
- [ ] 空班 empty state 和有學生的 list header 都有「複製名單」入口
- [ ] 已結束班級在選單中顯示灰色「已結束」tag
- [ ] 複製完成後名單自動刷新
