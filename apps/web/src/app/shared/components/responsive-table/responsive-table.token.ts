import { InjectionToken } from '@angular/core';
import type { ResponsiveTableColumn, ResponsiveTableRowId } from './responsive-table.models';

export interface ResponsiveTableController {
  upsertColumn(definitionId: string, column: ResponsiveTableColumn): void;
  removeColumn(definitionId: string): void;
  isColumnVisible(columnKey: string): boolean;
  hasCollapsedColumns(): boolean;
  getCollapsedColumns(): readonly ResponsiveTableColumn[];
  toggleRow(rowId: ResponsiveTableRowId): void;
  isRowExpanded(rowId: ResponsiveTableRowId): boolean;
  getExpandIconClass(rowId: ResponsiveTableRowId): string;
  getExpandControlPosition(): 'start' | 'end';
}

export const RESPONSIVE_TABLE = new InjectionToken<ResponsiveTableController>('RESPONSIVE_TABLE');
