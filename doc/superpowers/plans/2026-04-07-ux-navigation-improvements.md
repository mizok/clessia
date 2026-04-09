# UX 導航體驗改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改善 admin 系統的導航體驗，包含 Breadcrumb、家長詳情整合報名、課堂詳情整合出勤狀態、Dashboard 靜態 UI。

**Architecture:** 新增 `PageBreadcrumbComponent` 共用元件；將 `ClassPickerDialogComponent` 移至 shared 供多處複用；新增 `ParentDetailDialogComponent`；在 `SessionDetailDialogComponent` 加入 roster 區塊；重寫 Dashboard 為靜態 UI。

**Tech Stack:** Angular 21 (Standalone Components + Signals)、PrimeNG 21、TypeScript strict mode、Vitest (`npx ng test`)

**Spec:** `doc/superpowers/specs/2026-04-07-ux-navigation-improvements-design.md`

---

## 執行前注意事項

- 所有 component 用 `ng generate` 建立，帶 `--type` 參數
- Signals: `signal()`, `computed()`, `input()`, `inject()`，不用 constructor injection
- Template control flow: `@if`, `@for`，不用 `*ngIf`, `*ngFor`
- 每個 Task 獨立可執行，Task 2 依賴 Task 1 的 `ClassPickerDialog` 搬移完成

---

## 檔案總覽

| 操作 | 路徑 |
|---|---|
| 新增 | `apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.ts` |
| 新增 | `apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.html` |
| 新增 | `apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.scss` |
| 新增 | `apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.spec.ts` |
| 移動 | `student-detail/class-picker-dialog/` → `shared/components/class-picker-dialog/` |
| 新增 | `apps/web/src/app/features/admin/pages/parents/parent-detail-dialog/parent-detail-dialog.component.ts` |
| 新增 | `apps/web/src/app/features/admin/pages/parents/parent-detail-dialog/parent-detail-dialog.component.html` |
| 新增 | `apps/web/src/app/features/admin/pages/parents/parent-detail-dialog/parent-detail-dialog.component.scss` |
| 修改 | `apps/web/src/app/features/admin/pages/parents/parents.page.ts` |
| 修改 | `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.html` |
| 修改 | `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.ts` |
| 修改 | `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html` |
| 修改 | `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts` |
| 修改 | `apps/web/src/app/features/admin/pages/sessions/dialogs/session-detail-dialog/session-detail-dialog.component.ts` |
| 修改 | `apps/web/src/app/features/admin/pages/sessions/dialogs/session-detail-dialog/session-detail-dialog.component.html` |
| 重寫 | `apps/web/src/app/features/admin/pages/dashboard/dashboard.component.ts` |
| 重寫 | `apps/web/src/app/features/admin/pages/dashboard/dashboard.component.html` |
| 重寫 | `apps/web/src/app/features/admin/pages/dashboard/dashboard.component.scss` |

---

## Task 1: PageBreadcrumbComponent + 整合至學生詳情與班級詳情頁

**Files:**
- Create: `apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.ts`
- Create: `apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.html`
- Create: `apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.scss`
- Create: `apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.spec.ts`
- Modify: `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/students/detail/student-detail.page.html`
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html`

- [ ] **Step 1: 建立元件目錄並寫 spec**

```bash
cd apps/web
npx ng generate component shared/components/page-breadcrumb --type component --standalone --skip-tests
```

建立 spec 檔 `apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.spec.ts`：

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { PageBreadcrumbComponent, type BreadcrumbItem } from './page-breadcrumb.component';

describe('PageBreadcrumbComponent', () => {
  let fixture: ComponentFixture<PageBreadcrumbComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PageBreadcrumbComponent, RouterTestingModule],
    }).compileComponents();
    fixture = TestBed.createComponent(PageBreadcrumbComponent);
  });

  it('renders all items', () => {
    const items: BreadcrumbItem[] = [
      { label: '學務管理' },
      { label: '學生', routerLink: '/admin/students' },
      { label: '王小明' },
    ];
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('學務管理');
    expect(el.textContent).toContain('學生');
    expect(el.textContent).toContain('王小明');
  });

  it('last item has no routerLink', () => {
    const items: BreadcrumbItem[] = [
      { label: '學生', routerLink: '/admin/students' },
      { label: '王小明' },
    ];
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    const links = fixture.nativeElement.querySelectorAll('a');
    expect(links.length).toBe(1); // 只有第一項有連結
  });
});
```

