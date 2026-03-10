# Unified Session Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 將行事曆升級為統一的 Session 管理介面，新增清單視圖 + 批次操作，取代 Session List Dialog 和 Batch Assign Wizard。

**Architecture:** 行事曆頁面新增清單視圖（`app-responsive-table`），共用篩選器和 sessions signal。批次操作改用 session-level API（新建端點接受 `sessionIds[]`），取代 class-scoped 端點。Schedule 表移除 `teacher_id`，簡化指派流程。

**Tech Stack:** Angular 21 + PrimeNG 21 + Signals, Hono API, Supabase PostgreSQL, `app-responsive-table` directive-first component

---

## Phase 2: Database

### Task 1: Migration — Schedule 移除 teacher_id

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_drop_schedule_teacher_id.sql`

**Step 1: 建立 migration 檔案**

```sql
-- Drop the NOT NULL + FK constraint on schedules.teacher_id
-- We keep the column for now (backward compat) but allow NULL
ALTER TABLE public.schedules
  ALTER COLUMN teacher_id DROP NOT NULL;

-- Drop the FK constraint referencing staff
ALTER TABLE public.schedules
  DROP CONSTRAINT IF EXISTS schedules_teacher_id_fkey;

-- Make teacher_id nullable with FK (no RESTRICT, just SET NULL)
ALTER TABLE public.schedules
  ADD CONSTRAINT schedules_teacher_id_fkey
    FOREIGN KEY (teacher_id) REFERENCES public.staff(id) ON DELETE SET NULL;

-- Comment to mark deprecated
COMMENT ON COLUMN public.schedules.teacher_id IS 'DEPRECATED: 老師指派改由 batch-assign 處理，此欄位將在未來版本移除';
```

**Step 2: 驗證 migration**

Run: `supabase db reset`
Expected: 無錯誤，schedules.teacher_id 允許 NULL

**Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): deprecate schedule.teacher_id, allow NULL"
```

---

## Phase 3: API

### Task 2: 新增 session-level 批次 API 端點

**Files:**
- Modify: `apps/api/src/routes/sessions.ts`

目前批次操作全部在 `/api/classes/:id/sessions/batch-*`（class-scoped）。統一行事曆的清單視圖需要跨班操作，所以新增 session-level 端點。

**Step 1: 新增 `PATCH /api/sessions/batch-assign-teacher`**

```typescript
// Input: { sessionIds: string[], teacherId: string, dryRun?: boolean }
// Logic:
// 1. 查出所有 sessionIds 的 session（需 scheduled status + unassigned 或 includeAssigned）
// 2. 對每個 session 檢查 teacher 衝突（同老師同日同時段）
// 3. dryRun=true → 回傳 preview；false → 更新 teacher_id + assignment_status
// Output: BatchAssignTeacherResult
```

使用現有 `batch-assign-planner.ts` domain 邏輯，但輸入改為 `sessionIds[]` 而非日期範圍。

**Step 2: 新增 `PATCH /api/sessions/batch-update-time`**

```typescript
// Input: { sessionIds: string[], startTime: string, endTime: string, dryRun?: boolean }
// Logic: 複用現有 classes.ts 的 batch-update-time 邏輯
// Output: BatchSessionActionResult
```

**Step 3: 新增 `PATCH /api/sessions/batch-cancel`**

```typescript
// Input: { sessionIds: string[], reason?: string, dryRun?: boolean }
// Output: BatchSessionActionResult
```

**Step 4: 新增 `PATCH /api/sessions/batch-uncancel`**

```typescript
// Input: { sessionIds: string[], dryRun?: boolean }
// Output: BatchSessionActionResult
```

**Step 5: 驗證 API**

Run: `supabase db reset && cd apps/api && npx tsx src/index.ts`（或 dev server）
測試每個端點的 dryRun + apply flow

**Step 6: Commit**

```bash
git add apps/api/src/routes/sessions.ts
git commit -m "feat(api): add session-level batch endpoints for unified calendar"
```

---

### Task 3: 修復 session-operation-guard + substitute 路由

**Files:**
- Modify: `apps/api/src/domain/session-assignment/session-operation-guard.ts`
- Modify: `apps/api/src/routes/sessions.ts`

**Step 1: 補齊 `assertSessionOperable` 的 status 檢查**

```typescript
export function assertSessionOperable(session: SessionOperationState): void {
  if (session.assignmentStatus === 'unassigned') {
    throw new SessionUnassignedError();
  }
  if (session.status === 'cancelled') {
    throw new SessionCancelledError();
  }
  if (session.status === 'completed') {
    throw new SessionCompletedError();
  }
}
```

