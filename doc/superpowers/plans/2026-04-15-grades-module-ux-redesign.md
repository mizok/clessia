# 成績模組 UX 重設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重新設計成績模組的 UX，修復考試管理手機篩選、成績登錄桌面/手機版、成績總覽入口式設計。

**Architecture:** 前端純 UI/UX 重構 + 路由結構調整。不需新增後端 API（現有 `students.list`、`classes.list`、`courses.list`、`scores` 端點已足夠）。成績總覽改為入口式路由（overview → overview/student、overview/class）。

**Tech Stack:** Angular 21 (Standalone + Signals), PrimeNG 21, SCSS BEM

**Spec:** `doc/superpowers/specs/2026-04-15-grades-module-ux-redesign.md`

---

## 分工策略

| 執行者 | 任務 | 原因 |
|--------|------|------|
| **Codex** | Task 1：狀態名稱 + 年級格式化 | 機械性替換，影響面明確 |
| **Codex** | Task 2：桌面版表格欄位寬度修復 | SCSS 調整，獨立變更 |
| **Codex** | Task 3：手機版 stats 精簡 | 純樣式 + template 調整 |
| **Claude** | Task 4：FAB 儲存按鈕 | 移除 sticky footer + 新增浮動按鈕 |
| **Claude** | Task 5：手機版 Bottom Sheet 編輯 | 新互動模式，需架構判斷 |
| **Claude** | Task 6：考試管理手機版篩選 Dialog | 新 dialog 元件互動 |
| **Claude** | Task 7：成績總覽路由重構 + 入口頁 | 路由結構、元件拆分 |
| **Claude** | Task 8：學生視角重構 | 預載學生清單、分校篩選 |
| **Claude** | Task 9：班級視角重構 | 課程分組、分校篩選 |

---

## Task 1: 狀態名稱修正 + 年級中文化 [Codex]

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.ts:44-48`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.html:54`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.ts:65-69`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.html:87`
- Test: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.spec.ts`
- Test: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.spec.ts`

- [ ] **Step 1: 修改 academy-score-editor STATUS_OPTIONS**

In `academy-score-editor.component.ts`, change:
```typescript
const STATUS_OPTIONS: Array<{ label: string; value: AcademyScoreStatus }> = [
  { label: '未登錄', value: 'scored' },
  { label: '缺考', value: 'absent' },
  { label: '補考', value: 'makeup' },
];
```

- [ ] **Step 2: 新增年級格式化函式到 academy-score-editor**

In `academy-score-editor.component.ts`, add to the component class:
```typescript
private static readonly GRADE_LABELS: Record<string, string> = {
  P1: '小一', P2: '小二', P3: '小三', P4: '小四', P5: '小五', P6: '小六',
  J1: '國一', J2: '國二', J3: '國三',
  S1: '高一', S2: '高二', S3: '高三',
};

protected formatGrade(grade: string | null): string {
  if (!grade) return '—';
  return AcademyScoreEditorComponent.GRADE_LABELS[grade] ?? grade;
}
```

- [ ] **Step 3: 套用年級格式化到 academy-score-editor template**

In `academy-score-editor.component.html`, change all `{{ row.studentGrade ?? '—' }}` to `{{ formatGrade(row.studentGrade) }}`。包括桌面版 table (line 54) 和手機版 card (line 106)。

- [ ] **Step 4: 修改 term-score-editor STATUS_OPTIONS**

In `term-score-editor.component.ts`, change:
```typescript
const STATUS_OPTIONS: Array<{ label: string; value: TermScoreStatus }> = [
  { label: '未登錄', value: 'scored' },
  { label: '缺考', value: 'absent' },
  { label: '補考', value: 'makeup' },
];
```

- [ ] **Step 5: term-score-editor 年級已有 GRADE_OPTIONS 中文標籤**

`term-score-editor` 的 `GRADE_OPTIONS` 已使用中文 label（小一、國一…），但在 template 中顯示 `student.studentGrade` 是原始值。需在 component 中新增同樣的 `formatGrade` 方法，然後在 template 中的 `{{ student.studentGrade ?? '' }}` (line 87) 和 `{{ s.studentGrade }}` (line 44) 套用 `formatGrade()`。搜尋結果的 `{{ student.grade }}` (line 68) 也要套用。

```typescript
private static readonly GRADE_LABELS: Record<string, string> = {
  P1: '小一', P2: '小二', P3: '小三', P4: '小四', P5: '小五', P6: '小六',
  J1: '國一', J2: '國二', J3: '國三',
  S1: '高一', S2: '高二', S3: '高三',
};

protected formatGrade(grade: string | null): string {
  if (!grade) return '—';
  return TermScoreEditorComponent.GRADE_LABELS[grade] ?? grade;
}
```