- [ ] **Step 2: 執行 spec，確認失敗**

```bash
cd apps/web && npx ng test --include="**/page-breadcrumb.component.spec.ts" --watch=false
```

預期：FAIL（元件尚未實作）

- [ ] **Step 3: 實作 PageBreadcrumbComponent**

`apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.ts`:

```typescript
import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface BreadcrumbItem {
  label: string;
  routerLink?: string;
}

@Component({
  selector: 'app-page-breadcrumb',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './page-breadcrumb.component.html',
  styleUrl: './page-breadcrumb.component.scss',
})
export class PageBreadcrumbComponent {
  readonly items = input.required<BreadcrumbItem[]>();
}
```

`apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.html`:

```html
<nav class="breadcrumb" aria-label="breadcrumb">
  @for (item of items(); track item.label; let last = $last) {
    @if (!last) {
      @if (item.routerLink) {
        <a class="breadcrumb__item breadcrumb__item--link" [routerLink]="item.routerLink">
          {{ item.label }}
        </a>
      } @else {
        <span class="breadcrumb__item">{{ item.label }}</span>
      }
      <span class="breadcrumb__separator" aria-hidden="true">›</span>
    } @else {
      <span class="breadcrumb__item breadcrumb__item--current" aria-current="page">
        {{ item.label }}
      </span>
    }
  }
</nav>
```

`apps/web/src/app/shared/components/page-breadcrumb/page-breadcrumb.component.scss`:

```scss
.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);

  &__item {
    font-size: 0.875rem;
    color: var(--p-zinc-500);
    white-space: nowrap;

    &--link {
      cursor: pointer;
      text-decoration: none;

      &:hover {
        color: var(--p-zinc-800);
      }
    }

    &--current {
      color: var(--p-zinc-800);
      font-weight: 500;
    }
  }

  &__separator {
    font-size: 0.75rem;
    color: var(--p-zinc-400);
  }
}
```

- [ ] **Step 4: 執行 spec，確認通過**

```bash
cd apps/web && npx ng test --include="**/page-breadcrumb.component.spec.ts" --watch=false
```

預期：PASS

- [ ] **Step 5: 整合到學生詳情頁**

在 `student-detail.page.ts` 的 `imports` 陣列加入 `PageBreadcrumbComponent`，並加入 `breadcrumbItems` computed signal：

```typescript
// 在 imports 加入
import { PageBreadcrumbComponent, type BreadcrumbItem } from '@shared/components/page-breadcrumb/page-breadcrumb.component';

// 在 class 內加入
protected readonly breadcrumbItems = computed<BreadcrumbItem[]>(() => {
  const s = this.student();
  return [
    { label: '學務管理' },
    { label: '學生', routerLink: '/admin/students' },
    { label: s?.name ?? '...' },
  ];
});
```

在 `student-detail.page.html` 的 `<header>` 或頁面最頂部加入：

```html
<app-page-breadcrumb [items]="breadcrumbItems()" />
```

- [ ] **Step 6: 整合到班級詳情頁**

在 `class-detail.page.ts` 加入。班級詳情已有 `cls` signal（Class 物件，含 `courseName`、`courseId`）：

```typescript
import { PageBreadcrumbComponent, type BreadcrumbItem } from '@shared/components/page-breadcrumb/page-breadcrumb.component';

protected readonly breadcrumbItems = computed<BreadcrumbItem[]>(() => {
  const c = this.cls();
  return [
    { label: '課務管理' },
    { label: '課程', routerLink: '/admin/courses' },
    { label: c?.courseName ?? '...', routerLink: c ? `/admin/courses/${c.courseId}` : undefined },
    { label: c?.name ?? '...' },
  ];
});
```

在 `class-detail.page.html` 頁面頂部加入：