新增 `SessionCancelledError` 和 `SessionCompletedError` 到 types 檔案。

**Step 2: substitute 路由同步更新 `assignment_status`**

在 `sessions.ts` 的 substitute 路由中，更新欄位加入 `assignment_status: 'assigned'`。

**Step 3: 驗證**

Run: 測試對 cancelled session 執行 substitute → 應回傳 400
Run: 測試對 unassigned session 執行 substitute → 應回傳 400

**Step 4: Commit**

```bash
git add apps/api/src/domain/ apps/api/src/routes/sessions.ts
git commit -m "fix(api): complete session-operation-guard status checks + sync assignment_status on substitute"
```

---

## Phase 4: Frontend Service

### Task 4: SessionsService 新增批次方法

**Files:**
- Modify: `apps/web/src/app/core/sessions.service.ts`

**Step 1: 新增批次操作 interfaces + methods**

```typescript
// 在 SessionsService 加入：

// --- Batch types ---
export interface BatchAssignInput {
  sessionIds: string[];
  teacherId: string;
  dryRun?: boolean;
}

export interface BatchAssignResult {
  updated: number;
  skippedConflicts: number;
  skippedNotEligible: number;
  conflicts: Array<{
    sessionId: string;
    sessionDate: string;
    startTime: string;
    endTime: string;
    conflictWithSessionId: string;
  }>;
  dryRun: boolean;
}

export interface BatchTimeInput {
  sessionIds: string[];
  startTime: string;
  endTime: string;
  dryRun?: boolean;
}

export interface BatchCancelInput {
  sessionIds: string[];
  reason?: string;
  dryRun?: boolean;
}

export interface BatchActionResult {
  updated: number;
  skipped: number;
  processableIds: string[];
  conflicts: Array<{
    sessionId: string;
    sessionDate: string;
    reason: string;
    detail: string;
  }>;
  dryRun: boolean;
}

// --- Methods ---
batchAssignTeacher(input: BatchAssignInput): Observable<BatchAssignResult> {
  return this.http.patch<BatchAssignResult>(`${this.endpoint}/batch-assign-teacher`, input);
}

batchUpdateTime(input: BatchTimeInput): Observable<BatchActionResult> {
  return this.http.patch<BatchActionResult>(`${this.endpoint}/batch-update-time`, input);
}

batchCancel(input: BatchCancelInput): Observable<BatchActionResult> {
  return this.http.patch<BatchActionResult>(`${this.endpoint}/batch-cancel`, input);
}

batchUncancel(input: { sessionIds: string[]; dryRun?: boolean }): Observable<BatchActionResult> {
  return this.http.patch<BatchActionResult>(`${this.endpoint}/batch-uncancel`, input);
}
```

**Step 2: 驗證**

Run: `npx ng build`
Expected: Build 成功

**Step 3: Commit**

```bash
git add apps/web/src/app/core/sessions.service.ts
git commit -m "feat(service): add session-level batch methods to SessionsService"
```

---

## Phase 5: Frontend UI

### Task 5: 行事曆 — 新增視圖切換基礎設施

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.html`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.scss`

**Step 1: 新增 viewMode signal**

在 `calendar.page.ts` 加入：

```typescript
protected readonly viewMode = signal<'calendar' | 'list'>('calendar');

protected toggleViewMode(mode: 'calendar' | 'list'): void {
  this.viewMode.set(mode);
}
```

**Step 2: 新增 classId 篩選 signal**

```typescript
// 新增 classes signal + 篩選
protected readonly classes = signal<Array<{ id: string; name: string; courseId: string; campusId: string }>>([]);
protected readonly selectedClassId = signal<string | null>(null);

protected readonly availableClasses = computed(() => {
  const campusId = this.selectedCampusId();
  const courseId = this.selectedCourseId();
  if (!campusId) return [];
  let filtered = this.classes().filter(c => c.campusId === campusId);
  if (courseId) filtered = filtered.filter(c => c.courseId === courseId);
  return filtered;
});

protected onClassChange(classId: string | null): void {
  this.selectedClassId.set(classId);
  this.loadSessions();
}
```

在 `loadFilters()` 加入 classes 載入，在 `loadSessions()` 傳入 `classId`。

**Step 3: Template — 加入視圖切換 + 班級篩選器**

在篩選器列的右側新增 toggle buttons：

