# Responsive Table Pagination Design

日期：2026-02-26

## 背景與目標

目前 `app-responsive-table` 已支援欄位自動 collapse、row detail 展開與自訂 `headTemplate/bodyTemplate`。

本次目標是新增「類似 PrimeNG `p-table` 的 paginator 體驗」，但維持既有核心原則：

1. 外層控制資料來源與切頁（不在 table 內做資料切片）。
2. body `td` 內容保留完全自由（含互動事件）。
3. API 一致且不鬆散，採「狀態物件」而非大量平鋪 input。

## 已確認決策

1. 分頁模式：`外層控制`。
2. 功能範圍：`完整對齊 p-table`（含 rows per page、頁碼、first/last、current report）。
3. 分頁 UI：使用 PrimeNG `<p-paginator>`。
4. API 風格：`狀態物件版`。

## 設計方案

### 1) 元件 API

`ResponsiveTableComponent` 新增：

- `pagination: ResponsiveTablePaginationConfig | null`（`null` 表示不渲染 paginator）
- `page: Output<ResponsiveTablePageEvent>`（轉發 paginator 的 page event）

`ResponsiveTablePaginationConfig`：

- `first: number`
- `rows: number`
- `totalRecords: number`
- `rowsPerPageOptions?: readonly number[]`
- `showCurrentPageReport?: boolean`
- `currentPageReportTemplate?: string`
- `alwaysShow?: boolean`

`ResponsiveTablePageEvent`：

- `first: number`
- `rows: number`
- `page: number`
- `pageCount: number`

### 2) 渲染結構

`responsive-table.component.html` 結構調整為：

1. 既有 `table` 區塊保持不變。
2. 在 table 區塊下方新增 paginator 區塊（`p-paginator`）。
3. paginator 顯示條件：
   - `pagination !== null` 且
   - `alwaysShow === true` 或 `totalRecords > rows`

### 3) 行為規則

1. `ResponsiveTableComponent` 不做資料切片。
2. 監聽 `p-paginator` 的 `onPageChange`，轉成 `page.emit(event)`。
3. 任何 page 事件觸發時，清空 `expandedRowIds`，避免跨頁殘留 detail 展開狀態。
4. 欄位 collapse 規則不變（僅依容器寬度 + col metadata 決定）。

### 4) 樣式對齊策略

目標是貼近專案現有 `p-table` paginator 視覺：

- 在 `responsive-table.component.scss` 新增 `.responsive-table__paginator` 區塊。
- 對其下 `.p-paginator` 套用一致規則：
  - `border-top: 1px solid var(--zinc-100)`
  - `padding: var(--space-3) var(--space-4)`
  - `background: var(--zinc-50)`

其餘細節沿用 PrimeNG 內建樣式，不重造 pager 按鈕。

## Audit Log Dialog 遷移藍圖

`audit-log-dialog` 由現行「手寫上一頁/下一頁」改為 table 內建 paginator：

1. 新增 `pageSize` signal（初始 30）。
2. 新增 `pagination` computed（從 `page/total/pageSize` 推導 `first/rows/totalRecords`）。
3. `<app-responsive-table>` 綁 `[pagination]="pagination()"` 並接 `(page)="onPage($event)"`。
4. 移除原本 `prevPage()/nextPage()` 的 template controls。
5. `onPage` 內更新 `page` 與 `pageSize`，再呼叫 `loadPage()`。

## 風險與對策

1. API 回來前 `totalRecords=0`，paginator 瞬間隱藏。
- 對策：依 `alwaysShow` 決定，預設不強制顯示。

2. 使用者切換 rows 時，頁索引計算錯誤。
- 對策：以 `event.first` 與 `event.rows` 反推 page，不依賴舊 page 狀態。

3. 分頁切換後 detail row 仍殘留。
- 對策：page event 時清空 `expandedRowIds`。

## 測試策略

1. `responsive-table.component.spec.ts`：
- `pagination=null` 不渲染 paginator。
- `pagination` 有值時渲染 paginator。
- `onPageChange` 事件會正確 emit。
- page event 後展開狀態重置。

2. `audit-log-dialog`：
- 既有行為 smoke 驗證（人工）：
  - 分頁可切換
  - rows per page 可切換
  - 請求參數正確
  - collapse/detail 與分頁並存正常

## 不做事項（YAGNI）

1. 不在 `ResponsiveTableComponent` 內做 client-side 資料切片。
2. 不做自製 paginator（避免重複 PrimeNG 能力）。
3. 不做雙命名 API（避免維護負擔）。