```html
<app-page-breadcrumb [items]="breadcrumbItems()" />
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/shared/components/page-breadcrumb/ \
  apps/web/src/app/features/admin/pages/students/detail/student-detail.page.* \
  apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.*
git commit -m "feat(ux): add PageBreadcrumbComponent and integrate into student/class detail pages"
```

---

## Task 2: 移動 ClassPickerDialog 至 shared + 建立 ParentDetailDialogComponent

**Files:**
- Move: `student-detail/class-picker-dialog/` → `shared/components/class-picker-dialog/`
- Modify: `student-detail.page.ts` (更新 import 路徑)
- Create: `parents/parent-detail-dialog/parent-detail-dialog.component.ts`
- Create: `parents/parent-detail-dialog/parent-detail-dialog.component.html`
- Create: `parents/parent-detail-dialog/parent-detail-dialog.component.scss`
- Modify: `parents/parents.page.ts`

- [ ] **Step 1: 移動 ClassPickerDialog 到 shared**

```bash
mkdir -p apps/web/src/app/shared/components/class-picker-dialog
cp apps/web/src/app/features/admin/pages/students/detail/class-picker-dialog/class-picker-dialog.component.* \
   apps/web/src/app/shared/components/class-picker-dialog/
rm -rf apps/web/src/app/features/admin/pages/students/detail/class-picker-dialog/
```

更新 `apps/web/src/app/shared/components/class-picker-dialog/class-picker-dialog.component.ts` 的 selector（若有需要），確認 imports 路徑正確（`@core/...` alias 應保持不變）。

- [ ] **Step 2: 更新 student-detail.page.ts 的 import 路徑**

將：
```typescript
import { ClassPickerDialogComponent } from './class-picker-dialog/class-picker-dialog.component';
```
改為：
```typescript
import { ClassPickerDialogComponent } from '@shared/components/class-picker-dialog/class-picker-dialog.component';
```

- [ ] **Step 3: 確認編譯正常**

```bash
cd apps/web && npx ng build --configuration=development 2>&1 | tail -20
```

預期：無錯誤

- [ ] **Step 4: 建立 ParentDetailDialogComponent**

```bash
cd apps/web
npx ng generate component features/admin/pages/parents/parent-detail-dialog --type component --standalone --skip-tests
```

`parent-detail-dialog.component.ts`:

```typescript
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ParentsService, type ParentDetail, type ParentDetailStudent } from '@core/parents.service';
import { EnrollmentsService } from '@core/enrollments.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { ClassPickerDialogComponent } from '@shared/components/class-picker-dialog/class-picker-dialog.component';
import { GRADE_LEVEL_LABELS, type GradeLevel } from '@core/students.service';
import type { Class } from '@core/classes.service';

@Component({
  selector: 'app-parent-detail-dialog',
  standalone: true,
  imports: [ButtonModule, TagModule, SkeletonModule, ToastModule],
  providers: [MessageService, DialogService],
  templateUrl: './parent-detail-dialog.component.html',
  styleUrl: './parent-detail-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParentDetailDialogComponent implements OnInit {
  private readonly config = inject(DynamicDialogConfig);
  private readonly parentsService = inject(ParentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly parent = signal<ParentDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly enrollingStudentId = signal<string | null>(null);
  protected readonly GRADE_LEVEL_LABELS = GRADE_LEVEL_LABELS;

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }

  ngOnInit(): void {
    const parentId: string = this.config.data?.parentId;
    if (!parentId) return;
    this.parentsService.get(parentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.parent.set(res.data);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  protected openClassPicker(student: ParentDetailStudent): void {
    this.enrollingStudentId.set(student.id);
    // 取得目前在籍的班級（簡化：先不預先過濾，ClassPickerDialog 內部有去重）
    const ref = this.dialogService.open(ClassPickerDialogComponent, {
      header: `${student.name} — 選擇班級`,
      width: '520px',
      modal: true,
      showHeader: true,
      appendTo: this.overlayContainer || 'body',
      data: {
        existingClassIds: [],
        studentGrade: student.grade as GradeLevel,
      },
    });
    ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cls: Class | undefined) => {
      this.enrollingStudentId.set(null);
      if (cls) this.enroll(student, cls);
    });
  }

  private enroll(student: ParentDetailStudent, cls: Class): void {
    this.enrollmentsService
      .create({ classId: cls.id, studentId: student.id })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: '報名成功',
            detail: `「${student.name}」已加入「${cls.name}」`,
          });
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: '報名失敗',
            detail: '無法完成報名，請稍後再試',
          });
        },
      });
  }
}
```

