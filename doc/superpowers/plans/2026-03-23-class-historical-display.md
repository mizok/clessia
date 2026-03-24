# Class Historical Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在課程管理頁顯示班級日期範圍、預設隱藏歷史班級、提供 toggle + 日期範圍篩選來查看歷史班級，並對歷史班級套用唯讀限制。

**Architecture:** API 加入 `includeHistorical` + `historicalFrom/To` query params；前端 `classes.service.ts` 同步擴充 `ClassQueryParams`；`courses.page.ts` 新增 signals 管理歷史班級狀態，以 lazy-load 方式在 toggle ON 時才 fetch；班級 row 顯示日期副標題，歷史班級套用視覺降調與操作隱藏。

**Tech Stack:** Angular 21 Signals, PrimeNG 21 (`p-datepicker`, `p-toggleswitch`), Hono + Zod OpenAPI, date-fns, TypeScript strict

---

## 檔案異動總覽

| 動作 | 路徑 |
|------|------|
| Modify | `apps/api/src/routes/classes.ts` |
| Modify | `apps/web/src/app/core/classes.service.ts` |
| Modify | `apps/web/src/app/features/admin/pages/courses/courses.page.ts` |
| Modify | `apps/web/src/app/features/admin/pages/courses/courses.page.html` |
| Modify | `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html` |
| Modify | `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.scss` |
| Modify | `apps/web/src/app/features/admin/pages/courses/courses.page.scss` |
| Confirm (read-only check) | `apps/web/src/app/features/admin/pages/students/detail/class-picker-dialog/class-picker-dialog.component.ts` |
| Confirm (read-only check) | `apps/web/src/app/features/admin/pages/sessions/sessions.page.ts` |

---

## Task 1: API — 新增 `includeHistorical` + 日期範圍 query params

**Spec：** `doc/superpowers/specs/2026-03-23-class-historical-display-design.md` §2

**Files:**
- Modify: `apps/api/src/routes/classes.ts`

### 背景知識

GET /classes 路由在 line ~327。`QueryParamsSchema` 在 line 223。

現有 `dbQuery` 建構邏輯在 line ~350-362，按以下順序：
1. 建立 base query
2. 加入 search / campusId / courseId / isActive 條件
3. 排序 + 分頁

目前沒有「排除歷史班級」邏輯 — 預設回傳全部。需加入預設過濾。

歷史班級定義：`end_date IS NOT NULL AND end_date < today (Asia/Taipei 時區)`

**時區處理**：Node.js 伺服器運行時區不確定，用 `Intl.DateTimeFormat` 取台灣本地日期：
```typescript
const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
// 回傳格式：'2026-03-23'
```

- [ ] **Step 1：在 `QueryParamsSchema` 新增三個欄位**

在 `QueryParamsSchema`（line ~223）的 `z.object({...})` 內，`isActive` 之後加入：

```typescript
includeHistorical: z.string().optional(),   // 'true' | undefined
historicalFrom: z.string().optional(),       // 'yyyy-MM-dd'
historicalTo: z.string().optional(),         // 'yyyy-MM-dd'
```

- [ ] **Step 2：在 GET /classes handler 加入歷史班級的預設過濾**

找到 handler 內 `if (query.isActive !== undefined)` 那行之後、`dbQuery = dbQuery.order(...)` 之前，插入：

```typescript
// 歷史班級過濾：預設排除，includeHistorical=true 時拉全部（JS post-filter 處理日期範圍）
if (query.includeHistorical !== 'true') {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  dbQuery = dbQuery.or(`end_date.is.null,end_date.gte.${todayStr}`);
}
```

- [ ] **Step 3：拿到 data 後做 JS post-filter（僅 includeHistorical=true + 有日期範圍時）**

找到 `const { data, count, error } = await dbQuery;` 之後，替換 `const rows = data || [];` 為：

```typescript
let rows = data || [];

if (query.includeHistorical === 'true' && (query.historicalFrom || query.historicalTo)) {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
  const from = query.historicalFrom;
  const to = query.historicalTo;

  rows = rows.filter((row) => {
    const endDate = row['end_date'] as string | null;
    const startDate = row['start_date'] as string | null;
    const isHistorical = endDate != null && endDate < todayStr;

    if (!isHistorical) return true; // 現役班級永遠保留

    // 歷史班級：檢查有效期間是否與查詢範圍重疊
    // 不重疊：endDate < from OR startDate > to
    // startDate IS NULL 視為「從很早開始」，不過濾掉
    if (from && endDate < from) return false;
    if (to && startDate != null && startDate > to) return false;
    return true;
  });
}
```

