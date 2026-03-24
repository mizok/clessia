# Filter Panel (Popover / Drawer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **委派規則：** 視覺以外的邏輯工作（TypeScript、HTML 結構）透過 `mcp__codex-cli__codex` 委派給 Codex；SCSS 視覺工作由 Claude 直接執行。

**Goal:** 將課程頁面的所有篩選控制項（科目、老師、狀態、含歷史班級、日期範圍）移入 panel 面板，桌面用 `p-popover`、手機用 `p-drawer`，工具列精簡為：`[☐] [🔍 搜尋] [篩選 (N) ∨] [清除]`。

**Architecture:** Toolbar 只保留全選 checkbox 與搜尋輸入框，新增一顆「篩選」chip 按鈕（有 badge 顯示 active filter 數量）。按下後桌面開啟 `p-popover`、手機開啟 `p-drawer`；兩者共用同一個 `ng-template #filterContent`，避免重複 HTML。日期範圍欄位獨立於「含歷史班級」toggle，永遠在面板內顯示。

**Tech Stack:** Angular 21 Signals + PrimeNG 21 (`PopoverModule`, `DrawerModule`) + BEM SCSS (no `::ng-deep`)

---

## File Map

| 檔案 | 動作 | 執行者 | 說明 |
|------|------|--------|------|
| `apps/web/src/app/features/admin/pages/courses/courses.page.ts` | Modify | **Codex** | 加入 PopoverModule/DrawerModule、新增 signals/computed/methods |
| `apps/web/src/app/features/admin/pages/courses/courses.page.html` | Modify | **Codex** | 簡化 toolbar、新增 popover/drawer + filterContent template |
| `apps/web/src/app/features/admin/pages/courses/courses.page.scss` | Modify | **Claude** | 移除舊 filter 樣式、新增 filter button + panel content 樣式 |

---

## Task 1: 更新 `courses.page.ts` — 加入 panel 相關 signals、computed、method

**執行者：Codex（透過 `mcp__codex-cli__codex`）**