```html
<!-- 視圖切換 -->
<div class="cal__view-toggle">
  <p-button
    [text]="viewMode() !== 'calendar'"
    icon="pi pi-calendar"
    severity="secondary"
    [rounded]="true"
    size="small"
    pTooltip="行事曆視圖"
    tooltipPosition="top"
    (onClick)="toggleViewMode('calendar')"
  />
  <p-button
    [text]="viewMode() !== 'list'"
    icon="pi pi-list"
    severity="secondary"
    [rounded]="true"
    size="small"
    pTooltip="清單視圖"
    tooltipPosition="top"
    (onClick)="toggleViewMode('list')"
  />
</div>
```

篩選器中新增班級 p-select（在老師之前）。

**Step 4: 分校必選 — 移除 showClear + 自動選定**

分校 `p-select` 移除 `[showClear]="true"`。
在 `loadFilters()` 的 campuses 回傳後：

```typescript
this.campusesService.list({ isActive: true, pageSize: 100 }).subscribe({
  next: (res) => {
    this.campuses.set(res.data);
    // 自動選定第一個分校
    if (res.data.length > 0 && !this.selectedCampusId()) {
      this.selectedCampusId.set(res.data[0].id);
      this.loadSessions();
    }
  },
});
```

**Step 5: 情境式 subtitle 標籤（已部分實作）**

確認 `weekLabel()` 已包含「本週 · ...」邏輯（已在 L142）。
`dayLabel()` 改為：

```typescript
protected readonly dayLabel = computed(() => {
  const date = this.currentDate();
  const dateStr = format(date, 'M/d (EEE)', { locale: zhTW });
  return isToday(date) ? `今天 · ${dateStr}` : dateStr;
});
```

**Step 6: SCSS — 視圖切換 + 班級篩選樣式**

```scss
&__view-toggle {
  display: flex;
  gap: var(--space-1);
  margin-left: auto;
}
```

**Step 7: 驗證**

Run: `npx ng build`
Expected: Build 成功。開啟瀏覽器確認視圖切換按鈕顯示、分校自動選定、班級篩選器出現。

**Step 8: Commit**

```bash
git add apps/web/src/app/features/admin/pages/calendar/
git commit -m "feat(calendar): add view toggle, class filter, required campus, contextual labels"
```

---

### Task 6: 清單視圖 — responsive-table 實作

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.html`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.scss`

**Step 1: 新增清單視圖狀態 signals**

在 `calendar.page.ts` 加入：

```typescript
import { ResponsiveTableComponent } from '@shared/components/responsive-table/responsive-table.component';
import { RtColDefDirective } from '@shared/components/responsive-table/rt-col-def.directive';
import { RtColCellDirective } from '@shared/components/responsive-table/rt-col-cell.directive';
import { RtRowDirective } from '@shared/components/responsive-table/rt-row.directive';
import type { ResponsiveTablePaginationConfig, ResponsiveTablePageEvent } from '@shared/components/responsive-table/responsive-table.models';

// 清單視圖 pagination
protected readonly listFirst = signal(0);
protected readonly listRows = signal(20);

protected readonly listPagination = computed<ResponsiveTablePaginationConfig>(() => ({
  first: this.listFirst(),
  rows: this.listRows(),
  totalRecords: this.sessions().length,
  rowsPerPageOptions: [20, 50, 100],
}));

protected readonly paginatedSessions = computed(() => {
  const all = this.sessions();
  const first = this.listFirst();
  const rows = this.listRows();
  return all.slice(first, first + rows);
});

protected onListPage(event: ResponsiveTablePageEvent): void {
  this.listFirst.set(event.first);
  this.listRows.set(event.rows);
}

// checkbox 選取
protected readonly selectedIds = signal<Set<string>>(new Set());
protected readonly selectedCount = computed(() => this.selectedIds().size);
protected readonly allPageSelected = computed(() => {
  const page = this.paginatedSessions();
  if (page.length === 0) return false;
  const ids = this.selectedIds();
  return page.every(s => ids.has(s.id));
});

protected toggleSelectAll(): void {
  const page = this.paginatedSessions();
  const ids = new Set(this.selectedIds());
  if (this.allPageSelected()) {
    page.forEach(s => ids.delete(s.id));
  } else {
    page.forEach(s => ids.add(s.id));
  }
  this.selectedIds.set(ids);
}

protected toggleSelect(sessionId: string): void {
  const ids = new Set(this.selectedIds());
  if (ids.has(sessionId)) ids.delete(sessionId);
  else ids.add(sessionId);
  this.selectedIds.set(ids);
}

protected isSelected(sessionId: string): boolean {
  return this.selectedIds().has(sessionId);
}

protected clearSelection(): void {
  this.selectedIds.set(new Set());
}
```