- [ ] **Step 4：修正 count 的計算**

找到回傳 response 的地方（應有 `meta: { total: count ?? 0, ... }` 之類的欄位），修改 total 的計算：

```typescript
// 有 JS post-filter 時，count 會不准，改用 rows.length
const effectiveTotal =
  query.includeHistorical === 'true' && (query.historicalFrom || query.historicalTo)
    ? rows.length
    : (count ?? 0);
```

將 `meta.total` 改為使用 `effectiveTotal`。

- [ ] **Step 5：Commit**

```bash
git add apps/api/src/routes/classes.ts
git commit -m "feat(api): add includeHistorical + historicalFrom/To query params to GET /classes"
```

---

## Task 2: Frontend Service — 擴充 `ClassQueryParams`

**Spec：** `doc/superpowers/specs/2026-03-23-class-historical-display-design.md` §2

**Files:**
- Modify: `apps/web/src/app/core/classes.service.ts`

### 背景知識

`ClassQueryParams` 在 line 58。`toListParams()` 負責將 params 轉成 HttpParams（往下找 `toListParams` 方法）。

- [ ] **Step 1：在 `ClassQueryParams` 新增欄位**

```typescript
export interface ClassQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  campusId?: string;
  courseId?: string;
  isActive?: boolean;
  includeHistorical?: boolean;   // 新增
  historicalFrom?: string;        // 新增 'yyyy-MM-dd'
  historicalTo?: string;          // 新增 'yyyy-MM-dd'
}
```

- [ ] **Step 2：在 `toListParams()` 加入新欄位的序列化**

找到 `toListParams()` 方法，在 `isActive` 的處理之後加入：

```typescript
if (params.includeHistorical) httpParams = httpParams.set('includeHistorical', 'true');
if (params.historicalFrom) httpParams = httpParams.set('historicalFrom', params.historicalFrom);
if (params.historicalTo) httpParams = httpParams.set('historicalTo', params.historicalTo);
```

- [ ] **Step 3：Commit**

```bash
git add apps/web/src/app/core/classes.service.ts
git commit -m "feat(service): extend ClassQueryParams with includeHistorical + historicalFrom/To"
```

---

## Task 3: courses.page.ts — 新增歷史班級 signals 與 `isHistorical` helper