**Description:**
`courses.page.ts` 目前已有 `showHistorical`、`historicalDateFrom`、`historicalDateTo` 等篩選 signals，但缺少控制 panel 開關的機制。本 task 純粹是 TypeScript 邏輯擴充：加入 `filterPanelVisible` signal、`filterPopoverRef` viewChild reference（用來操控桌面 popover）、`activeFilterCount` computed（計算目前啟用的篩選數量）、`onFilterBtnClick` 方法（依裝置決定開 popover 或 drawer），以及更新 `clearFilters()` 使其在清除時同時關閉面板並重置日期範圍。

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/courses.page.ts`

- [ ] **Step 1: 透過 Codex MCP 執行此 task**

  呼叫 `mcp__codex-cli__codex`，使用以下參數：

  ```
  sessionId: "filter-panel-ts-logic"
  workingDirectory: "/Users/mizokhuangmbp2023/Desktop/Workspace/clessia"
  ```

  **Prompt:**

  ```markdown
  ## Context
  - 專案：Clessia（補習班管理系統）
  - 檔案：apps/web/src/app/features/admin/pages/courses/courses.page.ts
  - Framework：Angular 21 Standalone Components + Signals

  ## 版本資訊
  @angular/core: ^21.1.0
  primeng: ^21.1.1
  typescript: ~5.9.2

  ## 任務
  修改 courses.page.ts，加入篩選面板（filter panel）的 TypeScript 邏輯。
  此頁面已有 showHistorical、historicalDateFrom、historicalDateTo 等篩選 signals，
  需要擴充以支援 popover/drawer panel 控制。

  ### Step A: 更新 @angular/core import，加入 viewChild
  找到這行：
  import { Component, OnInit, inject, input, signal, computed } from '@angular/core';
  替換為：
  import { Component, OnInit, inject, input, signal, computed, viewChild } from '@angular/core';

  ### Step B: 在 PrimeNG imports 區塊加入兩個 module（在 ToggleSwitchModule 之後）
  加入：
  import { PopoverModule } from 'primeng/popover';
  import { DrawerModule } from 'primeng/drawer';
  import type { Popover } from 'primeng/popover';

  ### Step C: 在 @Component imports 陣列加入（在 ToggleSwitchModule 之後）
  PopoverModule,
  DrawerModule,

  ### Step D: 在 // ---- Filters ---- 區塊的 statusFilter 行之後，加入 Filter Panel 區塊
  // ---- Filter Panel ----
  protected readonly filterPanelVisible = signal(false);
  protected readonly filterPopoverRef = viewChild<Popover>('filterPopover');

  protected readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.selectedSubjectId()) count++;
    if (this.selectedTeacherIds().length > 0) count++;
    if (this.statusFilter() !== null) count++;
    if (this.showHistorical()) count++;
    if (this.historicalDateFrom() || this.historicalDateTo()) count++;
    return count;
  });

  ### Step E: 更新 hasActiveFilters computed，補上日期範圍條件
  找到：
  protected readonly hasActiveFilters = computed(
    () =>
      !!this.searchQuery() ||
      !!this.selectedSubjectId() ||
      this.selectedTeacherIds().length > 0 ||
      this.statusFilter() !== null ||
      this.showHistorical(),
  );

  替換為：
  protected readonly hasActiveFilters = computed(
    () =>
      !!this.searchQuery() ||
      !!this.selectedSubjectId() ||
      this.selectedTeacherIds().length > 0 ||
      this.statusFilter() !== null ||
      this.showHistorical() ||
      !!this.historicalDateFrom() ||
      !!this.historicalDateTo(),
  );

  ### Step F: 替換整個 clearFilters() 方法
  找到現有的 clearFilters() 方法（從 protected clearFilters(): void { 到結尾的 }），
  完整替換為：

  protected clearFilters(): void {
    // 關閉篩選面板
    this.filterPanelVisible.set(false);
    this.filterPopoverRef()?.hide();
    if (this.showHistorical()) {
      this.onToggleHistorical(false);
    }
    this.searchQuery.set('');
    this.selectedCampusId.set(null);
    this.selectedSubjectId.set(null);
    this.selectedTeacherIds.set([]);
    this.statusFilter.set(null);
    this.historicalDateFrom.set(null);
    this.historicalDateTo.set(null);
    this.currentPage.set(1);
    this.loadCourses();
  }

  ### Step G: 在 clearFilters() 方法之後加入 onFilterBtnClick() 方法
  protected onFilterBtnClick(event: Event): void {
    if (this.isMobile()) {
      this.filterPanelVisible.set(true);
    } else {
      this.filterPopoverRef()?.toggle(event);
    }
  }

  ## 限制條件
  - 只修改上述指定的程式碼，不要更動其他邏輯
  - 保持現有的 coding style（protected readonly、signal、computed）
  - 不要加入任何 console.log
  - 所有新增的 property 都加在指定位置，不要移動現有程式碼

  ## 驗證
  執行：cd apps/web && npx tsc --noEmit
  預期：無 TypeScript 錯誤

  ## 預期產出
  - apps/web/src/app/features/admin/pages/courses/courses.page.ts（已修改）
  ```

- [ ] **Step 2: 確認 Codex 執行完畢，驗證 TypeScript 編譯**

  ```bash
  cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web && npx tsc --noEmit
  ```

  Expected: 無錯誤

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/app/features/admin/pages/courses/courses.page.ts
  git commit -m "feat(courses): add filter panel signals, viewChild, and activeFilterCount"
  ```

---

## Task 2: 重構 `courses.page.html` — 簡化 toolbar、加入 popover/drawer

**執行者：Codex（透過 `mcp__codex-cli__codex`）**

