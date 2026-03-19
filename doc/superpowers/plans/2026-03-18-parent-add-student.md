# 家長管理新增學生 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除家長表單的「關聯學生」multiselect，改為在家長 action menu 提供「新增學生」，讓學生建立時自動與該家長關聯，確立家長→學生的建立關係。

**Architecture:** 新增 `POST /api/students` API 端點（接受 `parentId`），讓 `StudentFormDialogComponent` 支援 create 模式，並在家長頁面的 action menu 加入「新增學生」入口。`ParentFormDialogComponent` 移除所有 studentIds 相關邏輯。

**Tech Stack:** Angular 21 Standalone + Signals、Hono OpenAPI、Supabase（`students` + `parent_student_relations` 表）

---

## 異動檔案總覽

| 狀態 | 檔案 | 說明 |
|------|------|------|
| 修改 | `apps/api/src/routes/students.ts` | 新增 `POST /` 路由 |
| 修改 | `apps/web/src/app/core/students.service.ts` | 新增 `CreateStudentInput` 介面與 `create()` 方法 |
| 修改 | `apps/web/src/app/features/admin/pages/students/student-form-dialog.component.ts` | 支援 create 模式（目前只有 edit） |
| 修改 | `apps/web/src/app/features/admin/pages/students/student-form-dialog.component.html` | 標題依模式切換 |
| 修改 | `apps/web/src/app/shared/components/parent-form-dialog/parent-form-dialog.component.ts` | 移除 studentIds / StudentsService |
| 修改 | `apps/web/src/app/shared/components/parent-form-dialog/parent-form-dialog.component.html` | 移除關聯學生 multiselect |
| 修改 | `apps/web/src/app/features/admin/pages/parents/parents.page.ts` | action menu 加「新增學生」 |
| 修改 | `apps/web/src/app/core/parents.service.ts` | 移除 `CreateParentInput` / `UpdateParentInput` 的 `studentIds` 欄位 |

---

## Task 1：API — 新增 POST /api/students

**Files:**
- Modify: `apps/api/src/routes/students.ts`

- [ ] **Step 1：在 students.ts 的 Schemas 區塊新增 `CreateStudentSchema`**

在現有 `UpdateStudentSchema` 之後加入（`school` 為必填）：

```typescript
const CreateStudentSchema = z
  .object({
    name: z.string().min(1),
    grade: GradeLevelSchema,
    school: z.string().min(1),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD')
      .nullable()
      .optional(),
    gender: StudentGenderSchema.nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    address: z.string().nullable().optional(),
    emergencyContactName: z.string().nullable().optional(),
    emergencyContactPhone: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    parentId: z.string().uuid().optional(),
  })
  .openapi('CreateStudent');
```

- [ ] **Step 2：在 Routes 區塊新增 `POST /` 路由**

緊接在 `GET /` 路由之後、`GET /{id}` 之前插入：

```typescript
// POST /api/students
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Students'],
    summary: '建立學生',
    request: {
      body: { content: { 'application/json': { schema: CreateStudentSchema } } },
    },
    responses: {
      201: {
        description: '建立成功',
        content: { 'application/json': { schema: z.object({ data: StudentSchema }) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    const insertPayload: Record<string, unknown> = {
      org_id: orgId,
      name: body.name,
      grade: body.grade,
      school: body.school,
    };
    if (body.birthday !== undefined) insertPayload['birthday'] = body.birthday;
    if (body.gender !== undefined) insertPayload['gender'] = body.gender;
    if (body.phone !== undefined) insertPayload['phone'] = body.phone;
    if (body.email !== undefined) insertPayload['email'] = body.email;
    if (body.address !== undefined) insertPayload['address'] = body.address;
    if (body.emergencyContactName !== undefined)
      insertPayload['emergency_contact_name'] = body.emergencyContactName;
    if (body.emergencyContactPhone !== undefined)
      insertPayload['emergency_contact_phone'] = body.emergencyContactPhone;
    if (body.notes !== undefined) insertPayload['notes'] = body.notes;

    const { data, error } = await supabase
      .from('students')
      .insert(insertPayload)
      .select()
      .single();

    if (error || !data) {
      return c.json({ error: '建立學生失敗', message: error?.message ?? '' }, 500);
    }

    const student = toStudentResponse(data as Record<string, unknown>);

    // 建立家長關聯（若有提供 parentId）
    if (body.parentId) {
      await supabase.from('parent_student_relations').insert({
        parent_id: body.parentId,
        student_id: student.id,
        is_primary: true,
        relation: null,
      });
    }

    return c.json({ data: student }, 201);
  },
);
```