- [ ] **Step 5: 撰寫 HTML template**

`parent-detail-dialog.component.html`:

```html
<p-toast appendTo="body" [baseZIndex]="25000" />

<div class="parent-detail">
  @if (loading()) {
    <div class="parent-detail__skeleton">
      <p-skeleton height="20px" width="60%" />
      <p-skeleton height="16px" width="40%" styleClass="mt-2" />
    </div>
  } @else if (parent(); as p) {
    <div class="parent-detail__info">
      <span class="parent-detail__contact">{{ p.phone ?? p.email ?? '無聯絡資訊' }}</span>
    </div>

    <section class="parent-detail__students">
      <h3 class="parent-detail__section-title">旗下學生</h3>

      @if (p.students.length === 0) {
        <p class="parent-detail__empty">尚未建立學生資料</p>
      } @else {
        <ul class="parent-detail__student-list">
          @for (student of p.students; track student.id) {
            <li class="parent-detail__student-item">
              <div class="parent-detail__student-info">
                <span class="parent-detail__student-name">{{ student.name }}</span>
                <span class="parent-detail__student-grade">
                  {{ GRADE_LEVEL_LABELS[student.grade] ?? student.grade }}
                </span>
              </div>
              <p-button
                label="報名班級"
                icon="pi pi-plus"
                severity="secondary"
                size="small"
                [loading]="enrollingStudentId() === student.id"
                (onClick)="openClassPicker(student)"
              />
            </li>
          }
        </ul>
      }
    </section>
  } @else {
    <p class="parent-detail__empty">載入失敗，請關閉後重試</p>
  }
</div>
```

- [ ] **Step 6: 撰寫 SCSS**

`parent-detail-dialog.component.scss`:

```scss
.parent-detail {
  padding: var(--space-2);

  &__info {
    margin-bottom: var(--space-4);
    font-size: 0.875rem;
    color: var(--p-zinc-500);
  }

  &__section-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--p-zinc-700);
    margin-bottom: var(--space-3);
  }

  &__student-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  &__student-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--p-zinc-200);
    border-radius: 8px;
    background: var(--p-zinc-50);
  }

  &__student-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  &__student-name {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--p-zinc-900);
  }

  &__student-grade {
    font-size: 0.75rem;
    color: var(--p-zinc-500);
  }

  &__empty {
    font-size: 0.875rem;
    color: var(--p-zinc-400);
    text-align: center;
    padding: var(--space-6) 0;
  }

  &__skeleton {
    padding: var(--space-2);
  }
}
```

- [ ] **Step 7: 在 parents.page.ts 加入「查看詳情」入口**

在 `parents.page.ts` 的 imports 加入 `ParentDetailDialogComponent`，並在 `buildMenuItems()` 最前面插入「查看詳情」選項：

```typescript
import { ParentDetailDialogComponent } from './parent-detail-dialog/parent-detail-dialog.component';

// 在 buildMenuItems 的 items 陣列最前面加入：
{
  label: '查看詳情',
  icon: 'pi pi-user',
  command: () => this.openDetailDialog(parent),
},
```

新增 `openDetailDialog` method：

```typescript
protected openDetailDialog(parent: Parent): void {
  this.dialogService.open(ParentDetailDialogComponent, {
    header: parent.name,
    width: '480px',
    modal: true,
    showHeader: true,
    appendTo: this.overlayContainer || 'body',
    data: { parentId: parent.id },
  });
}
```

- [ ] **Step 8: 確認編譯正常**

```bash
cd apps/web && npx ng build --configuration=development 2>&1 | tail -20
```

預期：無錯誤

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/shared/components/class-picker-dialog/ \
  apps/web/src/app/features/admin/pages/students/detail/student-detail.page.ts \
  apps/web/src/app/features/admin/pages/parents/