在 imports 加入 `ResponsiveTableComponent, RtColDefDirective, RtColCellDirective, RtRowDirective, CheckboxModule`。

**Step 2: Template — 清單視圖 HTML**

在 `calendar.page.html` 中，`@if (viewMode() === 'calendar')` 包住現有行事曆，新增 `@else` 區塊：

```html
@if (viewMode() === 'list') {
  <div class="cal__list">
    <app-responsive-table
      [headTemplate]="listHead"
      [bodyTemplate]="listBody"
      [pagination]="listPagination()"
      (page)="onListPage($event)"
    />

    <ng-template #listHead>
      <tr>
        <th style="width: 48px; text-align: center">
          <p-checkbox
            [binary]="true"
            [ngModel]="allPageSelected()"
            (ngModelChange)="toggleSelectAll()"
          />
        </th>
        <th appRtColDef="date" appRtColDefLabel="日期"
            [appRtColDefMinWidth]="100" [appRtColDefPriority]="1">
          日期
        </th>
        <th appRtColDef="time" appRtColDefLabel="時間"
            [appRtColDefMinWidth]="120" [appRtColDefPriority]="2">
          時間
        </th>
        <th appRtColDef="class" appRtColDefLabel="班級"
            [appRtColDefMinWidth]="140" [appRtColDefPriority]="3"
            [appRtColDefCollapsible]="true">
          班級
        </th>
        <th appRtColDef="teacher" appRtColDefLabel="老師"
            [appRtColDefMinWidth]="120" [appRtColDefPriority]="4"
            [appRtColDefCollapsible]="true">
          老師
        </th>
        <th appRtColDef="status" appRtColDefLabel="狀態"
            [appRtColDefMinWidth]="80" [appRtColDefPriority]="5"
            [appRtColDefCollapsible]="true">
          狀態
        </th>
        <th style="width: 48px"></th>
      </tr>
    </ng-template>

    <ng-template #listBody let-state="state">
      @for (session of paginatedSessions(); track session.id) {
        <tr appRtRow [appRtRow]="session" [appRtRowId]="session.id">
          <td style="text-align: center">
            <p-checkbox
              [binary]="true"
              [ngModel]="isSelected(session.id)"
              (ngModelChange)="toggleSelect(session.id)"
            />
          </td>
          <td appRtColCell="date">
            {{ session.sessionDate | date: 'MM/dd' }}
            ({{ getDayLabel(session.sessionDate) }})
          </td>
          <td appRtColCell="time">
            {{ session.startTime }}–{{ session.endTime }}
          </td>
          <td appRtColCell="class">{{ session.className }}</td>
          <td appRtColCell="teacher">
            @if (session.assignmentStatus === 'unassigned') {
              <p-tag severity="warn" value="未指派" />
            } @else {
              {{ session.teacherName }}
            }
          </td>
          <td appRtColCell="status">
            <p-tag
              [severity]="sessionStatusSeverity(session)"
              [value]="sessionStatusLabel(session)"
            />
          </td>
          <td>
            <button pButton
              icon="pi pi-ellipsis-v"
              [text]="true"
              severity="secondary"
              size="small"
              (click)="openSessionActions($event, session)"
            ></button>
          </td>
        </tr>
      }
      @empty {
        <tr>
          <td [attr.colspan]="8" style="text-align: center; padding: 2rem; color: var(--zinc-400)">
            此期間沒有課堂
          </td>
        </tr>
      }
    </ng-template>
  </div>
}
```

**Step 3: 新增 helper methods**

```typescript
// 星期中文 label
protected getDayLabel(dateStr: string): string {
  const DAY_LABELS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  return DAY_LABELS[new Date(dateStr).getDay()];
}

// 單堂操作 context menu
protected openSessionActions(event: Event, session: Session): void {
  // 用 PrimeNG Menu 或 Popover 實作
  // 選項：調課、代課、停課、取消停課、指派老師（依狀態條件顯示）
}
```

**Step 4: SCSS — 清單視圖樣式**

```scss
&__list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-3);
}
```

**Step 5: 驗證**

Run: `npx ng build`
Expected: Build 成功。切換到清單視圖顯示 responsive-table。

**Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/calendar/
git commit -m "feat(calendar): implement list view with responsive-table and selection"
```

---

### Task 7: 清單視圖 — 單堂操作 Context Menu

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.html`