- [ ] **Step 3：確認 API TypeScript 無新增錯誤**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "students.ts"
```

預期：無 students.ts 相關新錯誤（原有舊錯誤可忽略）

- [ ] **Step 4：手動驗證 API 路由已掛載**

確認 API dev server 有在跑（`apps/api`）。若沒有，先在另一個 terminal 執行：
```bash
cd apps/api && npm run dev
```
然後：
```bash
curl -s http://localhost:8787/api/students -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"test","grade":"P1","school":"test school"}'
```
預期：回傳 `{"error":"Unauthorized","code":"NO_SESSION"}` 或 401（代表路由有掛到，只是需要認證）

- [ ] **Step 5：Commit**

```bash
git add apps/api/src/routes/students.ts
git commit -m "feat(api): add POST /api/students with optional parentId"
```

---

## Task 2：StudentsService — 新增 create()

**Files:**
- Modify: `apps/web/src/app/core/students.service.ts`

- [ ] **Step 1：在 `UpdateStudentInput` 之後新增 `CreateStudentInput` 介面**

```typescript
export interface CreateStudentInput {
  name: string;
  grade: GradeLevel;
  school: string;
  birthday?: string | null;
  gender?: StudentGender | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  notes?: string | null;
  parentId?: string;
}
```

- [ ] **Step 2：在 `StudentsService` class 新增 `create()` 方法**

緊接在 `list()` 之後加入：

```typescript
create(input: CreateStudentInput): Observable<{ data: Student }> {
  return this.http.post<{ data: Student }>(this.endpoint, input);
}
```

- [ ] **Step 3：確認 Angular 前端 TypeScript 無錯誤**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | tail -20
```

預期：無 students.service.ts 相關錯誤

- [ ] **Step 4：Commit**

```bash
git add apps/web/src/app/core/students.service.ts
git commit -m "feat(service): add CreateStudentInput and create() to StudentsService"
```

---

## Task 3：StudentFormDialog — 支援 create 模式

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/students/student-form-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/students/student-form-dialog.component.html`

目前 dialog 假設 `config.data.student` 一定存在（edit mode only）。需支援 create mode（`student` 為 null）並接受可選的 `parentId`。

- [ ] **Step 1：修改 `student-form-dialog.component.ts`**

完整替換 component class 內容如下（保留原有 import 並新增 `CreateStudentInput`）。
**注意：需在 `@Component` decorator 加入 `providers: [MessageService]`**，讓 dialog 自給自足（不依賴 parent component 提供）：

```typescript
@Component({
  ...
  providers: [MessageService],
  ...
})
```

```typescript
import {
  StudentsService,
  Student,
  GradeLevel,
  StudentGender,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
  UpdateStudentInput,
  CreateStudentInput,
} from '@core/students.service';
```

新增 `isCreateMode` computed 及調整 `formData`：

```typescript
protected readonly isCreateMode = computed(() => this.student() === null);

protected readonly student = signal<Student | null>(this.config.data?.student ?? null);