git commit -m "feat(ux): move ClassPickerDialog to shared, add ParentDetailDialog with enrollment"
```

---

## Task 3: Session Detail 整合出勤 Roster

**Files:**
- Modify: `sessions/dialogs/session-detail-dialog/session-detail-dialog.component.ts`
- Modify: `sessions/dialogs/session-detail-dialog/session-detail-dialog.component.html`
- Modify: `sessions/dialogs/session-detail-dialog/session-detail-dialog.component.scss`

**關鍵資訊：**
- `attendanceService.roster(eventId)` 回傳 `AttendanceRoster`，其中 `students: RosterStudent[]`
- `RosterStudent.status` 為 `'present' | 'absent' | 'on_leave' | null`（null = 尚未點名）
- `config.data?.sessionId` 即為 roster API 所需的 `eventId`

- [ ] **Step 1: 在 session-detail-dialog.component.ts 加入 roster 資料**

在現有 `SessionDetailDialogComponent` class 加入：

```typescript
import { AttendanceService, type RosterStudent, ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_SEVERITIES } from '@core/attendance.service';

// 在 class 內加入 signals
protected readonly roster = signal<RosterStudent[]>([]);
protected readonly rosterLoading = signal(false);
protected readonly rosterError = signal(false);
protected readonly ATTENDANCE_STATUS_LABELS = ATTENDANCE_STATUS_LABELS;
protected readonly ATTENDANCE_STATUS_SEVERITIES = ATTENDANCE_STATUS_SEVERITIES;

// 注入 service
private readonly attendanceService = inject(AttendanceService);

// 在 ngOnInit 的 loadSession 成功後，加入 roster 載入
// 或在 ngOnInit 直接並行呼叫：
```

在 `ngOnInit` 中，取得 sessionId 後同步呼叫 roster：

```typescript
const sessionId: string = this.config.data?.sessionId;
if (!sessionId) return;

// 現有的 session 載入邏輯保持不變...

// 加入 roster 載入
this.rosterLoading.set(true);
this.attendanceService.roster(sessionId)
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe({
    next: (res) => {
      this.roster.set(res.students);
      this.rosterLoading.set(false);
    },
    error: () => {
      this.rosterError.set(true);
      this.rosterLoading.set(false);
    },
  });
```

確認 `AttendanceService` 加入 imports 清單。

- [ ] **Step 2: 在 HTML 加入 roster 區塊**

在 `session-detail-dialog.component.html` 的 `</div>` 最後（history section 之後）加入：

```html
<section class="session-detail__roster">
  <p class="session-detail__roster-title">學生出勤狀態</p>

  @if (rosterLoading()) {
    <div class="session-detail__roster-skeleton">
      @for (i of [1, 2, 3]; track i) {
        <p-skeleton height="40px" borderRadius="6px" />
      }
    </div>
  } @else if (rosterError()) {
    <div class="session-detail__roster-error">
      <i class="pi pi-exclamation-circle"></i>
      <span>出勤資料載入失敗</span>
    </div>
  } @else if (roster().length === 0) {
    <p class="session-detail__roster-empty">此班級尚無學生</p>
  } @else {
    <ul class="session-detail__roster-list">
      @for (student of roster(); track student.studentId) {
        <li class="session-detail__roster-item">
          <span class="session-detail__roster-name">{{ student.studentName }}</span>
          @if (student.status) {
            <p-tag
              [value]="ATTENDANCE_STATUS_LABELS[student.status]"
              [severity]="ATTENDANCE_STATUS_SEVERITIES[student.status]"
            />
          } @else {
            <p-tag value="尚未點名" severity="secondary" />
          }
        </li>
      }
    </ul>
  }
</section>
```

- [ ] **Step 3: 加入對應 SCSS**

在 `session-detail-dialog.component.scss` 加入：

```scss
.session-detail {
  // 在現有 class 底下加入

  &__roster {
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--p-zinc-100);
  }

  &__roster-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--p-zinc-700);
    margin-bottom: var(--space-3);
  }

  &__roster-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  &__roster-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    background: var(--p-zinc-50);
    border-radius: 6px;
  }

  &__roster-name {
    font-size: 0.9375rem;
    color: var(--p-zinc-800);
  }

  &__roster-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  &__roster-error {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.875rem;
    color: var(--p-red-500);
    padding: var(--space-3);
  }

  &__roster-empty {
    font-size: 0.875rem;
    color: var(--p-zinc-400);
    text-align: center;
    padding: var(--space-4) 0;
  }
}
```

- [ ] **Step 4: 確認編譯正常**

```bash
cd apps/web && npx ng build --configuration=development 2>&1 | tail -20
```

預期：無錯誤

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/sessions/dialogs/session-detail-dialog/
git commit -m "feat(ux): add attendance roster section to session detail dialog"
```

