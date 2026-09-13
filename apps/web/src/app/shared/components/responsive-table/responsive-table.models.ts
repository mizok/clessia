export interface ResponsiveTableColumn {
  readonly key: string;
  readonly label: string;
  readonly minWidth: number;
  readonly priority: number;
  readonly collapsible: boolean;
  /**
   * 這一欄是不是**這筆資料的身分**（#848）。主欄永遠不收合 —— 收掉它，列上就會剩下
   * 一排說不出是誰的數字（`/admin/fee-templates` 的 4,500 / 24,000 / 6,000）。
   *
   * **不給就是「宣告順序的第一個可收合欄」**，那是全 repo 的既有慣例，
   * 所以絕大多數表不需要標。要標的是慣例不成立的那些
   * （`/admin/contact-book` 第一欄是日期，而身分是學生）。
   *
   * 為什麼不用 `priority` 表達：priority 講「誰比較不重要」，主欄講「哪一欄是身分」。
   * 用同一個數字軸表達的下場就是 #848 —— `name` 與 `amount` 同為 1，
   * 平手時穩定排序讓先宣告的先被收掉，於是名稱走在定價前面。
   */
  readonly primary?: boolean;
}

export interface ResponsiveTableVisibilityResult {
  readonly visibleColumns: readonly ResponsiveTableColumn[];
  readonly collapsedColumns: readonly ResponsiveTableColumn[];
}

export type ResponsiveTableAccordionBehavior = 'multi' | 'accordion';

export type ResponsiveTableRowId = string | number;

export interface ResponsiveTableBodyState {
  readonly visibleColumns: () => readonly ResponsiveTableColumn[];
  readonly collapsedColumns: () => readonly ResponsiveTableColumn[];
  readonly hasCollapsedColumns: () => boolean;
  readonly isRowExpanded: (rowId: ResponsiveTableRowId) => boolean;
  readonly toggleRow: (rowId: ResponsiveTableRowId) => void;
}

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