protected readonly formData = signal({
  name: this.student()?.name ?? '',
  grade: (this.student()?.grade ?? '') as GradeLevel | '',
  school: this.student()?.school ?? '',
  birthday: this.student()?.birthday ? new Date(this.student()!.birthday!) : (null as Date | null),
  gender: this.student()?.gender ?? (null as StudentGender | null),
  phone: this.student()?.phone ?? '',
  email: this.student()?.email ?? '',
  address: this.student()?.address ?? '',
  emergencyContactName: this.student()?.emergencyContactName ?? '',
  emergencyContactPhone: this.student()?.emergencyContactPhone ?? '',
  notes: this.student()?.notes ?? '',
});
```

`isFormValid` 需確保 grade 不為空字串：

```typescript
protected readonly isFormValid = computed(() => {
  const f = this.formData();
  return f.name.trim().length > 0 && f.grade.length > 0 && f.school.trim().length > 0;
});
```

`save()` 依模式分流：

```typescript
protected save(): void {
  if (!this.isFormValid()) return;

  const f = this.formData();
  this.loading.set(true);

  const commonFields = {
    name: f.name.trim(),
    grade: f.grade as GradeLevel,
    school: f.school.trim(),
    birthday: f.birthday ? this.formatDate(f.birthday) : null,
    gender: f.gender,
    phone: f.phone.trim() || null,
    email: f.email.trim() || null,
    address: f.address.trim() || null,
    emergencyContactName: f.emergencyContactName.trim() || null,
    emergencyContactPhone: f.emergencyContactPhone.trim() || null,
    notes: f.notes.trim() || null,
  };

  if (this.isCreateMode()) {
    const input: CreateStudentInput = {
      ...commonFields,
      parentId: this.config.data?.parentId ?? undefined,
    };
    this.studentsService.create(input).subscribe({
      next: (res) => this.ref.close(res.data),
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '建立失敗',
          detail: err.error?.error || '請稍後再試',
        });
        this.loading.set(false);
      },
    });
  } else {
    const input: UpdateStudentInput = commonFields;
    this.studentsService.update(this.student()!.id, input).subscribe({
      next: (res) => this.ref.close(res.data),
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: '更新失敗',
          detail: err.error?.error || '請稍後再試',
        });
        this.loading.set(false);
      },
    });
  }
}
```

- [ ] **Step 2：修改 `student-form-dialog.component.html` 的標題**

將固定文字標題改為動態：

```html
<span class="dialog-header-inline__title">
  {{ isCreateMode() ? '新增學生' : '編輯學生資料' }}
</span>
```

儲存按鈕標籤也改為動態：

```html
<p-button
  [label]="isCreateMode() ? '建立學生' : '儲存'"
  ...
/>
```

- [ ] **Step 3：確認 TypeScript 無錯誤**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -i "student-form"
```

預期：無錯誤

- [ ] **Step 4：Commit**

```bash
git add apps/web/src/app/features/admin/pages/students/student-form-dialog.component.ts
git add apps/web/src/app/features/admin/pages/students/student-form-dialog.component.html
git commit -m "feat(student-form): support create mode with optional parentId"
```

---

## Task 4：ParentFormDialog — 移除 studentIds

**Files:**
- Modify: `apps/web/src/app/shared/components/parent-form-dialog/parent-form-dialog.component.ts`
- Modify: `apps/web/src/app/shared/components/parent-form-dialog/parent-form-dialog.component.html`
- Modify: `apps/web/src/app/core/parents.service.ts`

- [ ] **Step 1：清理 `parent-form-dialog.component.ts`**

移除下列內容：
1. `import { StudentsService } from '@core/students.service';`
2. `MultiSelectModule` 從 imports 陣列移除
3. `interface StudentOption { ... }` 整個介面
4. `private readonly studentsService = inject(StudentsService);`
5. `protected readonly studentsLoading = signal(true);`
6. `protected readonly studentOptions = signal<StudentOption[]>([]);`
7. `formData` 中的 `studentIds: [...]` 欄位
8. `ngOnInit()` 整個方法（以及 `OnInit` 的 implements 與 import）
9. `save()` 中 `input` 物件裡的 `studentIds: f.studentIds` / `studentIds: f.studentIds.length > 0 ? f.studentIds : undefined`

最終 `save()` 的 `UpdateParentInput`：
```typescript
const input: UpdateParentInput = {
  name: f.name.trim(),
  email: f.email.trim() || null,
  phone: f.phone.trim() || null,
  notes: f.notes.trim() || null,
};
```

最終 `save()` 的 `CreateParentInput`：
```typescript
const input: CreateParentInput = {
  name: f.name.trim(),
  email: f.email.trim() || undefined,
  phone: f.phone.trim() || undefined,
  notes: f.notes.trim() || undefined,
};
```