**Step 1: 新增 context menu signal + model**

使用 PrimeNG `Menu` component：

```typescript
import { MenuModule } from 'primeng/menu';
import type { MenuItem } from 'primeng/api';

protected readonly contextSession = signal<Session | null>(null);
protected readonly contextMenuItems = computed<MenuItem[]>(() => {
  const s = this.contextSession();
  if (!s) return [];
  const items: MenuItem[] = [];

  if (s.status === 'scheduled') {
    items.push({
      label: '調課',
      icon: 'pi pi-calendar-clock',
      command: () => this.openReschedule(s),
    });
  }
  if (s.status === 'scheduled' && s.assignmentStatus === 'assigned') {
    items.push({
      label: '代課',
      icon: 'pi pi-user-edit',
      command: () => this.openSubstitute(s),
    });
  }
  if (s.assignmentStatus === 'unassigned' && s.status === 'scheduled') {
    items.push({
      label: '指派老師',
      icon: 'pi pi-user-plus',
      command: () => this.openAssignSingle(s),
    });
  }
  if (s.status === 'scheduled') {
    items.push({
      label: '停課',
      icon: 'pi pi-ban',
      command: () => this.cancelSingle(s),
    });
  }
  if (s.status === 'cancelled') {
    items.push({
      label: '取消停課',
      icon: 'pi pi-replay',
      command: () => this.uncancelSingle(s),
    });
  }
  return items;
});
```

**Step 2: Template — 加入 `p-menu`**

```html
<p-menu #sessionMenu [model]="contextMenuItems()" [popup]="true" appendTo="body" />
```

在 ellipsis button 的 click 改為：

```html
(click)="contextSession.set(session); sessionMenu.toggle($event)"
```

**Step 3: 實作單堂操作 handlers**

```typescript
protected openReschedule(session: Session): void {
  // 復用現有 SessionRescheduleDialogComponent
  const ref = this.dialogService.open(SessionRescheduleDialogComponent, { ... });
  ref?.onClose.subscribe(result => { if (result === 'refresh') this.loadSessions(); });
}

protected openSubstitute(session: Session): void {
  // 復用現有 SessionSubstituteDialogComponent
}

protected cancelSingle(session: Session): void {
  // 復用現有 SessionCancelDialogComponent 或 SessionsService.cancel()
}

protected uncancelSingle(session: Session): void {
  // 呼叫 batchUncancel with single sessionId
  this.sessionsService.batchUncancel({ sessionIds: [session.id] }).subscribe({
    next: () => { this.loadSessions(); this.messageService.add({ ... }); },
  });
}

protected openAssignSingle(session: Session): void {
  // 簡單 dialog：選老師 → 確認
  // 呼叫 batchAssignTeacher with single sessionId
}
```

**Step 4: 驗證**

Run: `npx ng build`
Expected: Build 成功。清單視圖每行的 `...` 按鈕可開啟 context menu。

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/calendar/
git commit -m "feat(calendar): add single-session context menu in list view"
```

---

### Task 8: 清單視圖 — 批次操作 Bar + Panels

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.html`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.scss`

**Step 1: 新增批次操作狀態**

```typescript
protected readonly batchMode = signal<'assign' | 'time' | 'cancel' | 'uncancel' | null>(null);
protected readonly batchTeacherId = signal<string | null>(null);
protected readonly batchStartTime = signal('09:00');
protected readonly batchEndTime = signal('11:00');
protected readonly batchPreview = signal<BatchAssignResult | BatchActionResult | null>(null);
protected readonly batchLoading = signal(false);

protected openBatchPanel(mode: 'assign' | 'time' | 'cancel' | 'uncancel'): void {
  this.batchMode.set(mode);
  this.batchPreview.set(null);
}

protected closeBatchPanel(): void {
  this.batchMode.set(null);
  this.batchPreview.set(null);
  this.batchTeacherId.set(null);
}
```

**Step 2: 批次預覽 (dryRun)**

```typescript
protected runBatchPreview(): void {
  const ids = [...this.selectedIds()];
  if (ids.length === 0) return;
  this.batchLoading.set(true);

  const mode = this.batchMode();
  let obs: Observable<any>;

  switch (mode) {
    case 'assign':
      obs = this.sessionsService.batchAssignTeacher({
        sessionIds: ids,
        teacherId: this.batchTeacherId()!,
        dryRun: true,
      });
      break;
    case 'time':
      obs = this.sessionsService.batchUpdateTime({
        sessionIds: ids,
        startTime: this.batchStartTime(),
        endTime: this.batchEndTime(),
        dryRun: true,
      });
      break;
    case 'cancel':
      obs = this.sessionsService.batchCancel({ sessionIds: ids, dryRun: true });
      break;
    case 'uncancel':
      obs = this.sessionsService.batchUncancel({ sessionIds: ids, dryRun: true });
      break;
  }

  obs!.subscribe({
    next: (result) => { this.batchPreview.set(result); this.batchLoading.set(false); },
    error: () => { this.batchLoading.set(false); /* toast error */ },
  });
}

