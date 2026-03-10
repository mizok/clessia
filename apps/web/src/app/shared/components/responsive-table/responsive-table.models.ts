export interface ResponsiveTableColumn {
  readonly key: string;
  readonly label: string;
  readonly minWidth: number;
  readonly priority: number;
  readonly collapsible: boolean;
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
