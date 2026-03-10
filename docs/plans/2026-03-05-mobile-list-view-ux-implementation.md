# 手機版清單視圖 UX 重設計 — 實作計劃

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 改善手機版清單視圖的可用性：最大化表格空間、bottom sheet 批次操作、收合式篩選器。

**Architecture:** 手機版以 `BrowserStateService.isMobile` signal 為條件，用 `@if` 切換桌面 / 手機版的 batch bar 和篩選器佈局。手機版 batch bar 改為 floating bar + PrimeNG Drawer（position=bottom）。篩選器改成日期範圍 + 「篩選」按鈕的兩元素佈局。桌面版所有功能不變。

**Tech Stack:** Angular 21 Signals, PrimeNG Drawer, SCSS BEM, `BrowserStateService`

**設計文件:** `docs/plans/2026-03-05-mobile-list-view-ux-design.md`

---

## Task 1: 空間最大化 — SCSS 修改

移除手機版 card 裝飾、responsive-table 外框，讓表格佔滿剩餘高度。

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.scss` (mobile section)
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.scss` (mobile media query)

**Step 1: 修改 calendar.page.scss 的手機版樣式**

在 `@include bp.respond-to('mobile')` 區塊內新增 `cal__card` 手機樣式：

```scss
@include bp.respond-to('mobile') {
  .cal {
    padding: var(--space-2);
    gap: var(--space-2);

    // 移除手機版 card 裝飾
    &__card {
      border-radius: 0;
      box-shadow: none;
      border-left: 0;
      border-right: 0;
    }

    // 清單區域去掉 padding，撐滿空間
    &__list {
      padding: 0;
    }

    &__filters {
      flex-wrap: nowrap;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding-bottom: var(--space-1);

      &::-webkit-scrollbar {
        display: none;
      }
    }

    &__filter {
      flex: 0 0 auto;
      width: 140px;
    }

    &__title {
      font-size: var(--text-lg);
    }

    &__batch-bar {
      flex-direction: column;
      align-items: stretch;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
    }

    &__batch-bar-count {
      text-align: center;
    }

    &__batch-bar-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-2);
      margin-left: 0;

      > :last-child {
        grid-column: 1 / -1;
      }
    }
  }
}
```

**Step 2: 修改 responsive-table 手機版邊框**

在 `responsive-table.component.scss` 的 `@media (max-width: 768px)` 區塊內新增：

```scss
@media (max-width: 768px) {
  // 既有的 padding 調整 ...

  // 移除外框裝飾，讓表格融入背景
  border: none;
  border-radius: 0;
  box-shadow: none;
  background: var(--color-white);
}
```

**Step 3: 驗證編譯**

Run: `npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/calendar/calendar.page.scss \
       apps/web/src/app/shared/components/responsive-table/responsive-table.component.scss
git commit -m "style(calendar): maximize mobile list view space

Remove card decoration and responsive-table borders on mobile.
Remove list padding to let the table fill available space."
```

---

## Task 2: Inject BrowserStateService + 手機版 floating bar

在 CalendarPage 注入 `BrowserStateService`，並建立手機版 floating bar HTML 和 SCSS。

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts` (inject service, add `showBatchSheet` signal)
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.html` (floating bar + drawer)
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.scss` (floating bar styles)

**Step 1: 修改 calendar.page.ts**

1. Import `BrowserStateService` 和 `DrawerModule`：

```typescript
import { BrowserStateService } from '@core/browser-state.service';
import { DrawerModule } from 'primeng/drawer';
```

2. 在 imports array 加入 `DrawerModule`

3. 注入 service 和新增 signals：

```typescript
protected readonly browserState = inject(BrowserStateService);
protected readonly isMobile = this.browserState.isMobile;
protected readonly showBatchSheet = signal(false);
```

4. 新增方法：

```typescript
protected openBatchSheet(): void {
  this.showBatchSheet.set(true);
}

protected closeBatchSheet(): void {
  this.showBatchSheet.set(false);
  this.closeBatchPanel();
}