protected applyBatch(): void {
  // 同 runBatchPreview 但 dryRun: false
  // 成功後：closeBatchPanel(), clearSelection(), loadSessions(), toast
}
```

**Step 3: Template — 批次 bar + panels**

```html
<!-- 批次操作 bar（選取 > 0 時顯示） -->
@if (selectedCount() > 0 && viewMode() === 'list') {
  <div class="cal__batch-bar">
    <span class="cal__batch-bar__count">已選 {{ selectedCount() }} 堂</span>
    <div class="cal__batch-bar__actions">
      <p-button label="指派老師" icon="pi pi-user-plus" size="small" severity="info"
                (onClick)="openBatchPanel('assign')" />
      <p-button label="改時間" icon="pi pi-clock" size="small" severity="secondary"
                (onClick)="openBatchPanel('time')" />
      <p-button label="停課" icon="pi pi-ban" size="small" severity="warn"
                (onClick)="openBatchPanel('cancel')" />
      <p-button label="取消停課" icon="pi pi-replay" size="small" severity="secondary"
                (onClick)="openBatchPanel('uncancel')" />
      <p-button label="取消選取" [text]="true" size="small"
                (onClick)="clearSelection()" />
    </div>
  </div>

  <!-- 批次 panel -->
  @if (batchMode()) {
    <div class="cal__batch-panel">
      @switch (batchMode()) {
        @case ('assign') {
          <h4>指派老師給 {{ selectedCount() }} 堂課</h4>
          <p-select
            [options]="availableTeachers()"
            optionLabel="name"
            optionValue="id"
            placeholder="選擇老師"
            [filter]="true"
            [ngModel]="batchTeacherId()"
            (ngModelChange)="batchTeacherId.set($event)"
            appendTo="body"
          />
        }
        @case ('time') {
          <h4>修改 {{ selectedCount() }} 堂課的上課時間</h4>
          <!-- time inputs -->
        }
        @case ('cancel') {
          <h4>停課 {{ selectedCount() }} 堂</h4>
        }
        @case ('uncancel') {
          <h4>取消停課 {{ selectedCount() }} 堂</h4>
        }
      }

      <!-- Preview result -->
      @if (batchPreview()) {
        <div class="cal__batch-preview">
          <!-- 顯示可操作數/衝突數 -->
        </div>
      }

      <div class="cal__batch-panel__footer">
        <p-button label="取消" [text]="true" (onClick)="closeBatchPanel()" />
        @if (!batchPreview()) {
          <p-button label="預覽" (onClick)="runBatchPreview()"
                    [disabled]="batchMode() === 'assign' && !batchTeacherId()"
                    [loading]="batchLoading()" />
        } @else {
          <p-button [label]="'確認 (' + getProcessableCount() + ' 堂)'"
                    (onClick)="applyBatch()" [loading]="batchLoading()" />
        }
      </div>
    </div>
  }
}
```

**Step 4: SCSS — batch bar + panel 樣式**

```scss
&__batch-bar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--zinc-900);
  color: #fff;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;

  &__count {
    font-weight: 600;
    white-space: nowrap;
  }

  &__actions {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
}

&__batch-panel {
  background: var(--zinc-50);
  border: 1px solid var(--zinc-200);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
  margin: var(--space-2) var(--space-3);

  h4 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
}
```

**Step 5: 驗證**

Run: `npx ng build`
Expected: Build 成功。選取課堂後底部出現 batch bar，點操作展開 panel。

**Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/calendar/
git commit -m "feat(calendar): implement batch operation bar and inline panels in list view"
```

---

### Task 9: 產生課堂後的引導流程

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/classes/generate-sessions-dialog/generate-sessions-dialog.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/classes/generate-sessions-dialog/generate-sessions-dialog.component.html`

**Step 1: 產生成功後顯示結果摘要 + 引導按鈕**

在 generate sessions dialog 的成功回傳後，不直接關閉，改為顯示結果面板：

```typescript
protected readonly generationResult = signal<GenerateSessionsResult | null>(null);
protected readonly generationDone = signal(false);