- [ ] **Step 6: 執行測試確認無破壞**

Run: `npx ng test --watch=false 2>&1 | tail -20`
Expected: 所有既有測試通過（可能需更新 snapshot 中的「已作答」→「未登錄」文字比對）

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/
git commit -m "fix(web): rename scored status to 未登錄 and format grade labels as Chinese"
```

---

## Task 2: 桌面版表格欄位寬度修復 [Codex]

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.scss`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.scss`

- [ ] **Step 1: 調整 academy-score-editor 表格欄寬**

In `academy-score-editor.component.scss`:

```scss
&__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  table-layout: fixed;
}

&__th {
  // ... existing styles ...

  &--grade {
    width: 60px;
  }

  &--score {
    width: 120px;
  }

  &--status {
    width: 120px;
  }

  &--notes {
    // remove fixed width, takes remaining space
  }
}
```

Remove `&__cell` 的 `--score`, `--status`, `--notes` 的 `width` 設定（由 th 控制即可）。

Remove `&__score-input` 和 `&__status-select` 的 `max-width`，改為只設 `width: 100%`。

Remove `&__notes-input` 的 `max-width: 160px`（桌面版也用 `width: 100%`）。

新增學生欄位寬度：
```scss
&__th--name {
  width: 120px;
}
```

在 template 中加上 `academy-score-editor__th--name` class 到學生欄 th。

- [ ] **Step 2: 調整 term-score-editor 表格欄寬**

確認 `term-score-editor.component.scss` 已有 `table-layout: fixed`。移除 `&__score-input` 和 `&__status-select` 的 `max-width`，確保 `width: 100%`。

- [ ] **Step 3: 視覺驗證**

Run: `npx ng serve` and verify at `http://localhost:4200/admin/grades/exams/{type}/{id}/scores`
Expected: 欄位不重疊，input/select 填滿欄寬

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/
git commit -m "fix(web): fix score editor table column widths to prevent overlap"
```

---

## Task 3: 手機版 stats 精簡 [Codex]

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.html:26-45`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.scss:62-90`

- [ ] **Step 1: 手機版 academy stats 改為單行摘要**

在 `score-entry.component.scss` 中，修改手機版 `@media (max-width: 768px)` 內的 stats：

```scss
@media (max-width: 768px) {
  .score-entry {
    // ... existing mobile overrides ...

    &__stats {
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--space-2);
      padding-top: var(--space-3);
    }

    &__stat {
      flex-direction: row;
      align-items: baseline;
      gap: var(--space-1);
      width: auto;
      min-width: 0;
      padding: 0;
      background: none;
      border-radius: 0;
    }

    &__stat-value {
      font-size: var(--text-md);
    }

    &__stat-label {
      font-size: var(--text-xs);
      margin-top: 0;
    }

    // stats 之間用分隔符
    &__stat + &__stat::before {
      content: '·';
      color: var(--zinc-300);
      margin-right: var(--space-1);
    }
  }
}
```

- [ ] **Step 2: 手機版 term summary 精簡**

同樣在 mobile media query 中，term summary 的 subject 列表改為更緊湊的排列：

```scss
&__term-summary {
  gap: var(--space-2);
}

&__term-subjects {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--space-2);
}

&__term-subject {
  min-width: 0;
  width: auto;
  padding: var(--space-1) var(--space-2);
}
```

- [ ] **Step 3: 視覺驗證**

在瀏覽器 DevTools 切換到手機尺寸，確認 stats 變為單行/緊湊模式。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.scss
git commit -m "fix(web): compact mobile stats in score entry header"
```

---