**Spec：** `doc/superpowers/specs/2026-03-23-class-historical-display-design.md` §3

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/courses.page.ts`

### 背景知識

- `classes` signal（line 98）存現役班級，`loadClasses()` 在 line 268 呼叫 `classesService.list({ pageSize: 0 })`
- `courseGroups` computed（line 160-205）過濾班級的主要邏輯
- `selectedActiveCount` / `selectedInactiveCount` computed（line 114-119）
- `hasActiveFilters` computed（line 208）
- `clearFilters()` 需要一起更新
- imports 區目前無 `DatePickerModule` 和 `ToggleSwitchModule`

- [ ] **Step 1：新增 imports**

在 imports 區加入：

```typescript
import { DatePickerModule } from 'primeng/datepicker';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { format } from 'date-fns';
```

在 component `imports` array 加入 `DatePickerModule` 和 `ToggleSwitchModule`。

- [ ] **Step 2：新增歷史班級相關 signals**

在 `protected readonly loading = signal(false);` 之後加入：

```typescript
protected readonly showHistorical = signal(false);
protected readonly historicalDateFrom = signal<Date | null>(null);
protected readonly historicalDateTo = signal<Date | null>(null);
protected readonly historicalClasses = signal<Class[]>([]);
protected readonly loadingHistorical = signal(false);
```

- [ ] **Step 3：新增 `isHistorical` helper 與 `allClasses` computed**

在 signals 區段之後加入：

```typescript
protected isHistorical(cls: Class): boolean {
  if (!cls.endDate) return false;
  const end = new Date(cls.endDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}

protected readonly allClasses = computed(() => [
  ...this.classes(),
  ...(this.showHistorical() ? this.historicalClasses() : []),
]);
```

- [ ] **Step 4：修改 `courseGroups` 使用 `allClasses()` 並加入歷史班級過濾規則**

找到 `courseGroups` computed（line ~160）內：
```typescript
const allClasses = this.classes();
```
改為：
```typescript
const allClasses = this.allClasses();
```

在 classes filter 的 `if (classActiveFilter !== null && cl.isActive !== classActiveFilter) return false;` 這行**之後**加入：

```typescript
// 「啟用中」filter 時，歷史班級即使 isActive=true 也不顯示
if (classActiveFilter === true && this.isHistorical(cl)) return false;
```

- [ ] **Step 5：修改 `selectedActiveCount` / `selectedInactiveCount` 排除歷史班級**

```typescript
protected readonly selectedActiveCount = computed(
  () =>
    this.allClasses().filter(
      (cl) => this.selectedClassIds().has(cl.id) && cl.isActive && !this.isHistorical(cl),
    ).length,
);

protected readonly selectedInactiveCount = computed(
  () =>
    this.allClasses().filter(
      (cl) => this.selectedClassIds().has(cl.id) && !cl.isActive && !this.isHistorical(cl),
    ).length,
);
```

同時更新 `allVisibleSelected` computed，將 `this.courseGroups().flatMap((g) => g.classes)` 保持不變（`courseGroups` 已用 `allClasses()` 所以已間接包含歷史班級）。

- [ ] **Step 6：新增 `loadHistoricalClasses()` 方法**

```typescript
private loadHistoricalClasses(): void {
  this.loadingHistorical.set(true);
  const from = this.historicalDateFrom();
  const to = this.historicalDateTo();
  this.classesService
    .list({
      pageSize: 0,
      includeHistorical: true,
      historicalFrom: from ? format(from, 'yyyy-MM-dd') : undefined,
      historicalTo: to ? format(to, 'yyyy-MM-dd') : undefined,
    })
    .subscribe({
      next: (res) => {
        // 只保留歷史班級（排除現役，避免重複）
        const currentIds = new Set(this.classes().map((c) => c.id));
        this.historicalClasses.set(res.data.filter((c) => !currentIds.has(c.id)));
        this.loadingHistorical.set(false);
      },
      error: () => {
        this.loadingHistorical.set(false);
      },
    });
}
```

- [ ] **Step 7：新增 toggle + 日期變更 handlers**

```typescript
protected onToggleHistorical(value: boolean): void {
  this.showHistorical.set(value);
  if (value) {
    this.loadHistoricalClasses();
  } else {
    // 先記住歷史班級 IDs，再清空
    const historicalIds = new Set(this.historicalClasses().map((c) => c.id));
    this.historicalClasses.set([]);
    this.historicalDateFrom.set(null);
    this.historicalDateTo.set(null);
    // 移除選取中的歷史班級
    if (historicalIds.size > 0) {
      const current = this.selectedClassIds();
      this.selectedClassIds.set(new Set([...current].filter((id) => !historicalIds.has(id))));
    }
  }
}

protected onHistoricalDateFromChange(value: Date | null): void {
  this.historicalDateFrom.set(value);
  if (this.showHistorical()) this.loadHistoricalClasses();
}

protected onHistoricalDateToChange(value: Date | null): void {
  this.historicalDateTo.set(value);
  if (this.showHistorical()) this.loadHistoricalClasses();
}
```

- [ ] **Step 8：修改 `hasActiveFilters` 與 `clearFilters()`**

在 `hasActiveFilters` computed 的條件列尾端加入 `|| this.showHistorical()`：

```typescript
protected readonly hasActiveFilters = computed(
  () =>
    !!this.searchQuery() ||
    !!this.selectedSubjectId() ||
    this.selectedTeacherIds().length > 0 ||
    this.statusFilter() !== null ||
    this.showHistorical(),
);
```

在 `clearFilters()` 方法開頭（或末尾）加入：

```typescript
if (this.showHistorical()) {
  this.onToggleHistorical(false);
}
```

- [ ] **Step 9：修改 `batchDelete()` 排除歷史班級**

找到 `batchDelete()` 方法，在取出 IDs 之後加入過濾：

```typescript
// 過濾掉歷史班級，不對其執行刪除
const classMap = new Map(this.allClasses().map((c) => [c.id, c]));
const ids = [...this.selectedClassIds()].filter(
  (id) => !this.isHistorical(classMap.get(id)!),
);
if (ids.length === 0) return;
// 後續邏輯使用 ids 而非 [...this.selectedClassIds()]
```

- [ ] **Step 10：Commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/courses.page.ts
git commit -m "feat(courses): add historical class signals, isHistorical helper, lazy-load, batch guards"
```

---

## Task 4: courses.page.html — Toggle、日期範圍篩選、班級 row 更新

**Spec：** `doc/superpowers/specs/2026-03-23-class-historical-display-design.md` §4、§5、§6

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/courses.page.html`

### 背景知識

- Toolbar filters `.courses__filters` div 在 line ~63-103，包含 subject / teacher / status 三個 selects
- `@if (hasActiveFilters())` 清除按鈕在 line ~106
- Class row outer div `<div class="class-row">` 在 line ~240
- `.class-row__summary` 在 line ~243，包含 checkbox + name-group + schedules + info + actions-group
- `.class-row__name-group` 在 line ~257，目前結構：`<span class="class-row__name">` + `<span class="class-row__nav-btn">`
- `.class-row__tags` div 在 line ~277，包含 p-tag（啟用中/停用中）
- `.class-row__actions-group` 在 line ~328，只有 ellipsis button
- Batch action bar 在 line ~373

- [ ] **Step 1：在 toolbar filters 後新增 historical toggle + 日期範圍**

在 `</div>` 關閉 `.courses__filters` div 之後、`@if (hasActiveFilters())` 之前，加入：

```html
<div class="courses__historical-filter">
  <p-toggleswitch
    [ngModel]="showHistorical()"
    (ngModelChange)="onToggleHistorical($event)"
    inputId="toggleHistorical"
  />
  <label for="toggleHistorical" class="courses__historical-label">含歷史班級</label>
  @if (showHistorical()) {
    <p-datepicker
      [ngModel]="historicalDateFrom()"
      (ngModelChange)="onHistoricalDateFromChange($event)"
      dateFormat="yy-mm-dd"
      [showIcon]="true"
      placeholder="開始"
      styleClass="courses__historical-date"
      [appendTo]="'body'"
    />
    <span class="courses__historical-sep">～</span>
    <p-datepicker
      [ngModel]="historicalDateTo()"
      (ngModelChange)="onHistoricalDateToChange($event)"
      dateFormat="yy-mm-dd"
      [showIcon]="true"
      placeholder="結束"
      styleClass="courses__historical-date"
      [appendTo]="'body'"
    />
  }
  @if (loadingHistorical()) {
    <i class="pi pi-spin pi-spinner courses__historical-loading"></i>
  }
</div>
```

- [ ] **Step 2：在班級 row 名稱下方加入日期副標題（需重構 name-group）**

目前 `.class-row__name-group` 是 `inline-flex; align-items: center`，裡面有 name span + nav-btn span 並排。
要在 name 下方插入日期副標題，需把 name-group 改為 column 排列，並將 name + nav-btn 包入內層 row。

找到 `<span class="class-row__name-group">` 這行，**整段替換**為：

```html
<span class="class-row__name-group">
  <span class="class-row__name-row">
    <span class="class-row__name">{{ cls.name }}</span>
    <span class="class-row__nav-btn">
      <i class="pi pi-angle-right"></i>
    </span>
  </span>
  @if (cls.startDate || cls.endDate) {
    <span class="class-row__date-range">
      {{ cls.startDate ? (cls.startDate | slice:0:7) : '' }}
      ～
      {{ cls.endDate ? (cls.endDate | slice:0:7) : '' }}
    </span>
  }
</span>
```

- [ ] **Step 3：在外層 `.class-row` div 加上歷史班級 class**

找到 `<div class="class-row">` 這行，加入 class binding：

```html
<div class="class-row" [class.class-row--historical]="isHistorical(cls)">
```

（注意：`.class-row--historical` 加在**外層** div 而非 `.class-row__summary`，這樣 CSS 才能控制整個 row 的 opacity 與 border-left hover 行為）

- [ ] **Step 4：在 `.class-row__tags` 加入「已結束」tag**

找到 `<p-tag [value]="cls.isActive ? ..." />` 之後，加入：

```html
@if (isHistorical(cls)) {
  <span class="class-row__tag-historical">已結束</span>
}
```

- [ ] **Step 5：隱藏歷史班級的 actions-group**

找到 `<div class="class-row__actions-group">` 那整個 div，用 `@if (!isHistorical(cls))` 包起來：

```html
@if (!isHistorical(cls)) {
  <div class="class-row__actions-group">
    <p-button
      #menuTrigger
      icon="pi pi-ellipsis-v"
      ...
    />
  </div>
}
```

- [ ] **Step 6：Commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/courses.page.html
git commit -m "feat(courses): add historical toggle+datepicker, date subtitle on row, hide ops for historical classes"
```

---

## Task 5: courses.page.scss — 歷史班級視覺樣式 + toolbar 新增元素

**Spec：** `doc/superpowers/specs/2026-03-23-class-historical-display-design.md` §5

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/courses.page.scss`

### 背景知識

現有 `.class-row` 樣式從 line 307 開始：
- `.class-row` 有 `border-left: 3px solid transparent` + hover `border-left-color: var(--accent-400)`
- `.class-row__name-group` 是 `display: inline-flex; align-items: center; gap: var(--space-2)` — Task 4 後需改為 column
- `.class-row__name` 在 line 357
- `.class-row__tags` 在 line 425
- 專案已使用 `::ng-deep`（見 `.class-row__summary:hover ::ng-deep .p-button`），沿用此模式即可

- [ ] **Step 1：修改 `.class-row__name-group` 以支援副標題**

找到現有的 `&__name-group` 樣式（line ~348-355），改為：

```scss
&__name-group {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex-shrink: 0;
  max-width: 40%;
  min-width: 0;
  gap: 1px;
}

&__name-row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
```

- [ ] **Step 2：新增 `.class-row__date-range` 樣式**

在 `&__name` 樣式之後加入：

```scss
&__date-range {
  font-size: var(--text-xs);
  color: var(--zinc-400);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
```

- [ ] **Step 3：新增 `.class-row--historical` 樣式**

在 `.class-row` block 的 `&:hover` 之後加入：

```scss
&--historical {
  opacity: 0.65;

  &:hover {
    border-left-color: var(--zinc-300);
  }
}
```

- [ ] **Step 4：新增 `.class-row__tag-historical` 樣式**

在 `&__tags` 樣式之後加入：

```scss
&__tag-historical {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: var(--zinc-200);
  color: var(--zinc-600);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  white-space: nowrap;
}
```

- [ ] **Step 5：在 `.courses__filters` 附近新增 historical filter toolbar 樣式**

找到 `&__filters` 樣式（在 `.courses` block 內），在其後加入：

```scss
&__historical-filter {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

&__historical-label {
  font-size: var(--text-sm);
  color: var(--zinc-600);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

&__historical-sep {
  font-size: var(--text-sm);
  color: var(--zinc-400);
}

&__historical-loading {
  color: var(--zinc-400);
  font-size: 14px;
}
```

- [ ] **Step 6：新增 historical date picker 尺寸樣式**

在 `.courses` block 外（component level），使用 `::ng-deep`（專案已有此用法）：

```scss
::ng-deep .courses__historical-date.p-datepicker {
  width: 130px;

  .p-datepicker-input {
    font-size: var(--text-sm);
    padding-top: var(--space-1);
    padding-bottom: var(--space-1);
  }
}
```

- [ ] **Step 7：RWD tablet-portrait breakpoint**

在既有的 `@include bp.respond-to('tablet-portrait')` 區段內，加入：

```scss
.courses {
  &__historical-filter {
    flex-wrap: wrap;
    width: 100%;
  }

  ::ng-deep .courses__historical-date.p-datepicker {
    width: 100%;
  }
}
```

- [ ] **Step 8：Commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/courses.page.scss
git commit -m "feat(courses): add historical class styles — row date subtitle, opacity, tag, toggle"
```

---

## Task 6: 確認現有呼叫端不受影響

**Spec：** `doc/superpowers/specs/2026-03-23-class-historical-display-design.md` §2 向下相容性

**Files:**
- Confirm: `apps/web/src/app/features/admin/pages/courses/courses.page.ts`（`loadClasses()` 方法）
- Confirm: `apps/web/src/app/features/admin/pages/students/detail/class-picker-dialog/class-picker-dialog.component.ts`
- Confirm: `apps/web/src/app/features/admin/pages/sessions/sessions.page.ts`

- [ ] **Step 1：確認 `CoursesPage.loadClasses()`**

`loadClasses()` 在 line 268：
```typescript
this.classesService.list({ pageSize: 0 })
```
沒有 `includeHistorical`，因此預設排除歷史班級。✅ 可接受 — 歷史班級透過 toggle 另外 fetch。

- [ ] **Step 2：讀 class-picker-dialog，確認呼叫 `classesService.list()` 時沒有傳 `includeHistorical`**

預期：`classesService.list({ campusId: ..., courseId: ... })` — 無 `includeHistorical`，預設排除歷史班級。✅ 可接受：選班介面不應顯示已結束班級。

- [ ] **Step 3：讀 sessions.page.ts，確認班級下拉也沒有傳 `includeHistorical`**

預期：class filter 在行事曆篩選時不應顯示已結束班級。✅ 可接受。

- [ ] **Step 4：若有發現其他呼叫 `classesService.list()` 的地方，確認行為是否可接受**

用 grep 搜尋：
```bash
grep -r "classesService.list\|classes\.list\|list.*includeHistorical" apps/web/src --include="*.ts"
```

若有其他呼叫端，評估是否需要加 `includeHistorical: true`（通常不需要，只有未來報表功能才需要）。

- [ ] **Step 5：Commit（若有修改）**

若無修改則跳過。若有必要調整其他呼叫端：

```bash
git add <changed files>
git commit -m "fix: ensure class list callers don't inadvertently include historical classes"
```

---

---

## Task 7: class-detail — 修正窄寬度學生 row 排版

**問題描述：**
`.class-detail__student-item` 是水平 flex row：
```
[index] [avatar] [student-info: flex:1] [student-status] [action-btn]
```
當 `.student-meta`（學校 · 年級 · 加入日期）在窄寬度換行成多行時，`student-status`（「在籍」pill）仍是 flex 同層兄弟元素，靠右對齊並垂直置中於整個 item，視覺上浮在 meta 文字旁的奇怪位置。

**修法：** 將 `student-status` 移進 `student-info` 欄，與 name 同行顯示，形成：
```
[index] [avatar] [info: [name + status pill], [meta 文字] ] [action-btn]
```

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html`
- Modify: `apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.scss`

### 背景知識

現有 student-item HTML 結構（`class-detail.page.html` 約 line 113-151）：
```html
<div class="class-detail__student-item">
  <span class="class-detail__student-index">{{ idx + 1 }}</span>
  <div class="class-detail__student-avatar">...</div>
  <div class="class-detail__student-info">                      <!-- flex: 1 -->
    <span class="class-detail__student-name">{{ name }}</span>
    <span class="class-detail__student-meta">學校 · 年級 · 加入日期</span>
  </div>
  <div class="class-detail__student-status" [attr.data-status]="...">  <!-- flex-shrink: 0, 兄弟元素 -->
    <span class="class-detail__status-dot"></span>
    <span class="class-detail__status-label">{{ label }}</span>
  </div>
  <button class="class-detail__action-btn">...</button>
</div>
```

SCSS 中 `.class-detail__student-info` 是 `flex-direction: column`，`.class-detail__student-status` 有 `flex-shrink: 0`。

- [ ] **Step 1：重構 student-item HTML — 將 status 移入 info 欄**

找到 `.class-detail__student-item` 的 `@for` 迴圈內容（約 line 113-151），將 `<div class="class-detail__student-info">` 和 `<div class="class-detail__student-status">` 改為：

```html
<div class="class-detail__student-info">
  <div class="class-detail__student-name-row">
    <span class="class-detail__student-name">{{ enrollment.studentName }}</span>
    <div class="class-detail__student-status" [attr.data-status]="enrollment.status">
      <span class="class-detail__status-dot"></span>
      <span class="class-detail__status-label">{{ statusLabels[enrollment.status] }}</span>
    </div>
  </div>
  <span class="class-detail__student-meta">
    @if (enrollment.studentSchool) {
      <span class="class-detail__student-school">{{ enrollment.studentSchool }}</span>
      <span class="class-detail__meta-sep">·</span>
    }
    @if (enrollment.studentGrade) {
      <span>{{ getGradeLabel(enrollment.studentGrade) }}</span>
      <span class="class-detail__meta-sep">·</span>
    }
    <span>加入 {{ enrollment.effectiveFrom }}</span>
  </span>
</div>
<!-- student-status 已移入 info，這裡不再有 student-status -->
```

完整替換後，`<div class="class-detail__student-item">` 的直接子元素改為：
`student-index` | `student-avatar` | `student-info` | `action-btn`（4 個，status 已在 info 內）

- [ ] **Step 2：更新 SCSS — 新增 `student-name-row`，調整 `student-status` 位置**

找到 `&__student-info`（line ~261），確保：
```scss
&__student-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;          // 略增一點 gap 讓 name-row 與 meta 間距好看
  min-width: 0;
}
```

在 `&__student-info` 之後加入 `&__student-name-row`：
```scss
&__student-name-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;      // 極窄寬度時 status pill 可換行至 name 下方
  min-width: 0;
}
```

`&__student-status`（line ~297）需移除 `flex-shrink: 0`（若有，因為它現在在 name-row 內，flex-shrink 意義不同）：
```scss
&__student-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px var(--space-2);
  border-radius: var(--radius-full);
  // 移除 flex-shrink: 0（改由 name-row 的 flex-wrap 處理）
  white-space: nowrap;
  // ... 保留原有的 data-status 顏色樣式
}
```

- [ ] **Step 3：確認 `action-btn` 在窄寬度下的可見性**

目前 `.class-detail__action-btn` 有 `opacity: 0`，hover 時 `opacity: 1`。在觸控裝置上無法 hover，建議改為：

```scss
&__action-btn {
  opacity: 0;

  @media (hover: none) {
    opacity: 1; // 觸控裝置永遠顯示
  }
}
```

（可選，只加 `@media (hover: none)` 那段即可）

- [ ] **Step 4：Hero 卡片窄寬度 — 加入 tablet-portrait 響應**

目前 hero 是 `display: flex; align-items: flex-start`（水平排列），在很窄的寬度（如手機）下 avatar 和 info 並排可能擠壓。加入響應式：

在 `.class-detail` block 末尾加入：

```scss
@include bp.respond-to('tablet-portrait') {
  .class-detail {
    padding: var(--space-4) 0;

    &__hero {
      flex-direction: column;
      align-items: flex-start;
      padding: var(--space-4);
      gap: var(--space-3);
    }

    &__hero-name {
      font-size: 1.375rem;
    }
  }
}
```

- [ ] **Step 5：Commit**

```bash
git add apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.html \
        apps/web/src/app/features/admin/pages/courses/class-detail/class-detail.page.scss
git commit -m "fix(class-detail): move status pill into info column, fix narrow-width student row layout"
```

---

## 手動測試清單

完成所有 Task 後，手動測試以下情境：

1. **預設狀態**：進入 `/admin/courses`，確認只看到現役班級（無 toggle）
2. **Toggle ON（無日期）**：點「含歷史班級」toggle，確認歷史班級出現、整行 opacity 降低（0.65）
3. **歷史班級 row**：
   - 顯示日期副標題（`yyyy-MM ～ yyyy-MM` 格式，只有 start 或只有 end 也要正確）
   - 顯示「已結束」zinc 灰 tag
   - **無** ellipsis 操作按鈕
   - Hover 時 border-left 為 zinc-300（非 accent 色）
4. **Toggle ON + 日期範圍**：填入歷史日期範圍，確認只顯示該範圍有效的歷史班級
5. **Toggle OFF**：關閉 toggle，確認歷史班級消失、日期篩選清空、選取中的歷史班級被移除
6. **清除篩選按鈕**：點清除，確認 toggle 關閉、歷史班級清空
7. **批次操作 — 選取現役 + 歷史班級**：
   - 啟用按鈕計數不含歷史班級
   - 停用按鈕計數不含歷史班級
   - 刪除只刪現役班級
8. **`statusFilter === true`（啟用中）+ 含歷史**：確認歷史班級即使 `isActive=true` 也不顯示
9. **現役班級（有 end_date 但未到期）**：確認不被視為歷史（row 正常顯示，無 opacity 降低）
10. **Class Picker Dialog**（學生詳情頁選班）：確認不顯示歷史班級
11. **班級詳情 — 窄寬度學生 row**：確認「在籍」等 status pill 緊跟在姓名右側，不再浮在 meta 文字旁
12. **班級詳情 — hero 卡片手機寬度**：確認 avatar 與 info 欄在窄螢幕下改為垂直堆疊