protected selectBatchAction(mode: 'assign' | 'time' | 'cancel' | 'uncancel'): void {
  this.openBatchPanel(mode);
}
```

**Step 2: 修改 HTML — 手機版 floating bar + bottom sheet**

把現有的 batch bar / batch panel 區塊（lines 297-389）改成用 `@if (isMobile())` 分流：

**手機版（floating bar + Drawer）：**

```html
@if (selectedCount() > 0 && isMobile()) {
  <!-- Mobile: Floating bar -->
  <div class="cal__mobile-batch-bar">
    <span class="cal__mobile-batch-bar-count">已選 {{ selectedCount() }} 堂</span>
    <div class="cal__mobile-batch-bar-actions">
      <p-button label="操作" icon="pi pi-bars" size="small"
        (onClick)="openBatchSheet()" />
      <p-button icon="pi pi-times" [rounded]="true" [text]="true" size="small"
        severity="secondary" (onClick)="clearSelection()" pTooltip="取消選取" />
    </div>
  </div>

  <!-- Mobile: Bottom sheet -->
  <p-drawer [(visible)]="showBatchSheet" position="bottom" [modal]="true"
    styleClass="cal__batch-drawer" [style]="{ height: 'auto' }">
    <ng-template #header>
      <span class="cal__batch-drawer-header">已選 {{ selectedCount() }} 堂</span>
    </ng-template>

    @if (!batchMode()) {
      <!-- Action menu -->
      <div class="cal__batch-drawer-menu">
        <button class="cal__batch-drawer-item" (click)="selectBatchAction('assign')">
          <i class="pi pi-user-plus"></i>
          <span>指派老師</span>
        </button>
        <button class="cal__batch-drawer-item" (click)="selectBatchAction('time')">
          <i class="pi pi-clock"></i>
          <span>修改時間</span>
        </button>
        <button class="cal__batch-drawer-item" (click)="selectBatchAction('cancel')">
          <i class="pi pi-ban"></i>
          <span>停課</span>
        </button>
        <button class="cal__batch-drawer-item" (click)="selectBatchAction('uncancel')">
          <i class="pi pi-replay"></i>
          <span>取消停課</span>
        </button>
      </div>
    } @else {
      <!-- Batch form inside sheet -->
      @switch (batchMode()) {
        @case ('assign') {
          <h4 class="cal__batch-drawer-title">指派老師給 {{ selectedCount() }} 堂課</h4>
          <p-select
            [options]="availableTeachers()"
            optionLabel="displayName"
            optionValue="id"
            placeholder="選擇老師"
            [filter]="true"
            filterBy="displayName"
            [ngModel]="batchTeacherId()"
            (ngModelChange)="batchTeacherId.set($event)"
            appendTo="body"
            styleClass="w-full"
          />
        }
        @case ('time') {
          <h4 class="cal__batch-drawer-title">修改 {{ selectedCount() }} 堂課的時間</h4>
          <div class="cal__batch-drawer-time-row">
            <label class="cal__batch-drawer-label">開始</label>
            <input pInputText type="time"
              [ngModel]="batchStartTime()"
              (ngModelChange)="batchStartTime.set($event)" />
          </div>
          <div class="cal__batch-drawer-time-row">
            <label class="cal__batch-drawer-label">結束</label>
            <input pInputText type="time"
              [ngModel]="batchEndTime()"
              (ngModelChange)="batchEndTime.set($event)" />
          </div>
        }
        @case ('cancel') {
          <h4 class="cal__batch-drawer-title">停課 {{ selectedCount() }} 堂</h4>
          <input pInputText
            placeholder="原因（選填）"
            [ngModel]="batchCancelReason()"
            (ngModelChange)="batchCancelReason.set($event)"
            class="w-full" />
        }
        @case ('uncancel') {
          <h4 class="cal__batch-drawer-title">取消停課 {{ selectedCount() }} 堂</h4>
        }
      }

      @if (batchPreview()) {
        <div class="cal__batch-preview" style="margin-top: var(--space-2)">
          <span class="cal__batch-preview-ok">{{ getProcessableCount() }} 堂可操作</span>
          @if (getSkippedCount() > 0) {
            <span class="cal__batch-preview-skip">· {{ getSkippedCount() }} 堂略過</span>
          }
        </div>
      }

      <div class="cal__batch-drawer-footer">
        <p-button label="返回" [text]="true" size="small" icon="pi pi-arrow-left"
          (onClick)="closeBatchPanel()" />
        @if (!batchPreview()) {
          <p-button label="預覽" size="small"
            (onClick)="runBatchPreview()"
            [disabled]="batchMode() === 'assign' && !batchTeacherId()"
            [loading]="batchLoading()" />
        } @else {
          <p-button
            [label]="'確認 (' + getProcessableCount() + ' 堂)'"
            size="small"
            (onClick)="applyBatch()"
            [loading]="batchLoading()"
            [disabled]="getProcessableCount() === 0" />
        }
      </div>
    }
  </p-drawer>
}
```

**桌面版保持不變（加 `!isMobile()` 條件）：**

```html
@if (selectedCount() > 0 && !isMobile()) {
  @if (batchMode()) {
    <div class="cal__batch-panel">
      <!-- 原有 batch panel 內容不變 -->
    </div>
  }
  <div class="cal__batch-bar">
    <!-- 原有 batch bar 內容不變 -->
  </div>
}
```

**Step 3: 修改 SCSS — floating bar + drawer 樣式**

在 `calendar.page.scss` 加入新的 BEM 區塊：

```scss
// ── Mobile batch floating bar ──────────────────────────────────────
&__mobile-batch-bar {
  display: none; // 桌面隱藏
}