- [ ] **Step 2：移除 `parent-form-dialog.component.html` 的關聯學生區塊**

刪除以下整個區塊（約 17 行）：

```html
<!-- 關聯學生 -->
<div class="form-dialog__field">
  <label class="form-dialog__label">關聯學生</label>
  <p-multiselect
    [options]="studentOptions()"
    ...
  />
</div>
```

- [ ] **Step 3：移除 `parents.service.ts` 中 `studentIds` 欄位**

在 `apps/web/src/app/core/parents.service.ts` 找到 `CreateParentInput` 和 `UpdateParentInput` 介面，移除：
- `studentIds?: string[];`

兩個介面都要移除。

- [ ] **Step 4：確認 TypeScript 無錯誤**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | grep -i "parent-form\|parents.service"
```

預期：無錯誤

- [ ] **Step 5：Commit**

```bash
git add apps/web/src/app/shared/components/parent-form-dialog/parent-form-dialog.component.ts
git add apps/web/src/app/shared/components/parent-form-dialog/parent-form-dialog.component.html
git add apps/web/src/app/core/parents.service.ts
git commit -m "refactor(parent-form): remove studentIds multiselect, student link via create student flow"
```

---

## Task 5：ParentsPage — 加入「新增學生」action

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/parents/parents.page.ts`

- [ ] **Step 1：新增 `StudentFormDialogComponent` import**

在 parents.page.ts 的 import 區塊加入：

```typescript
import { StudentFormDialogComponent } from '@features/admin/pages/students/student-form-dialog.component';
```

- [ ] **Step 2：在 `actionMenuItems` computed 加入「新增學生」項目**

在現有 `{ label: '編輯', ... }` 之前加入（讓新增學生排在最前面）：

```typescript
{
  label: '新增學生',
  icon: 'pi pi-user-plus',
  disabled: parent.status === 'archived',
  command: () => this.openAddStudentDialog(parent),
},
```

- [ ] **Step 3：實作 `openAddStudentDialog()` 方法**

加在 `openEditDialog()` 方法之後：

```typescript
protected openAddStudentDialog(parent: Parent): void {
  const ref = this.dialogService.open(StudentFormDialogComponent, {
    width: '560px',
    modal: true,
    showHeader: false,
    appendTo: this.overlayContainer || 'body',
    data: { student: null, parentId: parent.id },
  });

  if (!ref) return;
  ref.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
    if (result) {
      this.messageService.add({
        severity: 'success',
        summary: '學生已建立',
        detail: `「${result.name}」已建立並關聯至「${parent.name}」`,
      });
      this.loadParents();
    }
  });
}
```

> 注意：Task 3 已將 `MessageService` 加入 `StudentFormDialogComponent` 的 `providers`，此 dialog 自給自足，不依賴 `ParentsPage` 的 providers。

- [ ] **Step 4：確認 TypeScript 無錯誤**

```bash
cd apps/web && npx ng build --configuration development 2>&1 | tail -10
```

預期：Build 成功，無錯誤

- [ ] **Step 5：Commit**

```bash
git add apps/web/src/app/features/admin/pages/parents/parents.page.ts
git commit -m "feat(parents): add 新增學生 to parent action menu"
```

---

## Task 6：End-to-End 手動驗證

- [ ] **Step 1：確認家長表單已無關聯學生欄位**

開啟 `/admin/parents` → 點「新增家長」→ 確認表單只有姓名、Email、手機、備註四個欄位

- [ ] **Step 2：確認新增學生流程**

1. 在家長列表找一位家長 → 點 `⋮` → 點「新增學生」
2. 填入學生姓名、年級、學校 → 點「建立學生」
3. 確認 toast 顯示「學生已建立」
4. 開啟 `/admin/students` → 確認新學生出現在列表
5. 確認學生列表的「關聯家長」欄位顯示剛才那位家長的名字

- [ ] **Step 3：確認原有編輯學生仍可正常運作**

在 `/admin/students` 找任一學生 → 點 `⋮` → 點「編輯」→ 確認表單有資料、儲存正常

- [ ] **Step 4：最終 Commit（若有未提交的變更）**

```bash
git status
# 確認無遺漏
```