**Description:**
目前 toolbar 將所有篩選控制項（subject select、teacher multiselect、status select、history chip、datepicker × 2）全部橫排在 `courses__toolbar-main` 內，造成 UI 擁擠。本 task 重構 HTML 結構：移除 toolbar 內的所有篩選元件，改放入共用 `ng-template #filterContent`；加入 `p-popover`（桌面）和 `p-drawer`（手機）來渲染該 template；toolbar 只保留全選 checkbox、搜尋框、「篩選」chip button、清除按鈕。Task 1 的 TS 必須先完成（`activeFilterCount`、`filterPanelVisible`、`onFilterBtnClick` 等 methods 必須已存在）。

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/courses.page.html`

**前置條件：Task 1 必須已完成並 commit。**

- [ ] **Step 1: 透過 Codex MCP 執行此 task**

  呼叫 `mcp__codex-cli__codex`，使用以下參數：

  ```
  sessionId: "filter-panel-html-structure"
  workingDirectory: "/Users/mizokhuangmbp2023/Desktop/Workspace/clessia"
  ```

  **Prompt:**

  ```markdown
  ## Context
  - 專案：Clessia（補習班管理系統）
  - 檔案：apps/web/src/app/features/admin/pages/courses/courses.page.html
  - Framework：Angular 21，使用 @if / @for 原生 control flow（不用 *ngIf / *ngFor）

  ## 版本資訊
  @angular/core: ^21.1.0
  primeng: ^21.1.1

  ## 任務
  重構 courses.page.html 的篩選工具列，將所有篩選控制項移入 popover/drawer panel。

  TS 已有以下 methods/signals（Task 1 已完成）：
  - activeFilterCount() — computed signal，回傳數字
  - filterPanelVisible — signal<boolean>
  - onFilterBtnClick(event: Event) — method
  - clearFilters() — method（已更新，會關閉面板）
  - hasActiveFilters() — computed signal
  - showHistorical(), onToggleHistorical($event), loadingHistorical()
  - historicalDateFrom(), onHistoricalDateFromChange($event)
  - historicalDateTo(), onHistoricalDateToChange($event)
  - selectedSubjectId(), onSubjectChange($event), subjectOptions()
  - selectedTeacherIds(), onTeacherChange($event), filteredStaffOptions()
  - statusFilter(), onStatusFilterChange($event), statusOptions

  ### Step A: 刪除 courses__filters div（含 subject/teacher/status selects）
  找到這個 div 並完整刪除（包含內部的三個 p-select / p-multiselect）：
  <div class="courses__filters">
    ...3 個 select 元件...
  </div>

  ### Step B: 刪除 courses__history-filter div
  找到並完整刪除：
  <div class="courses__history-filter">
    ...history chip button、兩個 datepicker、spinner...
  </div>

  ### Step C: 在清除按鈕之前插入篩選 chip button
  找到這個區塊（@if (hasActiveFilters()) 的清除按鈕）：
    @if (hasActiveFilters()) {
      <p-button
        label="清除"
        ...

  在它之前插入：
      <button
        type="button"
        class="courses__filter-btn"
        [class.courses__filter-btn--active]="activeFilterCount() > 0"
        (click)="onFilterBtnClick($event)"
      >
        <i class="pi pi-sliders-h"></i>
        篩選
        @if (activeFilterCount() > 0) {
          <span class="courses__filter-badge">{{ activeFilterCount() }}</span>
        }
      </button>

  ### Step D: 在 </div><!-- /courses__card --> 之後、<!-- Class Action Menu --> 之前插入以下完整區塊

  <!-- 桌面: Popover 篩選面板 -->
  <p-popover #filterPopover styleClass="courses__filter-popover">
    <ng-container [ngTemplateOutlet]="filterContent" />
  </p-popover>

  <!-- 手機: Drawer 篩選面板 -->
  <p-drawer
    header="篩選"
    position="bottom"
    [visible]="filterPanelVisible()"
    (visibleChange)="filterPanelVisible.set($event)"
    styleClass="courses__filter-drawer"
  >
    <ng-container [ngTemplateOutlet]="filterContent" />
  </p-drawer>

  <!-- 共用篩選內容 -->
  <ng-template #filterContent>
    <div class="courses__filter-panel">

      <!-- 科目 -->
      <div class="courses__filter-section">
        <span class="courses__filter-label">科目</span>
        <p-select
          [options]="subjectOptions()"
          [ngModel]="selectedSubjectId()"
          (ngModelChange)="onSubjectChange($event)"
          placeholder="全部科目"
          [showClear]="true"
          styleClass="courses__filter-full-select"
          [appendTo]="'body'"
        />
      </div>

      <!-- 老師 -->
      <!-- Note: appendTo 由 overlayContainer 改為 'body'，因為 panel 在 popover/drawer 內部，
           overlay 需掛在 body 層才能超出 panel 範圍。若 z-index 有衝突可恢復為 [appendTo]="overlayContainer"。 -->
      <div class="courses__filter-section">
        <span class="courses__filter-label">老師</span>
        <p-multiselect
          [options]="filteredStaffOptions()"
          [ngModel]="selectedTeacherIds()"
          (ngModelChange)="onTeacherChange($event)"
          placeholder="全部老師"
          selectedItemsLabel="{0} 位老師"
          [filter]="true"
          filterBy="label"
          filterPlaceholder="搜尋老師..."
          styleClass="courses__filter-full-select"
          [appendTo]="'body'"
          [virtualScroll]="true"
          [virtualScrollItemSize]="38"
        >
          <ng-template #item let-option>
            <div class="courses__teacher-option">
              <span class="courses__teacher-option-name">{{ option.label }}</span>
              @if (option.subjectNames?.length > 0) {
                <span class="courses__teacher-option-subjects">{{ option.subjectNames.join('、') }}</span>
              }
            </div>
          </ng-template>
        </p-multiselect>
      </div>

      <!-- 狀態 -->
      <div class="courses__filter-section">
        <span class="courses__filter-label">狀態</span>
        <p-select
          [options]="statusOptions"
          [ngModel]="statusFilter()"
          (ngModelChange)="onStatusFilterChange($event)"
          placeholder="全部狀態"
          styleClass="courses__filter-full-select"
          [appendTo]="'body'"
        />
      </div>

      <!-- 含歷史班級 + 日期範圍（獨立顯示，不依賴 toggle）-->
      <div class="courses__filter-section">
        <span class="courses__filter-label">歷史班級</span>
        <div class="courses__filter-historical-row">
          <p-toggleswitch
            [ngModel]="showHistorical()"
            (ngModelChange)="onToggleHistorical($event)"
          />
          <span class="courses__filter-historical-label">含歷史班級</span>
        </div>
        <div class="courses__filter-dates">
          <p-datepicker
            [ngModel]="historicalDateFrom()"
            (ngModelChange)="onHistoricalDateFromChange($event)"
            dateFormat="yy-mm-dd"
            [showIcon]="true"
            placeholder="開始日期"
            styleClass="courses__historical-date"
            [appendTo]="'body'"
          />
          <span class="courses__filter-date-sep">～</span>
          <p-datepicker
            [ngModel]="historicalDateTo()"
            (ngModelChange)="onHistoricalDateToChange($event)"
            dateFormat="yy-mm-dd"
            [showIcon]="true"
            placeholder="結束日期"
            styleClass="courses__historical-date"
            [appendTo]="'body'"
          />
          @if (loadingHistorical()) {
            <i class="pi pi-spin pi-spinner courses__historical-loading"></i>
          }
        </div>
      </div>

      <!-- Panel Footer：有 active filter 時顯示清除按鈕 -->
      @if (activeFilterCount() > 0) {
        <div class="courses__filter-footer">
          <p-button
            label="清除篩選"
            icon="pi pi-filter-slash"
            [text]="true"
            severity="secondary"
            size="small"
            (onClick)="clearFilters()"
          />
        </div>
      }

    </div>
  </ng-template>

  ## 限制條件
  - 使用 Angular 原生 control flow（@if、@for），不用 *ngIf/*ngFor
  - 保留 courses__toolbar-main 內的全選 checkbox 和搜尋框，不要移動
  - courses__card 結束 </div> 之後插入 popover/drawer，不要放在 toolbar 裡面
  - 不要更動課程列表、pagination、batch action bar 等其他部分
  - 格式對齊：使用 2 space indent

  ## 驗證
  完成後確認 courses__toolbar-main 內不再有 p-select、p-multiselect、history-chip 等元素。

  ## 預期產出
  - apps/web/src/app/features/admin/pages/courses/courses.page.html（已修改）
  ```

- [ ] **Step 2: 確認 Codex 執行完畢，驗證 toolbar 結構**

  確認 `courses__toolbar-main` 裡只剩：全選 checkbox、搜尋框、`courses__filter-btn`、清除按鈕。

  ```bash
  grep -n 'courses__filters\|courses__history-chip\|courses__history-filter' \
    apps/web/src/app/features/admin/pages/courses/courses.page.html
  ```

  Expected: 無輸出（這些元素已被移除）

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/app/features/admin/pages/courses/courses.page.html
  git commit -m "feat(courses): move filters into popover/drawer panel, simplify toolbar"
  ```

---

## Task 3: 更新 `courses.page.scss` — 篩選按鈕 + 面板內容樣式

**執行者：Claude（視覺工作，需要 BEM skill）**

**Description:**
移除不再使用的舊篩選樣式（`__history-filter`、`__history-chip`、`__historical-sep`），並新增篩選按鈕與面板內容的 BEM 樣式。篩選按鈕採用 pill chip 風格（與 `__history-chip` 一致但語意更廣），panel 內容採用 flex column 佈局，各 section 有小標題。需注意 `__historical-date` 透過 `styleClass` 傳入 PrimeNG，CSS custom properties 有效但直接寬度 override 在 mobile 需確認實際效果。

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/courses/courses.page.scss`

> **必須先 invoke `angular-scss-bem-standards` skill 再開始修改 SCSS。**

### BEM Class Map（新增）

**Block:** `courses`

| Element / Modifier | 用途 |
|-------------------|------|
| `courses__filter-btn` | 「篩選」chip button（工具列） |
| `courses__filter-btn--active` | 有 active filters 時的 highlighted 狀態 |
| `courses__filter-badge` | filter count badge（在 chip 內） |
| `courses__filter-panel` | panel 內容根容器 |
| `courses__filter-section` | panel 內每組篩選欄位 |
| `courses__filter-label` | 欄位小標（科目、老師…） |
| `courses__filter-full-select` | panel 內滿版 select/multiselect |
| `courses__filter-historical-row` | toggle + 文字標籤橫排 |
| `courses__filter-historical-label` | toggle 旁的「含歷史班級」文字 |
| `courses__filter-dates` | 日期範圍 from/to 橫排 |
| `courses__filter-date-sep` | 日期間「～」分隔符 |
| `courses__filter-footer` | panel 清除按鈕 footer |

- [ ] **Step 1: invoke `angular-scss-bem-standards` skill，確認 class map 符合規範**

- [ ] **Step 2: 移除 `__history-filter`、`__history-chip`、`__historical-sep` 舊樣式**

  從 `.courses { ... }` 區塊中刪除：

  ```scss
  &__history-filter { ... }
  &__history-chip { ... }   // 含 &--active modifier
  &__historical-sep { ... }
  ```

  保留 `__historical-date`、`__historical-loading`（filterContent template 繼續使用）。

- [ ] **Step 3: 新增 `courses__filter-btn` 與 `courses__filter-badge`**

  在 `&__select-all { ... }` 區塊之後插入：

  ```scss
  &__filter-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    border: 1px solid var(--zinc-300);
    background: transparent;
    color: var(--zinc-600);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      color var(--transition-fast);

    .pi {
      font-size: 13px;
    }

    &:hover {
      border-color: var(--accent-400);
      color: var(--accent-600);
      background: var(--accent-50);
    }

    &--active {
      background: var(--accent-50);
      border-color: var(--accent-400);
      color: var(--accent-700);
    }
  }

  &__filter-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: var(--radius-full);
    background: var(--accent-500);
    color: #fff;
    font-size: 10px;
    font-weight: var(--font-bold);
    line-height: 1;
  }
  ```

- [ ] **Step 4: 新增 filter panel 內容樣式**

  在 `&__filter-badge { ... }` 之後插入：

  ```scss
  // ---- Filter Panel Content ----
  &__filter-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    min-width: 280px;
    max-width: 360px;
  }

  &__filter-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  &__filter-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--zinc-500);
  }

  &__filter-full-select {
    width: 100%;
  }

  &__filter-historical-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  &__filter-historical-label {
    font-size: var(--text-sm);
    color: var(--zinc-700);
  }

  &__filter-dates {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  &__filter-date-sep {
    font-size: var(--text-sm);
    color: var(--zinc-400);
    flex-shrink: 0;
  }

  &__filter-footer {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--space-3);
    border-top: 1px solid var(--zinc-100);
  }
  ```

- [ ] **Step 5: 在 SCSS 末端新增 mobile breakpoint block**

  > **重要**：現有 `courses.page.scss` 沒有 `@include bp.respond-to('mobile')` 區塊（只有 `tablet-portrait`、`480px`、`375px`）。需在 SCSS **末端新建**一個。

  > **CSS 單位規則**（CLAUDE.md）：不使用 `vh`/`dvh`/`vw`，改用 `var(--window-height)` CSS 自訂屬性（由上層 directive 透過 ResizeObserver 注入）。

  在 SCSS 檔案最後一行之後追加：

  ```scss
  @include bp.respond-to('mobile') {
    .courses {
      // Filter panel 在 drawer 裡的 mobile 調整
      &__filter-panel {
        min-width: unset;
        max-width: unset;
        width: 100%;
        padding: var(--space-3);
        // 避免 drawer 內容超出可視區域（不用 vh，用 --window-height）
        max-height: calc(var(--window-height, 640px) * 0.65);
        overflow-y: auto;
      }

      &__filter-dates {
        flex-direction: column;
        align-items: stretch;
      }

      // Note: 若 PrimeNG datepicker 的 styleClass 因 ViewEncapsulation 限制導致
      // width: 100% 未生效，改在 HTML template 上對 <p-datepicker> 加 [style]="{ width: '100%' }"
      &__historical-date {
        width: 100%;
      }

      &__filter-date-sep {
        display: none;
      }
    }
  }
  ```

- [ ] **Step 6: 確認舊 `__filters` block 已移除**

  ```bash
  grep -n '__filters\b\|__history-chip\|__history-filter\|__historical-sep' \
    apps/web/src/app/features/admin/pages/courses/courses.page.scss
  ```

  Expected: 無輸出

- [ ] **Step 7: Commit**

  ```bash
  git add apps/web/src/app/features/admin/pages/courses/courses.page.scss
  git commit -m "feat(courses): add filter button and panel content BEM styles"
  ```

---

## Task 4: Smoke Test 視覺驗證

**執行者：Claude（需要視覺確認）**

**Description:**
啟動開發伺服器，對篩選面板做目視驗證。確認 popover（桌面）和 drawer（手機）均正常開關，所有篩選項目運作正常，日期範圍獨立於 historical toggle，清除按鈕同時關閉面板。若發現 datepicker 寬度在 mobile 不正確，依照 Task 3 Step 5 的 note 改用 `[style]` binding。

**Files:**
- Modify（若需要）: `apps/web/src/app/features/admin/pages/courses/courses.page.html`
- Modify（若需要）: `apps/web/src/app/features/admin/pages/courses/courses.page.scss`

- [ ] **Step 1: 啟動開發伺服器**

  ```bash
  cd /Users/mizokhuangmbp2023/Desktop/Workspace/clessia/apps/web && npx ng serve
  ```

- [ ] **Step 2: 瀏覽器目視驗證清單**

  - [ ] Toolbar 只剩：全選 checkbox + 搜尋框 + 「篩選」chip button + 清除按鈕（有 active filter 時）
  - [ ] 「篩選」按鈕在有 active filter 時顯示 badge 數字，背景色變為 accent-50
  - [ ] 桌面：點「篩選」開啟 popover，顯示 科目 / 老師 / 狀態 / 歷史班級 / 日期範圍
  - [ ] 手機（DevTools mobile viewport）：點「篩選」開啟底部 drawer，panel 可捲動
  - [ ] 含歷史班級 toggle 可獨立開關（不依賴日期範圍）
  - [ ] 日期範圍欄位永遠顯示（不被 toggle 控制）
  - [ ] 設定任一篩選後，工具列的清除按鈕出現；點清除 → 面板關閉 + 所有篩選重置
  - [ ] panel footer 的「清除篩選」button 也可關閉面板
  - [ ] 搜尋框、全選 checkbox 功能不受影響
  - [ ] Mobile datepicker 寬度正確（若不正確，加上 `[style]="{ width: '100%' }"` binding）

- [ ] **Step 3: 若有 datepicker 寬度問題，修正後 commit**

  ```bash
  git add apps/web/src/app/features/admin/pages/courses/courses.page.html \
          apps/web/src/app/features/admin/pages/courses/courses.page.scss
  git commit -m "fix(courses): fix datepicker width in mobile filter panel"
  ```

---

## 最終 Toolbar HTML 結構（參考）

```html
<div class="courses__toolbar">
  <div class="courses__toolbar-main">
    <!-- 全選 checkbox -->
    <label class="courses__select-all" ...><input type="checkbox" .../></label>

    <!-- 搜尋 -->
    <div class="courses__search"><p-iconfield ...>...</p-iconfield></div>

    <!-- 篩選 chip button -->
    <button type="button" class="courses__filter-btn"
      [class.courses__filter-btn--active]="activeFilterCount() > 0"
      (click)="onFilterBtnClick($event)">
      <i class="pi pi-sliders-h"></i>
      篩選
      @if (activeFilterCount() > 0) {
        <span class="courses__filter-badge">{{ activeFilterCount() }}</span>
      }
    </button>

    <!-- 清除（有 active filter 時顯示）-->
    @if (hasActiveFilters()) {
      <p-button label="清除" icon="pi pi-filter-slash" [text]="true"
        severity="secondary" (onClick)="clearFilters()" />
    }
  </div>
</div>
```