@include bp.respond-to('mobile') {
  .cal {
    // ... existing mobile styles ...

    &__mobile-batch-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: fixed;
      left: 0;
      right: 0;
      bottom: calc(64px + env(safe-area-inset-bottom, 0px));
      height: 48px;
      padding: 0 var(--space-3);
      background: var(--accent-600);
      color: #fff;
      z-index: 100;
      box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.12);
    }

    &__mobile-batch-bar-count {
      font-size: var(--text-sm);
      font-weight: var(--font-semibold);
    }

    &__mobile-batch-bar-actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    // 隱藏桌面版 batch bar / panel
    &__batch-bar,
    &__batch-panel {
      display: none;
    }
  }
}

// ── Batch drawer (bottom sheet) ────────────────────────────────────
.cal__batch-drawer {
  .p-drawer-content {
    padding: var(--space-3) var(--space-4) var(--space-6);
  }
}

.cal__batch-drawer-header {
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
  color: var(--zinc-800);
}

.cal__batch-drawer-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.cal__batch-drawer-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-2);
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  font-size: var(--text-md);
  color: var(--zinc-700);
  cursor: pointer;
  transition: background-color var(--transition-fast);
  width: 100%;
  text-align: left;

  i {
    font-size: 1.1rem;
    width: 24px;
    text-align: center;
    color: var(--zinc-500);
  }

  &:hover {
    background: var(--zinc-100);
  }

  &:active {
    background: var(--zinc-200);
  }
}

.cal__batch-drawer-title {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--zinc-700);
}

.cal__batch-drawer-time-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.cal__batch-drawer-label {
  font-size: var(--text-sm);
  color: var(--zinc-500);
  min-width: 40px;
}

.cal__batch-drawer-footer {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--zinc-200);
}
```

**Step 4: 修改 applyBatch 以關閉 drawer**

在 `applyBatch()` 的 success handler 中加入：

```typescript
this.showBatchSheet.set(false);
```

（加在 `this.closeBatchPanel()` 之後）

**Step 5: 驗證編譯**

Run: `npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/calendar/calendar.page.ts \
       apps/web/src/app/features/admin/pages/calendar/calendar.page.html \
       apps/web/src/app/features/admin/pages/calendar/calendar.page.scss
git commit -m "feat(calendar): mobile bottom sheet for batch operations

Replace inline batch bar with floating bar + PrimeNG Drawer on mobile.
Floating bar sits above bottom nav (64px + safe-area).
Drawer shows action menu, then switches to form on selection.
Desktop batch bar/panel remains unchanged."
```

---

## Task 3: 手機版篩選器收合

手機版篩選器改成兩元素佈局：日期範圍永遠可見 + 「篩選」按鈕（badge 顯示啟用數量）→ 展開 overlay panel。

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.ts` (新增 `showMobileFilters` signal + `activeFilterCount` computed)
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.html` (手機版篩選器)
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.scss` (篩選器 overlay 樣式)

**Step 1: 修改 calendar.page.ts**