---

## Task 4: Dashboard 靜態 UI

**Files:**
- Rewrite: `apps/web/src/app/features/admin/pages/dashboard/dashboard.component.ts`
- Rewrite: `apps/web/src/app/features/admin/pages/dashboard/dashboard.component.html`
- Rewrite: `apps/web/src/app/features/admin/pages/dashboard/dashboard.component.scss`

**注意：這是靜態 UI，所有資料為示範用寫死值或空陣列，不串接 API。**

- [ ] **Step 1: 重寫 dashboard.component.ts**

```typescript
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { RoutesCatalog } from '@core/smart-enums/routes-catalog';

interface StatCard {
  label: string;
  value: string;
  sub?: string;
  icon: string;
  routerLink?: string;
  accent?: boolean;
}

interface TodaySession {
  time: string;
  className: string;
  teacher: string;
  room: string;
  status: 'completed' | 'ongoing' | 'upcoming' | 'has_leave';
  statusLabel: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, ButtonModule, TagModule, SkeletonModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  protected readonly today = new Date();
  protected readonly RoutesCatalog = RoutesCatalog;

  protected readonly statCards: StatCard[] = [
    { label: '今日課堂', value: '—', icon: 'pi-calendar', routerLink: '/admin/sessions' },
    { label: '待處理', value: '—', sub: '請假 · 報名', icon: 'pi-bell', accent: true },
    { label: '在籍學生', value: '—', icon: 'pi-users', routerLink: '/admin/students' },
    { label: '本月新報名', value: '—', icon: 'pi-user-plus' },
  ];

  protected readonly todaySessions: TodaySession[] = [];

  protected readonly pendingLeaves: { studentName: string; className: string }[] = [];
  protected readonly pendingEnrollments: { studentName: string; className: string }[] = [];

  protected getSessionSeverity(status: TodaySession['status']): string {
    const map: Record<TodaySession['status'], string> = {
      completed: 'success',
      ongoing: 'info',
      upcoming: 'secondary',
      has_leave: 'warn',
    };
    return map[status];
  }
}
```

- [ ] **Step 2: 重寫 dashboard.component.html**