// 在 onGenerate() 成功後：
this.generationResult.set(result);
this.generationDone.set(true);

protected goToCalendarList(): void {
  // 關閉 dialog，帶入篩選參數導航到行事曆清單視圖
  this.ref.close({
    action: 'navigate-calendar',
    classId: this.classId,
    from: this.fromDate(),
    to: this.toDate(),
  });
}
```

**Step 2: Template — 結果面板**

```html
@if (generationDone()) {
  <div class="gen__result">
    <div class="gen__result__summary">
      <i class="pi pi-check-circle" style="color: var(--green-500); font-size: 1.5rem"></i>
      <div>
        <p><strong>已建立 {{ generationResult()!.createdUnassigned + generationResult()!.createdAssigned }} 堂課</strong></p>
        @if (generationResult()!.createdUnassigned > 0) {
          <p class="text-muted">其中 {{ generationResult()!.createdUnassigned }} 堂待指派老師</p>
        }
      </div>
    </div>
    <div class="gen__result__actions">
      <p-button label="稍後指派" [text]="true" (onClick)="ref.close('refresh')" />
      @if (generationResult()!.createdUnassigned > 0) {
        <p-button label="前往指派老師" icon="pi pi-arrow-right" iconPos="right"
                  (onClick)="goToCalendarList()" />
      }
    </div>
  </div>
} @else {
  <!-- 現有的 generate form -->
}
```

**Step 3: Classes page 處理導航**

在 classes page 中，當 generate dialog 返回 `{ action: 'navigate-calendar' }` 時：

```typescript
import { Router } from '@angular/router';

// 在 dialog close handler：
if (result?.action === 'navigate-calendar') {
  this.router.navigate(['/admin/calendar'], {
    queryParams: {
      view: 'list',
      classId: result.classId,
      from: result.from,
      to: result.to,
      assignmentStatus: 'unassigned',
    },
  });
}
```

**Step 4: Calendar page 讀取 queryParams**

在 `calendar.page.ts` 的 `ngOnInit` 中讀取 route queryParams，初始化對應的篩選器和視圖模式。

**Step 5: 驗證**

Run: `npx ng build`
Expected: 產生課堂後顯示結果 → 點「前往指派」→ 跳到行事曆清單視圖。

**Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/classes/ apps/web/src/app/features/admin/pages/calendar/
git commit -m "feat: guide user to calendar list view after generating sessions"
```

---

### Task 10: 修復已知問題

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.scss`

**Step 1: Datepicker click-outside-to-close**

```typescript
import { HostListener } from '@angular/core';

// 在 class 中加入 elementRef
private readonly elementRef = inject(ElementRef);

@HostListener('document:click', ['$event'])
onDocumentClick(event: MouseEvent): void {
  if (this.showDatePicker()) {
    const target = event.target as HTMLElement;
    const dpPopup = this.elementRef.nativeElement.querySelector('.cal__datepicker-popup');
    const dpButton = this.elementRef.nativeElement.querySelector('.cal__subtitle');
    if (dpPopup && !dpPopup.contains(target) && dpButton && !dpButton.contains(target)) {
      this.showDatePicker.set(false);
    }
  }
}
```

**Step 2: 產生課堂上限提醒**

在 generate-sessions-dialog 的預覽回傳後，如果 `previews.length > 200`，顯示警告 Message。

**Step 3: 驗證**

Run: `npx ng build`

**Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/calendar/ apps/web/src/app/features/admin/pages/classes/
git commit -m "fix(calendar): datepicker click-outside close + session generation limit warning"
```

---

### Task 11: 清理廢棄元件

**Files:**
- Delete: `apps/web/src/app/features/admin/pages/classes/batch-assign-wizard/` (整個目錄)
- Delete: `apps/web/src/app/features/admin/pages/classes/session-list-dialog/` (整個目錄)
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.ts` (移除相關 imports + methods)
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.html` (移除相關 template)
- Modify: `apps/web/src/app/features/admin/pages/classes/class-form-dialog/class-form-dialog.component.ts` (移除 schedule teacher_id)
- Modify: `apps/web/src/app/features/admin/pages/classes/class-form-dialog/class-form-dialog.component.html` (移除老師選擇欄)

**Step 1: 移除 BatchAssignWizardComponent 目錄**

```bash
rm -rf apps/web/src/app/features/admin/pages/classes/batch-assign-wizard/
```

