# Responsive Table

`ResponsiveTableComponent` 是一個 directive-first 的響應式表格容器，負責：

- 依容器寬度做欄位 collapse
- 自動插入展開控制欄（第一欄或最後一欄）
- 自動產生 detail row 顯示被 collapse 欄位
- 內建 PrimeNG paginator UI（外層控制狀態）

## Usage

```html
<app-responsive-table
  [headTemplate]="headTemplate"
  [bodyTemplate]="bodyTemplate"
  [pagination]="pagination()"
  accordionBehavior="multi"
  expandIcon="pi-chevron-right"
  collapseIcon="pi-chevron-down"
  expandControlPosition="start"
  (page)="onPage($event)"
/>

<ng-template #headTemplate>
  <tr>
    <th appRtColDef="name" [appRtColDefMinWidth]="160" [appRtColDefPriority]="1">姓名</th>
    <th appRtColDef="phone" [appRtColDefMinWidth]="160" [appRtColDefPriority]="2">電話</th>
    <th appRtColDef="address" [appRtColDefMinWidth]="220" [appRtColDefPriority]="3">地址</th>
  </tr>
</ng-template>

<ng-template #bodyTemplate let-state="state">
  @for (student of students(); track student.id) {
  <tr appRtRow [appRtRow]="student" [appRtRowId]="student.id">
    <td appRtColCell="name">{{ student.name }}</td>
    <td appRtColCell="phone">{{ student.phone }}</td>
    <td appRtColCell="address">{{ student.address }}</td>
  </tr>
  }
</ng-template>
```

## Inputs

- `headTemplate`: `TemplateRef`，必填
- `bodyTemplate`: `TemplateRef`，必填
- `pagination`: `ResponsiveTablePaginationConfig | null`
- `accordionBehavior`: `'multi' | 'accordion'`，預設 `multi`
- `expandIcon`: icon class，預設 `pi-chevron-right`
- `collapseIcon`: icon class，預設 `pi-chevron-down`
- `expandControlPosition`: `'start' | 'end'`，預設 `start`

## Outputs

- `page`: `ResponsiveTablePageEvent`（由 `p-paginator` 的 `onPageChange` 轉發）

## Pagination Contract

```ts
interface ResponsiveTablePaginationConfig {
  first: number;
  rows: number;
  totalRecords: number;
  rowsPerPageOptions?: readonly number[];
  showCurrentPageReport?: boolean;
  currentPageReportTemplate?: string;
  alwaysShow?: boolean;
}
```

- `pagination = null` 時不渲染 paginator。
- 元件不做資料切片，僅渲染分頁 UI 並透過 `page` 事件回傳新頁狀態。
- 未提供 `rowsPerPageOptions` 時，不顯示每頁筆數下拉選單。

## Directives

- `th[appRtColDef]`: 宣告欄位 metadata
- `td[appRtColCell]`: 標記 cell 對應的欄位 key
- `tr[appRtRow]`: 標記資料列，啟用展開控制與 detail row