## Task 4: FAB 儲存按鈕 [Claude]

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.html:104-122`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.scss:180-233`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/score-entry.component.ts`

- [ ] **Step 1: 移除 sticky footer，新增 FAB**

In `score-entry.component.html`, replace the `__actions` block (lines 104-122) with:

```html
<!-- FAB Save Button -->
@if (!isClosed() && canSave()) {
  <button
    type="button"
    class="score-entry__fab"
    [class.score-entry__fab--saving]="saving()"
    [disabled]="saving()"
    (click)="saveScores()"
  >
    @if (saving()) {
      <i class="pi pi-spinner pi-spin"></i>
    } @else {
      <i class="pi pi-save"></i>
    }
    <span>儲存成績</span>
  </button>
}
```

「返回考試管理」按鈕不需要了，因為 breadcrumb 已可導航回去。

- [ ] **Step 2: 新增 FAB 樣式**

In `score-entry.component.scss`, remove all `&__actions` 相關樣式（`&__actions`, `&__actions--dirty`, `&__dirty-banner`, `&__dirty-copy`, `&__dirty-title`, `&__dirty-text`, `&__action-buttons`），新增：

```scss
&__fab {
  position: fixed;
  bottom: var(--space-6);
  right: var(--space-6);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  background: var(--sky-600, #0284c7);
  color: #fff;
  border: none;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
  transition: all 150ms ease-out;
  z-index: 100;
  animation: fab-enter 200ms ease-out;

  &:hover {
    background: var(--sky-700, #0369a1);
    box-shadow: 0 6px 16px rgba(2, 132, 199, 0.5);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }

  &:focus-visible {
    outline: 2px solid var(--sky-500);
    outline-offset: 2px;
  }

  &--saving {
    opacity: 0.8;
    cursor: not-allowed;
  }
}

@keyframes fab-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

Mobile override:
```scss
@media (max-width: 768px) {
  .score-entry {
    &__fab {
      bottom: var(--space-4);
      right: var(--space-4);
    }
  }
}
```

- [ ] **Step 3: 移除 TS 中未使用的相關邏輯**

確認 `score-entry.component.ts` 中沒有被移除的 template 引用的方法。`goBack()` 方法如果 breadcrumb 已能導航，可以保留但不再被 template 呼叫。

- [ ] **Step 4: 執行測試**

Run: `npx ng test --watch=false 2>&1 | tail -20`

- [ ] **Step 5: 視覺驗證**

在瀏覽器確認：
1. 無 dirty 時看不到 FAB
2. 修改分數後 FAB 從右下角浮現
3. 點擊 FAB 顯示 spinner
4. 儲存後 FAB 消失

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/
git commit -m "feat(web): replace sticky footer with FAB save button in score entry"
```

---

## Task 5: 手機版 Bottom Sheet 編輯 [Claude]

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.scss`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/academy-score-editor/academy-score-editor.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.scss`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/score-entry/term-score-editor/term-score-editor.component.ts`

- [ ] **Step 1: academy-score-editor — 手機版改為精簡列表**

Replace `__card-list` block in template with:

```html
<div class="academy-score-editor__mobile-list">
  @for (row of filteredRows(); track row.studentId) {
    <button
      type="button"
      class="academy-score-editor__mobile-row"
      (click)="openSheet(row)"
    >
      <div class="academy-score-editor__mobile-info">
        <span class="academy-score-editor__mobile-name">{{ row.studentName }}</span>
        <span class="academy-score-editor__mobile-grade">{{ formatGrade(row.studentGrade) }}</span>
      </div>
      <span
        class="academy-score-editor__mobile-score"
        [class.academy-score-editor__mobile-score--absent]="isAbsent(row)"
        [class.academy-score-editor__mobile-score--fail]="row.score !== null && row.score < 60"
        [class.academy-score-editor__mobile-score--dirty]="isRowDirty(row)"
      >
        @if (isAbsent(row)) {
          缺考
        } @else if (row.score !== null) {
          {{ row.score }}
        } @else {
          未登錄
        }
      </span>
    </button>
  }
</div>
```

- [ ] **Step 2: academy-score-editor — 新增 Bottom Sheet (PrimeNG Drawer)**

Add to template:

```html
<p-drawer
  [(visible)]="sheetVisible"
  position="bottom"
  [modal]="true"
  styleClass="academy-score-editor__sheet"
>
  @if (sheetRow(); as row) {
    <ng-template #header>
      <div class="academy-score-editor__sheet-header">
        <span class="academy-score-editor__sheet-name">{{ row.studentName }}</span>
        <span class="academy-score-editor__sheet-grade">{{ formatGrade(row.studentGrade) }}</span>
      </div>
    </ng-template>

    <div class="academy-score-editor__sheet-body">
      <div class="academy-score-editor__sheet-field">
        <label class="academy-score-editor__sheet-label">分數 /{{ exam().totalScore }}</label>
        <p-inputnumber
          [ngModel]="row.score"
          (ngModelChange)="onScoreChange(row, $event)"
          [min]="0"
          [max]="exam().totalScore"
          [disabled]="disabled() || isAbsent(row)"
          styleClass="academy-score-editor__sheet-input"
        />
      </div>
      <div class="academy-score-editor__sheet-field">
        <label class="academy-score-editor__sheet-label">狀態</label>
        <p-select
          [options]="statusOptions"
          [ngModel]="row.status"
          (ngModelChange)="onStatusChange(row, $event)"
          optionLabel="label"
          optionValue="value"
          [disabled]="disabled()"
          styleClass="academy-score-editor__sheet-select"
        />
      </div>
      <div class="academy-score-editor__sheet-field">
        <label class="academy-score-editor__sheet-label">備註</label>
        <input
          type="text"
          pInputText
          [ngModel]="row.notes"
          (ngModelChange)="onNotesChange(row, $event)"
          [disabled]="disabled()"
          placeholder="輸入備註..."
          class="academy-score-editor__sheet-notes"
        />
      </div>
    </div>
  }
</p-drawer>
```

- [ ] **Step 3: academy-score-editor TS — 新增 sheet 邏輯**

```typescript
import { DrawerModule } from 'primeng/drawer';

// In imports array add: DrawerModule

// In component class:
protected sheetVisible = false;
protected readonly sheetRow = signal<ScoreRow | null>(null);

protected openSheet(row: ScoreRow): void {
  this.sheetRow.set(row);
  this.sheetVisible = true;
}
```

- [ ] **Step 4: academy-score-editor SCSS — 手機列表 + sheet 樣式**

Replace `&__card-list` and `&__card` related styles with:

```scss
&__mobile-list {
  display: none;
}

&__mobile-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: #fff;
  border: none;
  border-bottom: 1px solid var(--zinc-100);
  cursor: pointer;
  text-align: left;
  transition: background-color 150ms ease-out;

  &:hover {
    background: var(--zinc-50);
  }
}

&__mobile-info {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

&__mobile-name {
  font-weight: var(--font-medium);
  color: var(--zinc-800);
}

&__mobile-grade {
  font-size: var(--text-xs);
  color: var(--zinc-400);
}

&__mobile-score {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--sky-700, #0369a1);

  &--absent { color: var(--amber-500, #f59e0b); }
  &--fail { color: var(--red-600, #dc2626); }
  &--dirty { color: var(--sky-700, #0369a1); }
}

&__mobile-score:not([class*='--']) {
  color: var(--zinc-400);
}

&__sheet-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

&__sheet-name {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--zinc-900);
}

&__sheet-grade {
  font-size: var(--text-sm);
  color: var(--zinc-500);
}

&__sheet-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

&__sheet-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

&__sheet-label {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--zinc-500);
}

&__sheet-input,
&__sheet-select,
&__sheet-notes {
  width: 100%;
}

@media (max-width: 768px) {
  .academy-score-editor {
    &__table-wrap {
      display: none;
    }

    &__mobile-list {
      display: flex;
      flex-direction: column;
    }
  }
}
```

- [ ] **Step 5: term-score-editor — 同樣套用手機版列表 + sheet**

term-score-editor 的手機版 `__subject-cards` 也改為精簡列表 + sheet。邏輯類似但是科目 row（非學生 row），每個展開的學生下方的科目列表在手機版也改為點擊開 sheet。

```html
<!-- 在 student card 內，替換 __subject-cards -->
<div class="term-score-editor__mobile-subjects">
  @for (row of student.rows; track row.subjectId) {
    <button
      type="button"
      class="term-score-editor__mobile-subject-row"
      (click)="openSubjectSheet(row)"
    >
      <span class="term-score-editor__mobile-subject-name">{{ row.subjectName }}</span>
      <span
        class="term-score-editor__mobile-subject-score"
        [class.term-score-editor__mobile-subject-score--absent]="isAbsent(row)"
        [class.term-score-editor__mobile-subject-score--fail]="row.score !== null && row.score < 60"
      >
        @if (isAbsent(row)) {
          缺考
        } @else if (row.score !== null) {
          {{ row.score }}
        } @else {
          未登錄
        }
      </span>
    </button>
  }
</div>
```

Sheet 結構與 academy 版類似，但欄位是科目的分數/狀態/備註。

- [ ] **Step 6: 執行測試**

Run: `npx ng test --watch=false 2>&1 | tail -20`

- [ ] **Step 7: 視覺驗證**

在瀏覽器 DevTools 手機模式下：
1. 學生列表顯示為精簡列表
2. 點擊學生滑出 bottom sheet
3. 修改分數後列表即時更新
4. 關閉 sheet 回到列表

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/score-entry/
git commit -m "feat(web): mobile score editor — compact list with bottom sheet editing"
```

---

## Task 6: 考試管理手機版篩選 Dialog [Claude]

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/grades/exams/exams.component.scss`

- [ ] **Step 1: 新增手機版篩選按鈕和 dialog template**

在 `exams.component.html` 中，在 `__toolbar` 之前新增手機版工具列：

```html
<!-- Mobile toolbar: search + filter button -->
<div class="exams__mobile-toolbar">
  <div class="exams__search">
    <i class="pi pi-search exams__search-icon"></i>
    <input
      pInputText
      type="text"
      [ngModel]="searchText()"
      (ngModelChange)="onSearchChange($event)"
      placeholder="搜尋考試名稱..."
      class="exams__search-input"
    />
  </div>
  <p-button
    [label]="filterBadge()"
    icon="pi pi-filter"
    [outlined]="true"
    severity="secondary"
    size="small"
    (onClick)="filterDialogVisible = true"
  />
</div>

<p-dialog
  header="篩選條件"
  [(visible)]="filterDialogVisible"
  [modal]="true"
  [draggable]="false"
  [resizable]="false"
  styleClass="exams__filter-dialog"
  [style]="{ width: 'min(400px, 96vw)' }"
>
  <div class="exams__filter-dialog-body">
    <!-- 所有篩選元素 -->
    <div class="exams__filter-group">
      <label class="exams__filter-label">時間範圍</label>
      <p-selectbutton ... />
    </div>
    <div class="exams__filter-group">
      <label class="exams__filter-label">考試類型</label>
      <p-selectbutton ... />
    </div>
    <!-- 校區、科目、狀態 Select -->
  </div>

  <ng-template #footer>
    <div class="exams__filter-actions">
      <p-button label="清除" [text]="true" severity="secondary" (onClick)="clearFilters(); filterDialogVisible = false" />
      <p-button label="套用" (onClick)="filterDialogVisible = false" />
    </div>
  </ng-template>
</p-dialog>
```

- [ ] **Step 2: TS — 新增 dialog 狀態和 badge 計算**

```typescript
import { DialogModule } from 'primeng/dialog';

// Add to imports array: DialogModule

protected filterDialogVisible = false;

protected readonly filterBadge = computed(() => {
  let count = 0;
  if (this.timeRange() !== 'all') count++;
  if (this.examType() !== 'all') count++;
  if (this.campusId()) count++;
  if (this.subjectId()) count++;
  if (this.statusFilter() !== 'all') count++;
  return count > 0 ? `篩選 (${count})` : '篩選';
});
```

- [ ] **Step 3: SCSS — 手機版隱藏/顯示邏輯**

```scss
&__mobile-toolbar {
  display: none;
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--zinc-100);
  gap: var(--space-3);
  align-items: center;
}

@media (max-width: 768px) {
  .exams {
    &__mobile-toolbar {
      display: flex;
    }

    &__toolbar {
      display: none;
    }
  }
}

&__filter-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

&__filter-label {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--zinc-500);
}

&__filter-dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

&__filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
```

- [ ] **Step 4: 執行測試**

Run: `npx ng test --watch=false 2>&1 | tail -20`

- [ ] **Step 5: 視覺驗證**

手機模式：
1. 只看到搜尋框 + 篩選按鈕
2. 點篩選打開 dialog
3. 修改條件後點套用，dialog 關閉
4. 按鈕顯示「篩選 (N)」badge

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/exams/
git commit -m "feat(web): mobile exam filters — collapsible dialog with badge count"
```

---

## Task 7: 成績總覽路由重構 + 入口頁 [Claude]

**Files:**
- Modify: `apps/web/src/app/app.routes.ts:146-153`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/overview.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/overview.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/overview.component.scss`
- Modify: `apps/web/src/app/core/smart-enums/routes-catalog.ts` — 新增子路由常數

- [ ] **Step 1: 更新路由結構**

In `app.routes.ts`, replace the overview route with:

```typescript
{
  path: 'overview',
  children: [
    {
      path: '',
      loadComponent: () =>
        import('@features/admin/pages/grades/overview/overview.component').then(
          (m) => m.OverviewComponent,
        ),
      data: { page: RoutesCatalog.ADMIN_GRADES_OVERVIEW },
    },
    {
      path: 'student',
      loadComponent: () =>
        import('@features/admin/pages/grades/overview/student-view/student-view.component').then(
          (m) => m.StudentViewComponent,
        ),
      data: { page: RoutesCatalog.ADMIN_GRADES_OVERVIEW_STUDENT },
    },
    {
      path: 'class',
      loadComponent: () =>
        import('@features/admin/pages/grades/overview/class-view/class-view.component').then(
          (m) => m.ClassViewComponent,
        ),
      data: { page: RoutesCatalog.ADMIN_GRADES_OVERVIEW_CLASS },
    },
  ],
},
```

- [ ] **Step 2: 更新 routes-catalog**

新增 `ADMIN_GRADES_OVERVIEW_STUDENT` 和 `ADMIN_GRADES_OVERVIEW_CLASS` 到 RoutesCatalog。

- [ ] **Step 3: 改寫 overview.component 為入口頁**

Remove tab 切換（SelectButton），改為兩個大方塊：

```html
<div class="overview">
  <app-page-breadcrumb [items]="breadcrumbs" />

  <header class="overview__header">
    <h1 class="overview__title">成績總覽</h1>
    <p class="overview__subtitle">選擇檢視模式</p>
  </header>

  <div class="overview__portals">
    <button type="button" class="overview__portal" (click)="goTo('student')">
      <i class="pi pi-user overview__portal-icon"></i>
      <h2 class="overview__portal-title">學生視角</h2>
      <p class="overview__portal-desc">查看個別學生的成績走勢、科目摘要與歷次紀錄</p>
    </button>
    <button type="button" class="overview__portal" (click)="goTo('class')">
      <i class="pi pi-building overview__portal-icon"></i>
      <h2 class="overview__portal-title">班級視角</h2>
      <p class="overview__portal-desc">查看班級考試統計、排名與成績分布，按課程分組</p>
    </button>
  </div>
</div>
```

- [ ] **Step 4: SCSS — 入口頁方塊樣式**

```scss
&__portals {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-6);
}

&__portal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-6);
  background: #fff;
  border: 2px solid var(--zinc-200);
  border-radius: var(--radius-xl);
  cursor: pointer;
  text-align: center;
  transition: all 150ms ease-out;

  &:hover {
    border-color: var(--sky-300, #7dd3fc);
    background: var(--sky-50, #f0f9ff);
    box-shadow: var(--shadow-md);
  }

  &:focus-visible {
    outline: 2px solid var(--sky-500);
    outline-offset: 2px;
  }
}

&__portal-icon {
  font-size: var(--text-3xl);
  color: var(--sky-600, #0284c7);
}

&__portal-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--zinc-900);
}

&__portal-desc {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--zinc-500);
  line-height: var(--leading-relaxed);
}

@media (max-width: 768px) {
  .overview {
    &__portals {
      grid-template-columns: 1fr;
      gap: var(--space-4);
    }
  }
}
```

- [ ] **Step 5: TS — 移除 tab 切換邏輯，新增導航**

```typescript
@Component({ ... })
export class OverviewComponent {
  readonly page = input<RouteObj>();
  private readonly router = inject(Router);

  protected readonly breadcrumbs: BreadcrumbItem[] = [
    { label: '成績總覽' },
  ];

  protected goTo(view: 'student' | 'class'): void {
    this.router.navigate(['/admin/grades/overview', view]);
  }
}
```

Remove: `viewMode`, `viewOptions`, `viewGuide`, `VIEW_OPTIONS`, `VIEW_DESCRIPTIONS`, `onViewChange`。
Remove imports: `SelectButtonModule`, `StudentViewComponent`, `ClassViewComponent`, `FormsModule`。

- [ ] **Step 6: 執行測試**

Run: `npx ng test --watch=false 2>&1 | tail -20`

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/app.routes.ts apps/web/src/app/core/smart-enums/ apps/web/src/app/features/admin/pages/grades/overview/overview.component.*
git commit -m "feat(web): grades overview portal page with student/class sub-routes"
```

---

## Task 8: 學生視角重構 [Claude]

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/student-view/student-view.component.scss`

- [ ] **Step 1: 重構為獨立路由頁面**

改為完整頁面（含 breadcrumb、篩選列、學生列表 + 成績明細）。

TS — 主要變更：
```typescript
// 注入所需 services
private readonly studentsService = inject(StudentsService);
private readonly campusesService = inject(CampusesService);

// 新增 signals
protected readonly campusId = signal<string>('');
protected readonly gradeFilter = signal<string>('');
protected readonly searchText = signal('');
protected readonly studentList = signal<Student[]>([]);
protected readonly loadingList = signal(true);
protected readonly currentPage = signal(1);
protected readonly totalStudents = signal(0);

// breadcrumb
protected readonly breadcrumbs: BreadcrumbItem[] = [
  { label: '成績總覽', routerLink: '/admin/grades/overview' },
  { label: '學生視角' },
];

// 進場載入第一個分校的學生
ngOnInit(): void {
  this.campusesService.list().subscribe(({ data }) => {
    if (data.length > 0) {
      this.campusId.set(data[0].id);
      this.loadStudents();
    }
  });
}
```

- [ ] **Step 2: Template — 篩選列 + 學生列表**

```html
<div class="student-view">
  <app-page-breadcrumb [items]="breadcrumbs" />

  <div class="student-view__toolbar">
    <p-select
      [options]="campusOptions()"
      [ngModel]="campusId()"
      (ngModelChange)="onCampusChange($event)"
      optionLabel="label"
      optionValue="value"
      size="small"
      styleClass="student-view__campus-select"
    />
    <div class="student-view__search">
      <i class="pi pi-search student-view__search-icon"></i>
      <input
        pInputText
        type="text"
        [ngModel]="searchText()"
        (ngModelChange)="onSearchChange($event)"
        placeholder="搜尋學生姓名..."
        class="student-view__search-input"
      />
    </div>
    <p-select
      [options]="gradeOptions"
      [ngModel]="gradeFilter()"
      (ngModelChange)="onGradeChange($event)"
      optionLabel="label"
      optionValue="value"
      placeholder="全部年級"
      [showClear]="true"
      size="small"
    />
  </div>

  <!-- 學生列表 -->
  @if (loadingList()) {
    <div class="student-view__loading">...</div>
  } @else if (studentList().length === 0) {
    <app-empty-state ... />
  } @else {
    <div class="student-view__list">
      @for (s of studentList(); track s.id) {
        <button
          type="button"
          class="student-view__row"
          [class.student-view__row--active]="selectedStudent()?.id === s.id"
          (click)="selectStudent(s)"
        >
          <div class="student-view__row-info">
            <span class="student-view__row-name">{{ s.name }}</span>
            <span class="student-view__row-grade">{{ formatGrade(s.grade) }}</span>
          </div>
          <span class="student-view__row-meta">
            <!-- 顯示摘要，需要額外 API 或 inline 計算 -->
          </span>
        </button>
      }
    </div>
    <!-- 分頁 -->
  }

  <!-- 選中學生後的成績明細（沿用現有邏輯） -->
  @if (selectedStudent(); as student) {
    <!-- 科目摘要卡片 + 篩選 + 成績表格 -->
  }
</div>
```

- [ ] **Step 3: 載入學生邏輯**

```typescript
private loadStudents(): void {
  this.loadingList.set(true);
  this.studentsService.list({
    campusId: this.campusId(),
    grade: this.gradeFilter() || undefined,
    search: this.searchText() || undefined,
    searchScope: 'student_name',
    page: this.currentPage(),
    pageSize: 20,
  }).subscribe(({ data, meta }) => {
    this.studentList.set(data);
    this.totalStudents.set(meta.total);
    this.loadingList.set(false);
  });
}
```

- [ ] **Step 4: selectStudent — 載入成績明細**

```typescript
protected selectStudent(student: Student): void {
  // 如果點擊同一個學生，toggle 收合
  if (this.selectedStudent()?.id === student.id) {
    this.selectedStudent.set(null);
    return;
  }
  this.selectedStudent.set(student);
  this.loadScores(student.id);
  this.loadSummary(student.id);
}
```

- [ ] **Step 5: SCSS — 學生列表樣式**

新增 `__list`, `__row`, `__row--active`, `__row-info`, `__row-name`, `__row-grade`, `__row-meta` 等樣式。

- [ ] **Step 6: 執行測試 + 視覺驗證**

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/overview/student-view/
git commit -m "feat(web): student view — preloaded student list with campus filter"
```

---

## Task 9: 班級視角重構 [Claude]

**Files:**
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/class-view/class-view.component.ts`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/class-view/class-view.component.html`
- Modify: `apps/web/src/app/features/admin/pages/grades/overview/class-view/class-view.component.scss`

- [ ] **Step 1: 重構為獨立路由頁面 + 課程分組**

TS — 主要變更：
```typescript
private readonly coursesService = inject(CoursesService);
private readonly classesService = inject(ClassesService);
private readonly campusesService = inject(CampusesService);

protected readonly campusId = signal<string>('');
protected readonly searchText = signal('');
protected readonly courseGroups = signal<CourseGroup[]>([]);
protected readonly loadingGroups = signal(true);

interface CourseGroup {
  courseId: string;
  courseName: string;
  gradeRange: string; // e.g. "國一～國三"
  classes: ClassItem[];
}

interface ClassItem {
  id: string;
  name: string;
  studentCount: number;
  examCount: number;
}
```

- [ ] **Step 2: 載入課程 + 班級並分組**

```typescript
private loadGroups(): void {
  this.loadingGroups.set(true);
  // 先載入課程，再載入各課程下的班級
  this.coursesService.list({ campusId: this.campusId(), isActive: true, pageSize: 100 })
    .pipe(
      switchMap(({ data: courses }) => {
        if (courses.length === 0) return of([]);
        return forkJoin(
          courses.map(course =>
            this.classesService.list({
              courseId: course.id,
              campusId: this.campusId(),
              isActive: true,
              pageSize: 100,
            }).pipe(
              map(({ data: classes }) => ({
                courseId: course.id,
                courseName: course.name,
                gradeRange: this.formatGradeRange(course),
                classes: classes.map(c => ({
                  id: c.id,
                  name: c.name,
                  studentCount: c.activeEnrollmentCount ?? 0,
                  examCount: 0, // 可後續補充
                })),
              }))
            )
          )
        );
      }),
    )
    .subscribe(groups => {
      this.courseGroups.set(groups.filter(g => g.classes.length > 0));
      this.loadingGroups.set(false);
    });
}
```

- [ ] **Step 3: Template — 課程分組 + 班級列表**

```html
<div class="class-view">
  <app-page-breadcrumb [items]="breadcrumbs" />

  <div class="class-view__toolbar">
    <p-select ... campusId ... />
    <div class="class-view__search">
      <i class="pi pi-search class-view__search-icon"></i>
      <input ... searchText ... />
    </div>
  </div>

  @if (loadingGroups()) {
    <div class="class-view__loading">...</div>
  } @else if (filteredGroups().length === 0) {
    <app-empty-state ... />
  } @else {
    @for (group of filteredGroups(); track group.courseId) {
      <div class="class-view__course-group">
        <div class="class-view__course-header">
          <span class="class-view__course-name">{{ group.courseName }}</span>
          <span class="class-view__course-grades">{{ group.gradeRange }}</span>
        </div>
        <div class="class-view__class-list">
          @for (cls of group.classes; track cls.id) {
            <button
              type="button"
              class="class-view__class-row"
              [class.class-view__class-row--active]="selectedClassId() === cls.id"
              (click)="selectClass(cls)"
            >
              <div class="class-view__class-info">
                <span class="class-view__class-name">{{ cls.name }}</span>
                <span class="class-view__class-count">{{ cls.studentCount }} 人</span>
              </div>
              <i class="pi pi-chevron-right"></i>
            </button>
          }
        </div>
      </div>
    }
  }

  <!-- 選中班級後的考試統計（沿用現有邏輯） -->
  @if (selectedClassId()) {
    <!-- 考試選擇 + 統計 + 排名表 -->
  }
</div>
```

- [ ] **Step 4: SCSS — 課程分組樣式**

```scss
&__course-group {
  margin-bottom: var(--space-4);
}

&__course-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-bottom: 2px solid var(--sky-100, #e0f2fe);
  margin-bottom: var(--space-2);
}

&__course-name {
  font-weight: var(--font-semibold);
  color: var(--sky-700, #0369a1);
}

&__course-grades {
  font-size: var(--text-xs);
  color: var(--zinc-500);
}

&__class-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: var(--zinc-50);
  border: none;
  border-radius: var(--radius-md);
  margin-bottom: var(--space-1);
  cursor: pointer;
  text-align: left;
  transition: all 150ms ease-out;

  &:hover {
    background: var(--sky-50, #f0f9ff);
  }

  &--active {
    background: var(--sky-100, #e0f2fe);
    border-left: 3px solid var(--sky-500);
  }
}
```

- [ ] **Step 5: 執行測試 + 視覺驗證**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/features/admin/pages/grades/overview/class-view/
git commit -m "feat(web): class view — course-grouped layout with campus filter"
```

---

## 執行順序

```
Task 1 (Codex) ──┐
Task 2 (Codex) ──┼── 可平行執行
Task 3 (Codex) ──┘
                  ↓
Task 4 (Claude) ── FAB（依賴 Task 2 完成後的 SCSS）
Task 5 (Claude) ── Bottom Sheet（依賴 Task 1 的狀態名稱）
Task 6 (Claude) ── 篩選 Dialog（獨立）
                  ↓
Task 7 (Claude) ── 路由重構（先做，8/9 依賴新路由）
Task 8 (Claude) ── 學生視角
Task 9 (Claude) ── 班級視角
```

Tasks 1-3（Codex）和 Task 6（Claude）可以平行進行。
Tasks 4-5 在 Codex 完成後開始。
Tasks 7→8→9 按順序執行。