**Step 2: 移除 SessionListDialogComponent 目錄**

```bash
rm -rf apps/web/src/app/features/admin/pages/classes/session-list-dialog/
```

**Step 3: Classes page 移除相關引用**

從 `classes.page.ts` 移除：
- `SessionListDialogComponent` import + `openSessionListDialog()` method
- `BatchAssignWizardComponent` import + `openBatchAssignWizard()` method
- Action menu 中對應的 menu items

**Step 4: ClassFormDialog 移除 schedule 老師欄位**

從 `CreateScheduleInput` 和 template 中移除 `teacherId` 選擇。Schedule 只保留 weekday + startTime + endTime + effectiveTo。

**Step 5: 驗證**

Run: `npx ng build`
Expected: Build 成功，無 unused import 錯誤。

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove BatchAssignWizard, SessionListDialog, schedule teacher_id from UI"
```

---

### Task 12: Classes 頁面 — 替代入口

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.ts`
- Modify: `apps/web/src/app/features/admin/pages/classes/classes.page.html`

**Step 1: 替換「管理課堂」入口**

在 class card 的 action menu 中，原本的「管理課堂」（開啟 Session List Dialog）改為「在行事曆中查看」：

```typescript
{
  label: '在行事曆中查看',
  icon: 'pi pi-calendar',
  command: () => this.router.navigate(['/admin/calendar'], {
    queryParams: { view: 'list', classId: cls.id },
  }),
}
```

**Step 2: Intervention 警示中的「N 堂未指派」改為可點擊**

```html
@if (cls.upcomingUnassignedCount && cls.upcomingUnassignedCount > 0) {
  <a class="classes__intervention-link"
     [routerLink]="['/admin/calendar']"
     [queryParams]="{ view: 'list', classId: cls.id, assignmentStatus: 'unassigned' }">
    {{ cls.upcomingUnassignedCount }} 堂未指派老師
  </a>
}
```

**Step 3: 驗證**

Run: `npx ng build`

**Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/classes/
git commit -m "feat(classes): replace session list dialog with calendar list view navigation"
```

---

## Phase 6: 端到端驗證

### Task 13: 手動 E2E 驗證

**驗證清單：**

1. **分校必選**：開啟行事曆 → 分校自動選定第一個 → 無法清除
2. **視圖切換**：行事曆 ↔ 清單 → 篩選器狀態保持 → sessions 不重新載入
3. **清單勾選**：勾選多個 session → batch bar 出現 → 顯示正確計數
4. **批次指派老師**：勾選 → 指派老師 → 預覽 → 確認 → sessions 更新
5. **批次改時間**：勾選 → 改時間 → 預覽（含衝突）→ 確認
6. **批次停課/取消停課**：同上流程
7. **單堂操作**：清單中 `...` → 調課/代課/停課/指派 → dialog → 確認
8. **產生課堂引導**：Classes → 產生課堂 → 結果 → 前往指派 → 跳到清單視圖
9. **情境式標籤**：本週顯示「本週 · ...」、今天顯示「今天 · ...」
10. **手機版**：清單視圖欄位折疊、batch bar 不擋住內容
11. **Datepicker click-outside**：點外部關閉

**Step 1: 啟動環境**

```bash
supabase start && npx ng serve
```

**Step 2: 逐項驗證上述清單**

**Step 3: 修復發現的問題**

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify unified session management E2E"
```

---

## 任務依賴圖

```
Task 1 (DB)
    ↓
Task 2 (API batch) ← Task 3 (API fix) [可平行]
    ↓
Task 4 (Service)
    ↓
Task 5 (View toggle + filters)
    ↓
Task 6 (List view) → Task 7 (Context menu) → Task 8 (Batch panels) [循序]
    ↓
Task 9 (Generate → navigate)
    ↓
Task 10 (Bug fixes)
    ↓
Task 11 (Cleanup) → Task 12 (Classes page) [循序]
    ↓
Task 13 (E2E)
```

## Codex 委派建議

| Task | 建議執行者 | 原因 |
|------|-----------|------|
| 1 | Codex | 明確的 SQL migration |
| 2 | Codex | 規格明確的 CRUD API |
| 3 | Codex | 規格明確的 bug fix |
| 4 | Codex | 規格明確的 service methods |
| 5-8 | Claude | UI/UX 設計判斷 |
| 9 | Claude | 跨頁面互動設計 |
| 10 | Claude/Codex | 混合 |
| 11-12 | Claude | 需要判斷哪些引用要移除 |
| 13 | 手動 | 人工測試 |
