# Responsive Table

`ResponsiveTableComponent` 是一個 directive-first 的響應式表格容器，負責：

- 依容器寬度做欄位 collapse
- 自動插入展開控制欄（第一欄或最後一欄）
- 自動產生 detail row 顯示被 collapse 欄位
- 內建分頁器（共用的 A6 精簡版 `app-pager`，#1314 Z 批；外層控制狀態）

## Usage

```html
<app-responsive-table
  [headTemplate]="headTemplate"
  [bodyTemplate]="bodyTemplate"
  [pagination]="pagination()"
  accordionBehavior="multi"
  expandIcon="pi-chevron-right"
  collapseIcon="pi-chevron-down"
  expandControlPosition="end"
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
- `expandControlPosition`: `'start' | 'end'`，預設 `end`（#2007：照 A6，小箭頭在最右；整列可點）

## Outputs

- `page`: `ResponsiveTablePageEvent`（`app-pager` 發的是 1 起算頁碼，元件轉成 `{ first, rows, page（0 起算）, pageCount }`，沿用 PrimeNG 時代的契約）

## Pagination Contract

```ts
interface ResponsiveTablePaginationConfig {
  first: number;
  rows: number;
  totalRecords: number;
  unit?: string; // 精簡版的「· 每頁 N <unit>」，不給就不寫
}
```

- `pagination = null`、或只有一頁時不渲染分頁器。
- 元件不做資料切片，僅渲染分頁 UI 並透過 `page` 事件回傳新頁狀態。
- 沒有「每頁筆數」選單（A6 的分頁器沒有；產生課堂預覽原本有，已拿掉，R5）。

## Directives

- `th[appRtColDef]`: 宣告欄位 metadata
- `td[appRtColCell]`: 標記 cell 對應的欄位 key
- `tr[appRtRow]`: 標記資料列，啟用展開控制與 detail row
