# Responsive Table Directive-First Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `apps/web` 實作一個 directive-first 的 responsive table（不使用 `rows` input），支援 by-column collapse、自動展開控制欄（icon）與自動 detail row。

**Architecture:** 以 `ResponsiveTableComponent` 作為容器，負責寬度監聽、欄位可見性計算與列展開狀態。透過 `appRtColDef`、`appRtColCell`、`*appRtRow` 三個 directive 建立語意標記，並由 component 在模板層完成可見/收合渲染。演算法與驗證邏輯盡量抽成純函式，先寫失敗測試再補最小實作。

**Tech Stack:** Angular 21 Standalone、Signals、TemplateRef/ViewContainerRef、Vitest（Angular unit test）、SCSS(BEM)

---

### Task 1: 建立檔案骨架（CLI）與空測試入口

**Files:**
- Create: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.ts`
- Create: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.html`
- Create: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.scss`
- Create: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts`
- Create: `apps/web/src/app/shared/components/responsive-table/rt-col-def.directive.ts`
- Create: `apps/web/src/app/shared/components/responsive-table/rt-col-cell.directive.ts`
- Create: `apps/web/src/app/shared/components/responsive-table/rt-row.directive.ts`
- Create: `apps/web/src/app/shared/components/responsive-table/responsive-table.models.ts`
- Create: `apps/web/src/app/shared/components/responsive-table/responsive-table.utils.ts`
- Create: `apps/web/src/app/shared/components/responsive-table/responsive-table.utils.spec.ts`

**Step 1: 用 CLI 建立元件**

```bash
npx ng g c shared/components/responsive-table --project web --standalone --type component --style scss
```

**Step 2: 手動建立 directive/model/util 檔案（先放最小內容）**

```ts
// rt-col-def.directive.ts
export class RtColDefDirective {}
```

**Step 3: 確認檔案存在**

Run: `rg --files apps/web/src/app/shared/components/responsive-table`
Expected: 列出上述所有檔案

**Step 4: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table
git commit -m "chore: scaffold responsive table component and directives"
```

### Task 2: 先寫 collapse 演算法失敗測試（純函式）

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.utils.spec.ts`
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.models.ts`
- Test: `apps/web/src/app/shared/components/responsive-table/responsive-table.utils.spec.ts`

**Step 1: 寫 fail tests（欄位排序與折疊）**

```ts
it('keeps high-priority columns visible first', () => {
  const result = computeColumnVisibility(columns, 320, 40);
  expect(result.visibleColumns.map((c) => c.key)).toEqual(['name', 'grade']);
  expect(result.collapsedColumns.map((c) => c.key)).toEqual(['phone', 'address']);
});
```

**Step 2: 驗證目前會失敗**

Run: `npx nx test web -- --include='**/responsive-table.utils.spec.ts'`
Expected: FAIL（`computeColumnVisibility` 尚未實作）

**Step 3: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/responsive-table.utils.spec.ts apps/web/src/app/shared/components/responsive-table/responsive-table.models.ts
git commit -m "test: add failing tests for responsive table column collapse logic"
```

### Task 3: 實作 collapse 演算法讓測試通過

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.utils.ts`
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.models.ts`
- Test: `apps/web/src/app/shared/components/responsive-table/responsive-table.utils.spec.ts`

**Step 1: 寫最小可用實作**

```ts
export function computeColumnVisibility(
  columns: readonly ResponsiveTableColumn[],
  containerWidth: number,
  expandControlWidth: number,
): ResponsiveTableVisibilityResult {
  // sort by priority asc, then collapse from lowest-priority collapsible columns
}
```

**Step 2: 重新跑單測確認通過**

Run: `npx nx test web -- --include='**/responsive-table.utils.spec.ts'`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/responsive-table.utils.ts apps/web/src/app/shared/components/responsive-table/responsive-table.models.ts
git commit -m "feat: implement responsive table column visibility algorithm"
```

### Task 4: 先寫 directive 與驗證邏輯失敗測試

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts`
- Test: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts`

**Step 1: 建測試 host component（含 head/body template）**

```ts
@Component({
  template: `
    <app-responsive-table [headTemplate]="head" [bodyTemplate]="body">
    </app-responsive-table>
    <ng-template #head>...</ng-template>
    <ng-template #body let-state="state">...</ng-template>
  `,
})
class HostComponent {}
```

**Step 2: 新增 fail tests**

```ts
it('throws when duplicate column keys are defined', () => {
  expect(() => fixture.detectChanges()).toThrowError(/duplicate column key/i);
});
```

**Step 3: 跑測試確認失敗**

Run: `npx nx test web -- --include='**/responsive-table.component.spec.ts'`
Expected: FAIL（驗證尚未實作）

**Step 4: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts
git commit -m "test: add failing validation tests for responsive table directives"
```

### Task 5: 實作三個 directives 與 metadata 收集

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/rt-col-def.directive.ts`
- Modify: `apps/web/src/app/shared/components/responsive-table/rt-col-cell.directive.ts`
- Modify: `apps/web/src/app/shared/components/responsive-table/rt-row.directive.ts`
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.ts`
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.models.ts`
- Test: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts`