```html
<div class="dashboard">
  <!-- Page Header -->
  <header class="dashboard__header">
    <div>
      <h1 class="dashboard__title">總覽</h1>
      <p class="dashboard__date">
        {{ today | date:'yyyy年M月d日 EEEE':'':'zh-TW' }}
      </p>
    </div>
  </header>

  <!-- Stat Cards -->
  <div class="dashboard__stats">
    @for (card of statCards; track card.label) {
      <div
        class="dashboard__stat-card"
        [class.dashboard__stat-card--accent]="card.accent"
        [routerLink]="card.routerLink ?? null"
        [class.dashboard__stat-card--clickable]="!!card.routerLink"
      >
        <div class="dashboard__stat-icon">
          <i class="pi {{ card.icon }}"></i>
        </div>
        <div class="dashboard__stat-body">
          <p class="dashboard__stat-value">{{ card.value }}</p>
          <p class="dashboard__stat-label">{{ card.label }}</p>
          @if (card.sub) {
            <p class="dashboard__stat-sub">{{ card.sub }}</p>
          }
        </div>
      </div>
    }
  </div>

  <!-- Today Sessions -->
  <section class="dashboard__section">
    <div class="dashboard__section-header">
      <h2 class="dashboard__section-title">今日課表</h2>
      <a class="dashboard__section-link" [routerLink]="['/admin/sessions']">查看全部 →</a>
    </div>

    @if (todaySessions.length === 0) {
      <div class="dashboard__empty">
        <i class="pi pi-calendar dashboard__empty-icon"></i>
        <p>今日尚無排課</p>
      </div>
    } @else {
      <ul class="dashboard__session-list">
        @for (s of todaySessions; track s.time) {
          <li class="dashboard__session-item">
            <span class="dashboard__session-time">{{ s.time }}</span>
            <span class="dashboard__session-class">{{ s.className }}</span>
            <span class="dashboard__session-teacher">{{ s.teacher }}</span>
            <span class="dashboard__session-room">{{ s.room }}</span>
            <p-tag [value]="s.statusLabel" [severity]="getSessionSeverity(s.status)" />
          </li>
        }
      </ul>
    }
  </section>

  <!-- Pending Items -->
  <div class="dashboard__pending">
    <!-- Leave -->
    <section class="dashboard__pending-card">
      <div class="dashboard__section-header">
        <h2 class="dashboard__section-title">待確認請假</h2>
        <a class="dashboard__section-link" [routerLink]="['/admin/leave']">前往管理 →</a>
      </div>
      @if (pendingLeaves.length === 0) {
        <p class="dashboard__pending-empty">目前無待確認請假</p>
      } @else {
        <ul class="dashboard__pending-list">
          @for (item of pendingLeaves; track item.studentName) {
            <li class="dashboard__pending-item">
              <span>{{ item.studentName }}</span>
              <span class="dashboard__pending-class">{{ item.className }}</span>
            </li>
          }
        </ul>
      }
    </section>

    <!-- Enrollment -->
    <section class="dashboard__pending-card">
      <div class="dashboard__section-header">
        <h2 class="dashboard__section-title">待審核報名</h2>
        <a class="dashboard__section-link" [routerLink]="['/admin/parents']">前往管理 →</a>
      </div>
      @if (pendingEnrollments.length === 0) {
        <p class="dashboard__pending-empty">目前無待審核報名</p>
      } @else {
        <ul class="dashboard__pending-list">
          @for (item of pendingEnrollments; track item.studentName) {
            <li class="dashboard__pending-item">
              <span>{{ item.studentName }}</span>
              <span class="dashboard__pending-class">{{ item.className }}</span>
            </li>
          }
        </ul>
      }
    </section>
  </div>

  <!-- Manager Overview (placeholder) -->
  <section class="dashboard__section dashboard__section--overview">
    <h2 class="dashboard__section-title">管理概覽</h2>
    <div class="dashboard__charts">
      <div class="dashboard__chart-placeholder">
        <i class="pi pi-chart-bar dashboard__chart-icon"></i>
        <p>各班出席率</p>
        <p class="dashboard__chart-note">資料串接中</p>
      </div>
      <div class="dashboard__chart-placeholder">
        <i class="pi pi-chart-line dashboard__chart-icon"></i>
        <p>學生人數趨勢</p>
        <p class="dashboard__chart-note">資料串接中</p>
      </div>
    </div>
  </section>
</div>
```

- [ ] **Step 3: 重寫 dashboard.component.scss**

