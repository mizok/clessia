# 課堂出勤操作台 Filter 強化 — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為出勤操作台加上日期範圍選擇、分校篩選、學生多選篩選，並在 session 卡片上顯示課程名稱與課堂日期。

**Architecture:** API 層在 sessions 回傳中新增 `courseName`；分校篩選透過 API param 做 server-side filter；學生篩選在前端透過 enrollment classIds 做 client-side filter；日期改為 range 模式。

**Tech Stack:** Angular 21 Signals, PrimeNG 21 (p-datepicker range / p-select / p-multiselect), Hono + @hono/zod-openapi, Supabase JS, date-fns

---

## 異動檔案總覽

| 動作 | 路徑 | 說明 |
|------|------|------|
| Modify | `apps/api/src/routes/attendance.ts` | sessions query 加 courses join；schema + response 加 courseName |
| Modify | `apps/web/src/app/core/attendance.service.ts` | EventSessionSummary 加 courseName；sessions() 參數加 campusId |
| Modify | `apps/web/src/app/features/admin/pages/attendance/attendance.page.ts` | date range、campus filter、student filter 邏輯 |
| Modify | `apps/web/src/app/features/admin/pages/attendance/attendance.page.html` | toolbar + 卡片 template |
| Modify | `apps/web/src/app/features/admin/pages/attendance/attendance.page.scss` | 卡片新 layout 樣式 |

---

## Task 1：API — sessions 回傳加 courseName

**Files:**
- Modify: `apps/api/src/routes/attendance.ts`

- [ ] **Step 1：在 `EventSessionSummarySchema` 加 `courseName` 欄位**

找到 `EventSessionSummarySchema`（約 41 行），在 `takenAt` 之後加一行：

```typescript
const EventSessionSummarySchema = z
  .object({
    eventId: z.uuid(),
    classId: z.uuid(),
    className: z.string(),
    courseName: z.string().nullable(),   // ← 新增
    teacherName: z.string().nullable(),
    campusId: z.uuid().nullable(),
    campusName: z.string().nullable(),
    eventDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    enrolledCount: z.number(),
    presentCount: z.number(),
    onLeaveCount: z.number(),
    absentCount: z.number(),
    takenAt: z.string().nullable(),
  })
  .openapi('EventSessionSummary');
```

- [ ] **Step 2：sessions query 改為 join courses**

找到 `GET /api/attendance/sessions` handler 內的 eventsQuery，把：
```typescript
sessions(
  class_id,
  classes(name)
)
```
改為：
```typescript
sessions(
  class_id,
  classes(name, courses(name))
)
```

- [ ] **Step 3：response mapping 加 courseName**

找到 `return {` 的 mapping 物件（約 `eventId: ev.id` 那段），在 `className` 之後加：

```typescript
eventId: ev.id,
classId: classId ?? '',
className: classRow?.name ?? '',
courseName: (classRow as any)?.courses?.name ?? null,   // ← 新增
teacherName: null,
// ... 其餘不變
```

- [ ] **Step 4：手動驗證（wrangler 啟動後）**

```bash
curl -s "http://localhost:8787/api/attendance/sessions?date=2026-04-01" \
  -H "Cookie: <your-session-cookie>" | jq '.[0].courseName'
```

預期：回傳字串或 `null`（不是 undefined，不是 500）

- [ ] **Step 5：commit**

```bash
git add apps/api/src/routes/attendance.ts
git commit -m "feat(api): add courseName to attendance sessions response"
```

---

## Task 2：前端 service — 更新 EventSessionSummary interface

**Files:**
- Modify: `apps/web/src/app/core/attendance.service.ts`

- [ ] **Step 1：在 `EventSessionSummary` interface 加 `courseName`**

```typescript
export interface EventSessionSummary {
  eventId: string;
  classId: string;
  className: string;
  courseName: string | null;   // ← 新增
  teacherName: string | null;
  campusId: string | null;
  campusName: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  enrolledCount: number;
  presentCount: number;
  onLeaveCount: number;
  absentCount: number;
  takenAt: string | null;
}
```

- [ ] **Step 2：sessions() method 加 campusId param**

```typescript
sessions(params: {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  campusId?: string;   // 已存在，確認無需改動
}): Observable<EventSessionSummary[]> {
  let p = new HttpParams();
  if (params.date) p = p.set('date', params.date);
  if (params.dateFrom) p = p.set('dateFrom', params.dateFrom);
  if (params.dateTo) p = p.set('dateTo', params.dateTo);
  if (params.campusId) p = p.set('campusId', params.campusId);
  return this.http.get<EventSessionSummary[]>(`${this.baseUrl}/sessions`, { params: p });
}
```

