# Responsive Table Directive-First 設計稿

日期：2026-02-26  
狀態：已確認，可進入 implementation plan

## 1. 目標與範圍

建立一個可重用的 Angular shared table 元件，支援：

- 欄位依視窗寬度自動「by-column collapse」
- 展開按鈕欄位可自動產生、可放第一欄、使用 icon
- 被 collapse 欄位的 detail row 可自動產生
- 使用者可自訂 cell 內容（不限制 td 內容格式）
- 不使用 `rows` input（資料迴圈由使用者在外層提供）

不在本次範圍：

- 伺服器分頁/排序/過濾
- 欄位拖曳重排
- 虛擬滾動

## 2. 設計原則

- 元件負責「狀態與行為」：欄位可見性、展開狀態、detail 生成
- 使用者負責「資料來源」：外層 `@for` 或逐列模板提供 row
- 以 Angular 模板機制為主，不採手動 append DOM
- 優先使用 signals 與 template directive 做 declarative UI

## 3. 元件與指令 API

## 3.1 元件

`app-responsive-table`（Standalone Component）

Inputs：

- `headTemplate`（必填）：表頭模板（`<thead>` 內容）
- `bodyTemplate`（必填）：表身模板（`<tbody>` 內容）
- `accordionBehavior`: `'multi' | 'accordion'`（預設 `'multi'`）
- `expandIcon`: string（預設 `pi pi-chevron-right`）
- `collapseIcon`: string（預設 `pi pi-chevron-down`）
- `expandControlPosition`: `'start' | 'end'`（預設 `'start'`）

## 3.2 欄位定義指令

`th[appRtColDef]`

- `appRtColDef`: 欄位 key（必填）
- `appRtColDefLabel`: 顯示名稱（可選，預設 th 文字）
- `appRtColDefMinWidth`: number（必填）
- `appRtColDefPriority`: number（必填，越小越重要）
- `appRtColDefCollapsible`: boolean（預設 `true`）

## 3.3 Cell 標記指令

`td[appRtColCell]`

- `appRtColCell`: 對應欄位 key（必填）
- `td` 內容完全自由（文字、按鈕、badge、自訂元件皆可）

## 3.4 Row 結構指令

`*appRtRow`

- 用途：標記一筆資料列，讓元件可自動補展開控制與 detail row
- Microsyntax（草案）：`*appRtRow="let row; id: rowId"`
- `id` 用於追蹤該列展開狀態

## 4. 資料流與渲染流程

1. 元件初始化後，從 `headTemplate` 收集所有 `appRtColDef` metadata。
2. 使用 `ResizeObserver` 監聽容器寬度，計算 `visibleColumns`/`collapsedColumns`。
3. 使用者在外層提供 row（`@for` 或逐筆模板），並在列上加 `*appRtRow`。
4. 元件依 collapse 狀態：
- 自動在第一欄或最後一欄渲染展開 icon 控制
- 在 row 後自動插入 detail row（包含 collapsed 欄位）
5. `accordionBehavior` 控制展開策略：
- `multi`：可同時展開多筆
- `accordion`：同時僅一筆展開

## 5. 欄位 collapse 演算法

1. 依 `priority`（小到大）排序保留優先級。
2. 計算總需求寬度（`sum(minWidth)` + 固定控制欄寬度）。
3. 若超出容器寬度，從最低優先、且 `collapsible=true` 欄位開始折疊。
4. 重複直到可容納，或已無可折疊欄位。
5. 輸出 `visibleColumns` 與 `collapsedColumns` signals。

## 6. 驗證與錯誤處理

啟動或資料變動時做 runtime 檢查：

- 欄位 key 重複：throw error
- `minWidth <= 0`：throw error
- `priority` 非有限數字：throw error
- `td[appRtColCell]` 找不到對應 `appRtColDef`：dev warning
- `*appRtRow` 的 `id` 重複：dev warning（展開狀態以最後一次為準）

## 7. 樣式與可用性

- 採 BEM 命名（`responsive-table__...`）
- 使用 design token（`--space-*`, `--zinc-*`）
- 展開按鈕使用 PrimeIcons class，提供 `aria-label`
- detail row 以 definition-like 結構呈現（label/value）

## 8. 測試策略

單元測試重點：

- 寬度縮放時欄位 collapse 結果正確
- `accordionBehavior='multi'` 可多列展開
- `accordionBehavior='accordion'` 僅單列展開
- metadata 變動觸發重新計算
- 錯誤輸入可正確拋錯/警告

整合測試重點：

- row 與 detail row 生成順序正確
- icon 依展開狀態切換
- `expandControlPosition` 為 start/end 時欄位位置正確

## 9. 取捨與結論

最終採「directive-first + no rows input + `*appRtRow`」：

- 保留使用者對 cell 內容的完全自由
- 同時讓元件集中處理 collapse/expand 複雜度
- 避免手動 DOM append 帶來的生命週期與相容性風險