```scss
.dashboard {
  padding: var(--space-5) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);

  &__header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }

  &__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--p-zinc-900);
    margin: 0 0 var(--space-1);
  }

  &__date {
    font-size: 0.875rem;
    color: var(--p-zinc-500);
  }

  // Stat cards
  &__stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-4);

    @media (max-width: 1024px) {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  &__stat-card {
    background: #fff;
    border: 1px solid var(--p-zinc-200);
    border-radius: 12px;
    padding: var(--space-4) var(--space-5);
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    transition: box-shadow 150ms ease;

    &--clickable {
      cursor: pointer;
      &:hover {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }
    }

    &--accent {
      border-color: var(--p-sky-200);
      background: var(--p-sky-50);
    }
  }

  &__stat-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--p-zinc-100);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    color: var(--p-zinc-600);
    flex-shrink: 0;
  }

  &__stat-body {
    flex: 1;
    min-width: 0;
  }

  &__stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--p-zinc-900);
    line-height: 1;
    margin: 0 0 var(--space-1);
  }

  &__stat-label {
    font-size: 0.8125rem;
    color: var(--p-zinc-600);
    margin: 0;
  }

  &__stat-sub {
    font-size: 0.75rem;
    color: var(--p-zinc-400);
    margin: var(--space-1) 0 0;
  }

  // Sections
  &__section {
    background: #fff;
    border: 1px solid var(--p-zinc-200);
    border-radius: 12px;
    padding: var(--space-4) var(--space-5);

    &--overview {
      background: var(--p-zinc-50);
    }
  }

  &__section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-4);
  }

  &__section-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--p-zinc-800);
    margin: 0;
  }

  &__section-link {
    font-size: 0.8125rem;
    color: var(--p-sky-600);
    text-decoration: none;
    &:hover { text-decoration: underline; }
  }

  // Sessions
  &__session-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  &__session-item {
    display: grid;
    grid-template-columns: 80px 1fr 1fr 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--p-zinc-50);
    border-radius: 8px;
    font-size: 0.875rem;
  }

  &__session-time {
    font-weight: 600;
    color: var(--p-zinc-700);
    font-variant-numeric: tabular-nums;
  }

  &__session-class {
    font-weight: 500;
    color: var(--p-zinc-800);
  }

  &__session-teacher,
  &__session-room {
    color: var(--p-zinc-500);
  }

  // Pending
  &__pending {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);

    @media (max-width: 768px) {
      grid-template-columns: 1fr;
    }
  }

  &__pending-card {
    background: #fff;
    border: 1px solid var(--p-zinc-200);
    border-radius: 12px;
    padding: var(--space-4) var(--space-5);
  }

  &__pending-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  &__pending-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.875rem;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--p-zinc-100);

    &:last-child { border-bottom: none; }
  }

  &__pending-class {
    font-size: 0.8125rem;
    color: var(--p-zinc-400);
  }

  &__pending-empty {
    font-size: 0.875rem;
    color: var(--p-zinc-400);
    padding: var(--space-3) 0;
  }

  // Charts placeholder
  &__charts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);

    @media (max-width: 768px) {
      grid-template-columns: 1fr;
    }
  }

  &__chart-placeholder {
    height: 160px;
    border: 2px dashed var(--p-zinc-200);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--p-zinc-400);
    font-size: 0.875rem;
  }

  &__chart-icon {
    font-size: 1.5rem;
    color: var(--p-zinc-300);
  }

  &__chart-note {
    font-size: 0.75rem;
    color: var(--p-zinc-300);
  }

  // Empty state
  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-6) 0;
    color: var(--p-zinc-400);
    font-size: 0.875rem;
  }

  &__empty-icon {
    font-size: 1.5rem;
    color: var(--p-zinc-300);
  }
}
```

- [ ] **Step 4: 確認 DatePipe 的 locale 設定**

Dashboard 使用 `date:'yyyy年M月d日 EEEE':'':'zh-TW'`，確認 `app.config.ts` 有：

```typescript
import { registerLocaleData } from '@angular/common';
import localeZhTW from '@angular/common/locales/zh-Hant-TW';
registerLocaleData(localeZhTW);
```

若無，加入此段。若格式有問題可改用 `date:'yyyy/MM/dd'` 簡化。

- [ ] **Step 5: 確認編譯正常**

```bash
cd apps/web && npx ng build --configuration=development 2>&1 | tail -20
```

預期：無錯誤

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/dashboard/
git commit -m "feat(ux): implement static dashboard UI with today's schedule and pending items"
```

---

## 自我審查

- [x] Spec 項目 1（Breadcrumb）→ Task 1 完整覆蓋
- [x] Spec 項目 2（家長詳情整合報名）→ Task 2 完整覆蓋
- [x] Spec 項目 3（Session detail 請假整合）→ Task 3 完整覆蓋，且簡化為單一 roster API
- [x] Spec 項目 4（Dashboard 靜態 UI）→ Task 4 完整覆蓋
- [x] 無 TBD/TODO placeholder
- [x] 型別命名一致（`RosterStudent`、`ParentDetailStudent`、`BreadcrumbItem` 貫穿全文）
- [x] `ClassPickerDialogComponent` 在 Task 2 Step 1 先搬移，Task 2 Step 4 才建立 ParentDetailDialog 使用
- [x] 每個 Task 都有 commit