（若已有 campusId 則只需確認，不用重寫）

- [ ] **Step 3：commit**

```bash
git add apps/web/src/app/core/attendance.service.ts
git commit -m "feat(web): add courseName to EventSessionSummary interface"
```

---

## Task 3：AttendancePage — 日期範圍 + 分校 filter 邏輯

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.ts`

- [ ] **Step 1：更新 imports**

```typescript
import { Component, OnInit, inject, signal, input, computed, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { forkJoin } from 'rxjs';
import { format } from 'date-fns';
import type { RouteObj } from '@core/smart-enums/routes-catalog';
import { AttendanceService, type EventSessionSummary } from '@core/attendance.service';
import { OrgSettingsService } from '@core/org-settings.service';
import { OverlayContainerService } from '@core/overlay-container.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { StudentsService, type Student, GRADE_LEVEL_LABELS } from '@core/students.service';
import { EnrollmentsService } from '@core/enrollments.service';
import {
  AttendanceRosterPanelComponent,
  type RosterPanelSession,
} from '@shared/components/attendance-roster-panel/attendance-roster-panel.component';
import { ImeFilterInputComponent } from '@shared/components/ime-filter-input/ime-filter-input.component';
```

- [ ] **Step 2：更新 @Component decorator**

```typescript
@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    DatePickerModule,
    SelectModule,
    MultiSelectModule,
    DynamicDialogModule,
    ToastModule,
    ImeFilterInputComponent,
  ],
  providers: [MessageService, DialogService],
  templateUrl: './attendance.page.html',
  styleUrl: './attendance.page.scss',
})
```

- [ ] **Step 3：更新 class 內的 signals 與 inject**

把原有 `selectedDate = signal<Date>(new Date())` 替換為以下完整 signals 區塊：

```typescript
export class AttendancePage implements OnInit {
  readonly page = input.required<RouteObj>();

  private readonly attendanceService = inject(AttendanceService);
  private readonly orgSettingsService = inject(OrgSettingsService);
  private readonly dialogService = inject(DialogService);
  private readonly overlayContainerService = inject(OverlayContainerService);
  private readonly campusesService = inject(CampusesService);
  private readonly studentsService = inject(StudentsService);
  private readonly enrollmentsService = inject(EnrollmentsService);

  // ── 日期範圍 ─────────────────────────────────────────────────
  protected readonly selectedDateRange = signal<Date[]>([new Date(), new Date()]);

  // ── 分校 ─────────────────────────────────────────────────────
  protected readonly campuses = signal<Campus[]>([]);
  protected readonly selectedCampusId = signal<string | null>(null);
  protected readonly campusOptions = computed(() => [
    { id: null, name: '全部分校' },
    ...this.campuses(),
  ]);

  // ── 學生 ─────────────────────────────────────────────────────
  protected readonly students = signal<Student[]>([]);
  protected readonly selectedStudentIds = signal<string[]>([]);
  protected readonly studentFilterQuery = signal('');
  protected readonly filteredStudentOptions = computed(() => {
    const q = this.studentFilterQuery().toLowerCase();
    const all = this.students();
    if (!q) return all;
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.school.toLowerCase().includes(q) ||
        (GRADE_LEVEL_LABELS[s.grade as keyof typeof GRADE_LEVEL_LABELS] ?? s.grade)
          .toLowerCase()
          .includes(q),
    );
  });

  private readonly studentEnrolledClassIds = signal<Set<string>>(new Set());

  // ── Sessions ─────────────────────────────────────────────────
  protected readonly sessions = signal<EventSessionSummary[]>([]);
  protected readonly loading = signal(false);

  protected readonly filteredSessions = computed(() => {
    const classIds = this.studentEnrolledClassIds();
    if (classIds.size === 0) return this.sessions();
    return this.sessions().filter((s) => classIds.has(s.classId));
  });

  protected get overlayContainer(): HTMLElement | null {
    return this.overlayContainerService.getContainer();
  }
```

- [ ] **Step 4：更新 ngOnInit + 新增 student effect**

```typescript
  ngOnInit(): void {
    this.orgSettingsService.getSettings().subscribe({
      next: (s) => this.orgSettingsService.settings.set(s),
    });
    this.campusesService.list({ isActive: true, pageSize: 100 }).subscribe({
      next: (res) => this.campuses.set(res.data),
    });
    this.studentsService.list({ isActive: true, pageSize: 500 }).subscribe({
      next: (res) => this.students.set(res.data),
    });
    this.loadSessions();

    effect(() => {
      const ids = this.selectedStudentIds();
      if (ids.length === 0) {
        this.studentEnrolledClassIds.set(new Set());
        return;
      }
      forkJoin(
        ids.map((id) =>
          this.enrollmentsService.list({ studentId: id, status: 'active', pageSize: 200 }),
        ),
      ).subscribe((results) => {
        const classIds = new Set(results.flatMap((r) => r.data.map((e) => e.classId)));
        this.studentEnrolledClassIds.set(classIds);
      });
    }, { allowSignalWrites: true });
  }