**Step 1: 完成 directive inputs 與 query token**

```ts
@Directive({ selector: 'th[appRtColDef]' })
export class RtColDefDirective {
  readonly key = input.required<string>({ alias: 'appRtColDef' });
  readonly minWidth = input.required<number>({ alias: 'appRtColDefMinWidth' });
  readonly priority = input.required<number>({ alias: 'appRtColDefPriority' });
  readonly collapsible = input(true, { alias: 'appRtColDefCollapsible' });
}
```

**Step 2: 在 component 中收集並驗證 metadata**

```ts
protected readonly colDefs = contentChildren(RtColDefDirective, { descendants: true });
```

**Step 3: 跑測試確認 validation 測試通過**

Run: `npx nx test web -- --include='**/responsive-table.component.spec.ts'`
Expected: PASS（至少 duplicate/minWidth/priority 驗證通過）

**Step 4: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/rt-col-def.directive.ts apps/web/src/app/shared/components/responsive-table/rt-col-cell.directive.ts apps/web/src/app/shared/components/responsive-table/rt-row.directive.ts apps/web/src/app/shared/components/responsive-table/responsive-table.component.ts apps/web/src/app/shared/components/responsive-table/responsive-table.models.ts
git commit -m "feat: add responsive table directives and column metadata validation"
```

### Task 6: 寫展開行為與 detail row 的失敗測試

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts`
- Test: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts`

**Step 1: 新增 multi/accordion 兩種展開行為測試**

```ts
it('supports multi row expansion when accordionBehavior is multi', () => {
  // click row A and row B
  // expect both details rendered
});

it('keeps only one expanded row when accordionBehavior is accordion', () => {
  // click row A then row B
  // expect row A detail collapsed
});
```

**Step 2: 新增 icon 與位置測試**

```ts
it('renders expand icon column at start by default', () => {
  // expect first cell contains pi-chevron-right
});
```

**Step 3: 跑測試確認失敗**

Run: `npx nx test web -- --include='**/responsive-table.component.spec.ts'`
Expected: FAIL（展開與 icon 行為尚未實作）

**Step 4: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts
git commit -m "test: add failing tests for responsive table expand and detail behaviors"
```

### Task 7: 實作 component template/state（含自動 icon 欄與 detail row）

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.ts`
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.html`
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.scss`
- Test: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts`

**Step 1: 實作狀態與 API**

```ts
readonly accordionBehavior = input<'multi' | 'accordion'>('multi');
protected readonly visibleColumns = signal<readonly ResponsiveTableColumn[]>([]);
protected readonly collapsedColumns = signal<readonly ResponsiveTableColumn[]>([]);
protected readonly expandedRowIds = signal<ReadonlySet<string | number>>(new Set());
```

**Step 2: 實作 ResizeObserver 與重算流程**

```ts
private setupResizeObserver(): void {
  // observe host/container width, recompute visibility
}
```

**Step 3: 在 HTML 實作**

```html
<table class="responsive-table">
  <thead>...</thead>
  <tbody>
    <!-- render projected rows -->
    <!-- auto render expand control icon -->
    <!-- auto render detail rows for collapsed columns -->
  </tbody>
</table>
```

**Step 4: SCSS 套用 BEM 與 tokens**

```scss
.responsive-table__expand-button { ... }
.responsive-table__detail { ... }
```

**Step 5: 跑 component 測試**

Run: `npx nx test web -- --include='**/responsive-table.component.spec.ts'`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/responsive-table.component.ts apps/web/src/app/shared/components/responsive-table/responsive-table.component.html apps/web/src/app/shared/components/responsive-table/responsive-table.component.scss
git commit -m "feat: implement responsive table rendering with auto expand control and detail rows"
```

### Task 8: 補齊範例與回歸驗證

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts`
- Modify: `docs/plans/2026-02-26-responsive-table-directive-design.md`（若有 API 微調需同步）

**Step 1: 加入一個實際使用範例測試（自由 td 內容）**

```ts
it('allows arbitrary custom td content with appRtColCell marker', () => {
  // includes links, badge component, button
  // expect content still works when collapsed/expanded
});
```

**Step 2: 跑 responsive-table 全部測試**

Run: `npx nx test web -- --include='**/responsive-table*.spec.ts'`
Expected: PASS

**Step 3: 跑 web 全測（最終驗證）**

Run: `npx nx test web`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table docs/plans/2026-02-26-responsive-table-directive-design.md
git commit -m "test: finalize responsive table coverage and docs alignment"
```

### Task 9: 產出使用說明（避免誤用）

**Files:**
- Create: `apps/web/src/app/shared/components/responsive-table/README.md`

**Step 1: 寫最小可用範例與錯誤案例**

```md
- 正確：`th[appRtColDef]` 定義 metadata，一次定義即可
- 正確：`td[appRtColCell]` 僅標記 key，內容自由
- 錯誤：重複 key / 缺少 minWidth / priority 非數字
```

**Step 2: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/README.md
git commit -m "docs: add responsive table usage guide"
```
