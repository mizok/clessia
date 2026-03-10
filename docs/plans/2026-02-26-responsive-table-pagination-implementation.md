# Responsive Table Pagination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不破壞 `headTemplate/bodyTemplate` 自由度的前提下，為 `app-responsive-table` 新增外層控制型、PrimeNG `p-table` 風格的完整 paginator。

**Architecture:** `ResponsiveTableComponent` 新增 `pagination` 狀態物件 input 與 `page` output，內部使用 PrimeNG `p-paginator` 僅負責 UI 與事件轉發，不切資料。`audit-log-dialog` 由舊的手寫上一頁/下一頁改接新 API，將分頁狀態統一為單一 computed 物件。

**Tech Stack:** Angular 21 Standalone + Signals、PrimeNG 21 Paginator、Vitest (NX test target)

---

### Task 1: 定義分頁契約型別

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.models.ts`

**Step 1: 先寫型別需求（無行為變更）**

```ts
export interface ResponsiveTablePaginationConfig {
  readonly first: number;
  readonly rows: number;
  readonly totalRecords: number;
  readonly rowsPerPageOptions?: readonly number[];
  readonly showCurrentPageReport?: boolean;
  readonly currentPageReportTemplate?: string;
  readonly alwaysShow?: boolean;
}

export interface ResponsiveTablePageEvent {
  readonly first: number;
  readonly rows: number;
  readonly page: number;
  readonly pageCount: number;
}
```

**Step 2: 驗證編譯沒有型別衝突**

Run: `npx nx test web -- --include='**/responsive-table.utils.spec.ts'`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/responsive-table.models.ts
git commit -m "feat: add responsive table pagination model contracts"
```

### Task 2: ResponsiveTable 元件接入 PrimeNG Paginator

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.ts`
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.html`

**Step 1: 先寫失敗測試（paginator 顯示與事件）**

在 `responsive-table.component.spec.ts` 新增：

```ts
it('renders paginator when pagination config is provided', () => {
  // Arrange host with pagination config
  // Assert query('.p-paginator') exists
});

it('emits page event when paginator changes page', () => {
  // Arrange
  // Trigger paginator onPageChange
  // Assert emitted payload equals first/rows/page/pageCount
});
```

**Step 2: 跑測試確認先失敗**

Run: `npx nx test web -- --include='**/responsive-table.component.spec.ts'`
Expected: FAIL（找不到 paginator 或 page emit）

**Step 3: 最小實作讓測試轉綠**

- 在 component imports 加入 PrimeNG paginator。
- 新增：
  - `pagination = input<ResponsiveTablePaginationConfig | null>(null)`
  - `page = output<ResponsiveTablePageEvent>()`
- 新增 `shouldShowPaginator` computed。
- 新增 `handlePageChange(event)`，轉發 `page.emit(...)`。
- template 在 table 下方渲染 `<p-paginator ... (onPageChange)="handlePageChange($event)" />`。

**Step 4: 再跑測試確認通過**

Run: `npx nx test web -- --include='**/responsive-table.component.spec.ts'`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/responsive-table.component.ts \
  apps/web/src/app/shared/components/responsive-table/responsive-table.component.html \
  apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts
git commit -m "feat: add external-state paginator support to responsive table"
```

### Task 3: 分頁切換時重置 detail 展開狀態

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.ts`
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts`

**Step 1: 增加失敗測試**

```ts
it('collapses expanded detail rows after page change', () => {
  // Expand first row
  // Emit/trigger page change
  // Assert no detail row remains
});
```

**Step 2: 跑測試確認失敗**

Run: `npx nx test web -- --include='**/responsive-table.component.spec.ts'`
Expected: FAIL（detail row 仍存在）

**Step 3: 最小實作**

在 `handlePageChange` 裡加上：

```ts
if (this.expandedRowIds().size > 0) {
  this.expandedRowIds.set(new Set());
}
```

**Step 4: 測試回歸**

Run: `npx nx test web -- --include='**/responsive-table*.spec.ts'`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/responsive-table.component.ts \
  apps/web/src/app/shared/components/responsive-table/responsive-table.component.spec.ts
git commit -m "fix: reset responsive table expanded rows on pagination change"
```

### Task 4: 套用 p-table 風格 paginator 樣式

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/responsive-table.component.scss`

**Step 1: 新增樣式區塊**

```scss
.responsive-table__paginator {
  .p-paginator {
    border-top: 1px solid var(--zinc-100);
    padding: var(--space-3) var(--space-4);
    background: var(--zinc-50);
  }
}
```

**Step 2: 跑單元測試確認無回歸**

Run: `npx nx test web -- --include='**/responsive-table*.spec.ts'`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/responsive-table.component.scss
git commit -m "style: align responsive table paginator with p-table visuals"
```

### Task 5: 將 Audit Log Dialog 改用新分頁 API

**Files:**
- Modify: `apps/web/src/app/shared/components/audit-log-dialog/audit-log-dialog.component.ts`
- Modify: `apps/web/src/app/shared/components/audit-log-dialog/audit-log-dialog.component.html`
- Modify: `apps/web/src/app/shared/components/audit-log-dialog/audit-log-dialog.component.scss`

**Step 1: 移除舊分頁控制失敗點（先改 template）**

- 移除舊 `prevPage()/nextPage()` 區塊。
- 在 `<app-responsive-table>` 綁定：

```html
[pagination]="pagination()"
(page)="onPage($event)"
```

**Step 2: 補齊 TS 分頁狀態**

- 新增 `pageSize` signal（預設 30）。
- 新增 `pagination` computed。
- 新增 `onPage(event)`：
  - 更新 `pageSize` = `event.rows`
  - 更新 `page` = `event.page + 1`
  - 呼叫 `loadPage()`
- `loadPage()` 改用 `pageSize()`。

**Step 3: 清理不再需要的舊方法**

- 刪除 `isFirstPage/isLastPage` computed
- 刪除 `prevPage()/nextPage()`
- SCSS 移除 `.audit-log-dialog__pagination` 與 `.audit-log-dialog__page-info`（若確定未使用）

**Step 4: 驗證（至少 smoke）**

Run: `npx nx test web -- --include='**/responsive-table*.spec.ts'`
Expected: PASS

Run: `npx nx build web --configuration=development`
Expected: 若環境可編譯則 PASS；若失敗需記錄錯誤與是否既有問題

**Step 5: Commit**

```bash
git add apps/web/src/app/shared/components/audit-log-dialog/audit-log-dialog.component.ts \
  apps/web/src/app/shared/components/audit-log-dialog/audit-log-dialog.component.html \
  apps/web/src/app/shared/components/audit-log-dialog/audit-log-dialog.component.scss
git commit -m "refactor: migrate audit log dialog to responsive table paginator api"
```

### Task 6: 文件與收尾

**Files:**
- Modify: `apps/web/src/app/shared/components/responsive-table/README.md`

**Step 1: 更新 README 範例與 API 說明**

新增 `pagination`/`page` 用法範例，並說明「外層控制，不做資料切片」。

**Step 2: 最終驗證**

Run: `npx nx test web -- --include='**/responsive-table*.spec.ts'`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/app/shared/components/responsive-table/README.md
git commit -m "docs: describe responsive table pagination api and usage"
```