新增 signals：

```typescript
protected readonly showMobileFilters = signal(false);

protected readonly activeFilterCount = computed(() => {
  let count = 0;
  if (this.selectedCourseId()) count++;
  if (this.selectedTeacherIds().length > 0) count++;
  if (this.selectedClassId()) count++;
  return count;
});
```

新增方法：

```typescript
protected toggleMobileFilters(): void {
  this.showMobileFilters.update((v) => !v);
}

protected closeMobileFilters(): void {
  this.showMobileFilters.set(false);
}
```

Import `PopoverModule`（或使用 `@if` 切換 + backdrop，不需要額外 PrimeNG 元件）。

**Step 2: 修改 HTML — 手機版篩選器**

把現有的 `cal__filters` 區塊改成用 `@if (isMobile() && viewMode() === 'list')` 分流：

```html
<!-- Filters -->
@if (isMobile() && viewMode() === 'list') {
  <!-- Mobile: compact filter bar -->
  <div class="cal__mobile-filters">
    <p-datepicker
      class="cal__mobile-filter-date"
      selectionMode="range"
      [ngModel]="listDateRange()"
      (ngModelChange)="onListDateRangeChange($event)"
      dateFormat="mm/dd"
      placeholder="日期範圍"
      [showIcon]="true"
      [appendTo]="'body'"
      [firstDayOfWeek]="1"
      [numberOfMonths]="1"
      [readonlyInput]="true"
    />
    <button class="cal__mobile-filter-btn" (click)="toggleMobileFilters()">
      <i class="pi pi-filter"></i>
      篩選
      @if (activeFilterCount() > 0) {
        <span class="cal__mobile-filter-badge">{{ activeFilterCount() }}</span>
      }
    </button>
  </div>

  @if (showMobileFilters()) {
    <div class="cal__mobile-filter-backdrop" (click)="closeMobileFilters()"></div>
    <div class="cal__mobile-filter-panel">
      @if (campuses().length > 1) {
        <div class="cal__mobile-filter-row">
          <label class="cal__mobile-filter-label">分校</label>
          <p-select
            [options]="campuses()"
            optionLabel="name"
            optionValue="id"
            placeholder="選擇分校"
            [appendTo]="'body'"
            [filter]="true"
            filterBy="name"
            [ngModel]="selectedCampusId()"
            (ngModelChange)="onCampusChange($event)"
            styleClass="w-full"
          />
        </div>
      }
      @if (selectedCampusId() && availableCourses().length > 0) {
        <div class="cal__mobile-filter-row">
          <label class="cal__mobile-filter-label">課程</label>
          <p-select
            [options]="availableCourses()"
            optionLabel="name"
            optionValue="id"
            placeholder="所有課程"
            [appendTo]="'body'"
            [filter]="true"
            filterBy="name"
            [showClear]="true"
            [ngModel]="selectedCourseId()"
            (ngModelChange)="onCourseChange($event)"
            styleClass="w-full"
          />
        </div>
      }
      @if (selectedCampusId() && availableTeachers().length > 0) {
        <div class="cal__mobile-filter-row">
          <label class="cal__mobile-filter-label">老師</label>
          <p-multiselect
            [options]="availableTeachers()"
            optionLabel="displayName"
            optionValue="id"
            placeholder="所有老師"
            selectedItemsLabel="{0} 位老師"
            [appendTo]="'body'"
            [filter]="true"
            filterPlaceholder="搜尋老師..."
            [ngModel]="selectedTeacherIds()"
            (ngModelChange)="onTeacherIdsChange($event)"
            styleClass="w-full"
          />
        </div>
      }
      @if (selectedCampusId() && availableClasses().length > 0) {
        <div class="cal__mobile-filter-row">
          <label class="cal__mobile-filter-label">班級</label>
          <p-select
            [options]="availableClasses()"
            optionLabel="name"
            optionValue="id"
            placeholder="所有班級"
            [appendTo]="'body'"
            [filter]="true"
            [showClear]="true"
            [ngModel]="selectedClassId()"
            (ngModelChange)="onClassChange($event)"
            styleClass="w-full"
          />
        </div>
      }
      @if (hasActiveFilters()) {
        <div class="cal__mobile-filter-row" style="justify-content: flex-end">
          <p-button label="清除全部" severity="secondary" [text]="true" size="small"
            icon="pi pi-times" (onClick)="clearFilters()" />
        </div>
      }
    </div>
  }
} @else {
  <!-- Desktop / Calendar: original filters -->
  <div class="cal__filters">
    <!-- 原有的篩選器 HTML 不變 -->
  </div>
}
```