```

- [ ] **Step 5：更新事件處理 methods**

```typescript
  protected onDateRangeChange(range: Date[]): void {
    this.selectedDateRange.set(range);
    if (range[0] && range[1]) {
      this.loadSessions();
    }
  }

  protected onCampusChange(campusId: string | null): void {
    this.selectedCampusId.set(campusId);
    this.loadSessions();
  }

  protected loadSessions(): void {
    const range = this.selectedDateRange();
    const start = range[0];
    const end = range[1];
    if (!start || !end) return;

    this.loading.set(true);
    this.attendanceService
      .sessions({
        dateFrom: format(start, 'yyyy-MM-dd'),
        dateTo: format(end, 'yyyy-MM-dd'),
        campusId: this.selectedCampusId() ?? undefined,
      })
      .subscribe({
        next: (data) => {
          this.sessions.set(data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
```

（保留原有 `openPanel`、`onPanelSaved`、`isTaken`、`isAdminLed` 不動）

- [ ] **Step 6：新增 gradeLabel helper method**

```typescript
  protected gradeLabel(grade: string): string {
    return GRADE_LEVEL_LABELS[grade as keyof typeof GRADE_LEVEL_LABELS] ?? grade;
  }
```

- [ ] **Step 7：新增 formatEventDate helper method**

```typescript
  protected formatEventDate(dateStr: string): string {
    const d = new Date(dateStr);
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}（週${days[d.getDay()]}）`;
  }
```

- [ ] **Step 8：commit**

```bash
git add apps/web/src/app/features/admin/pages/attendance/attendance.page.ts
git commit -m "feat(admin): add date range, campus filter, student filter to attendance page"
```

---

## Task 4：AttendancePage — HTML template 更新

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.html`

- [ ] **Step 1：完整替換 template**

```html
<p-toast appendTo="body" />

<div class="attendance-page">
  <div class="attendance-page__header">
    <h2 class="attendance-page__title">{{ page().label }}</h2>
  </div>

  <div class="attendance-page__toolbar">
    <p-datepicker
      selectionMode="range"
      [ngModel]="selectedDateRange()"
      (ngModelChange)="onDateRangeChange($event)"
      dateFormat="yy/mm/dd"
      placeholder="選擇日期範圍"
      [showIcon]="true"
      [readonlyInput]="true"
      [firstDayOfWeek]="1"
      appendTo="body"
    />

    @if (campuses().length > 0) {
      <p-select
        [options]="campusOptions()"
        optionLabel="name"
        optionValue="id"
        [ngModel]="selectedCampusId()"
        (ngModelChange)="onCampusChange($event)"
        placeholder="全部分校"
        appendTo="body"
      />
    }

    <p-multiselect
      [options]="filteredStudentOptions()"
      optionLabel="name"
      optionValue="id"
      [ngModel]="selectedStudentIds()"
      (ngModelChange)="selectedStudentIds.set($event)"
      placeholder="篩選學生"
      selectedItemsLabel="{0} 位學生"
      [filter]="false"
      [showClear]="true"
      appendTo="body"
    >
      <ng-template #filter>
        <app-ime-filter-input
          placeholder="搜尋學生姓名..."
          (filterChange)="studentFilterQuery.set($event)"
        />
      </ng-template>
      <ng-template #item let-student>
        <div class="attendance-page__student-option">
          <span class="attendance-page__student-option-name">{{ student.name }}</span>
          <span class="attendance-page__student-option-meta">
            {{ student.school }} · {{ gradeLabel(student.grade) }}
          </span>
        </div>
      </ng-template>
    </p-multiselect>

    <p-button
      icon="pi pi-refresh"
      severity="secondary"
      [text]="true"
      (onClick)="loadSessions()"
    />
  </div>

  <div class="attendance-page__body">
    @if (loading()) {
      @for (i of [1, 2, 3]; track i) {
        <div class="attendance-page__skeleton"></div>
      }
    } @else if (filteredSessions().length === 0) {
      <div class="attendance-page__empty">沒有符合條件的課堂</div>
    } @else {
      @for (session of filteredSessions(); track session.eventId) {
        <div class="attendance-page__card">
          <div class="attendance-page__card-info">
            <div class="attendance-page__card-top">
              <div class="attendance-page__card-titles">
                @if (session.courseName) {
                  <div class="attendance-page__card-course">{{ session.courseName }}</div>
                }
                <div class="attendance-page__card-class">{{ session.className }}</div>
              </div>
              <div class="attendance-page__card-date">{{ formatEventDate(session.eventDate) }}</div>
            </div>
            <div class="attendance-page__card-meta">
              {{ session.startTime ?? '--:--' }}–{{ session.endTime ?? '--:--' }}
              @if (session.campusName) { · {{ session.campusName }} }
            </div>
          </div>
          <div class="attendance-page__card-stats">
            @if (isTaken(session)) {
              <span class="attendance-page__stat attendance-page__stat--present">✓ {{ session.presentCount }}</span>
              <span class="attendance-page__stat attendance-page__stat--leave">🏳 {{ session.onLeaveCount }}</span>
              <span class="attendance-page__stat attendance-page__stat--absent">✗ {{ session.absentCount }}</span>
            } @else {
              <span class="attendance-page__untaken">◌ {{ session.enrolledCount }} 人未點名</span>
            }
          </div>
          <p-button
            [label]="isTaken(session) ? '修改點名' : '點名'"
            [outlined]="!isAdminLed() || isTaken(session)"
            [severity]="isAdminLed() && !isTaken(session) ? 'primary' : 'secondary'"
            size="small"
            (onClick)="openPanel(session)"
          />
        </div>
      }
    }
  </div>
</div>
```

- [ ] **Step 2：commit**

```bash
git add apps/web/src/app/features/admin/pages/attendance/attendance.page.html
git commit -m "feat(admin): redesign attendance toolbar and session card template"
```

---

## Task 5：AttendancePage — SCSS 更新

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/attendance/attendance.page.scss`

- [ ] **Step 1：完整替換 SCSS**

```scss
.attendance-page {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--zinc-900);
    margin: 0;
  }

  &__toolbar {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    flex-wrap: wrap;
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  // ── Card ─────────────────────────────────────────────────────
  &__card {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
    background: #fff;
    border: 1px solid var(--zinc-200);
    border-radius: 8px;
  }

  &__card-info {
    flex: 1;
    min-width: 0;
  }

  &__card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
  }

  &__card-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__card-course {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--zinc-500);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__card-class {
    font-weight: 600;
    color: var(--zinc-900);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__card-date {
    font-size: 0.75rem;
    color: var(--zinc-400);
    white-space: nowrap;
    flex-shrink: 0;
  }

  &__card-meta {
    font-size: 0.8rem;
    color: var(--zinc-500);
    margin-top: var(--space-1);
  }

  &__card-stats {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }

  &__stat {
    font-size: 0.85rem;
    font-weight: 500;

    &--present { color: var(--green-600); }
    &--leave   { color: var(--yellow-600); }
    &--absent  { color: var(--red-600); }
  }

  &__untaken {
    font-size: 0.85rem;
    color: var(--zinc-400);
  }

  // ── Student multiselect option ────────────────────────────────
  &__student-option {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__student-option-name {
    font-weight: 500;
    color: var(--zinc-900);
  }

  &__student-option-meta {
    font-size: 0.75rem;
    color: var(--zinc-500);
  }

  // ── Skeleton / Empty ─────────────────────────────────────────
  &__skeleton {
    height: 80px;
    border-radius: 8px;
    background: var(--zinc-100);
    animation: pulse 1.5s ease-in-out infinite;
  }

  &__empty {
    text-align: center;
    color: var(--zinc-400);
    padding: var(--space-8) 0;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}
```

- [ ] **Step 2：commit**

```bash
git add apps/web/src/app/features/admin/pages/attendance/attendance.page.scss
git commit -m "feat(admin): update attendance page card and toolbar styles"
```

---

## Self-Review Checklist

- [x] API schema 加了 `courseName` ✓
- [x] Frontend interface 同步 ✓
- [x] `filteredSessions` 用 computed signal，不直接改 `sessions` ✓
- [x] effect 加了 `allowSignalWrites: true` ✓
- [x] 分校切換時呼叫 `loadSessions()`，不是 client-side filter ✓
- [x] 學生清空時 `studentEnrolledClassIds` 清空 → `filteredSessions` 回傳全部 ✓
- [x] 日期未選齊時不打 API ✓
- [x] 卡片 `filteredSessions()` 取代原本 `sessions()` ✓
- [x] `gradeLabel` 與 `formatEventDate` helper 都有定義 ✓