**Step 3: 修改 SCSS — 手機版篩選器樣式**

```scss
// ── Mobile filters ─────────────────────────────────────────────────
.cal__mobile-filters {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.cal__mobile-filter-date {
  flex: 1;
  min-width: 0;
}

.cal__mobile-filter-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--zinc-300);
  border-radius: var(--radius-md);
  background: #fff;
  font-size: var(--text-sm);
  color: var(--zinc-700);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  height: 38px; // match PrimeNG input height

  i {
    font-size: 0.875rem;
  }

  &:active {
    background: var(--zinc-100);
  }
}

.cal__mobile-filter-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: var(--radius-full);
  background: var(--accent-500);
  color: #fff;
  font-size: 11px;
  font-weight: var(--font-bold);
  line-height: 1;
}

.cal__mobile-filter-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 90;
}

.cal__mobile-filter-panel {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 91;
  background: #fff;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cal__mobile-filter-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.cal__mobile-filter-label {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--zinc-600);
}
```

**Step 4: 驗證編譯**

Run: `npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add apps/web/src/app/features/admin/pages/calendar/calendar.page.ts \
       apps/web/src/app/features/admin/pages/calendar/calendar.page.html \
       apps/web/src/app/features/admin/pages/calendar/calendar.page.scss
git commit -m "feat(calendar): collapsible mobile filters with badge count

Mobile list view shows date range + filter button with active count badge.
Filter button opens overlay panel with full-width selects.
Desktop/calendar mode retains horizontal filter layout."
```

---

## Task 4: 微調和邊界情況

確保所有手機版互動正常，清理殘留的桌面版手機樣式。

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.scss`
- Modify: `apps/web/src/app/features/admin/pages/calendar/calendar.page.html`

**Step 1: 清理舊的手機版 batch bar 樣式**

在 `@include bp.respond-to('mobile')` 中移除舊的 `&__batch-bar` 和 `&__batch-bar-actions` 手機樣式（因為現在手機版完全使用 floating bar + drawer，不再需要這些 fallback）。

**Step 2: 確保 floating bar 不遮擋 paginator**

如果清單有分頁，最後一行可能被 floating bar 遮住。在手機版清單區域底部加 padding：

```scss
// 在 mobile section 中
&__list {
  padding: 0;
  // 為 floating bar 留空間（floating bar 48px 高）
  padding-bottom: 56px;
}
```

**Step 3: 處理 batch 操作成功後的 sheet 關閉**

確認 `applyBatch()` 成功後會：
1. `this.showBatchSheet.set(false)` — 關閉 drawer
2. `this.closeBatchPanel()` — 清除 batch 狀態
3. `this.clearSelection()` — 清除勾選

**Step 4: 驗證手機版 checkbox 欄寬**

Checkbox 欄目前是 `width: 48px`，設計要求改成 36px。在 HTML 中把 checkbox `th` 和 `td` 的 `style="width: 48px"` 改成 `style="width: 36px"`。

**Step 5: 驗證編譯**

Run: `npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/calendar/calendar.page.ts \
       apps/web/src/app/features/admin/pages/calendar/calendar.page.html \
       apps/web/src/app/features/admin/pages/calendar/calendar.page.scss
git commit -m "fix(calendar): mobile UX polish — checkbox width, list padding, cleanup

Reduce checkbox column from 48px to 36px.
Add bottom padding to list for floating bar clearance.
Remove obsolete mobile batch bar CSS overrides."
```

---

## Task 5: 最終驗證

**Step 1: 完整編譯驗證**

Run: `npx ng build --configuration=development 2>&1 | tail -20`
Expected: Build succeeds with no errors

**Step 2: 格式化**

Run: `npx prettier --write "apps/web/src/app/features/admin/pages/calendar/**"`

**Step 3: Commit (if formatting changes)**

```bash
git add -A
git commit -m "style: format calendar page files"
```
