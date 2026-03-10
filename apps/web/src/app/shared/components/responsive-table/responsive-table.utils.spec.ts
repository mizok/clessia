import { describe, expect, it } from 'vitest';
import { computeColumnVisibility } from './responsive-table.utils';
import type { ResponsiveTableColumn } from './responsive-table.models';

describe('computeColumnVisibility', () => {
  const columns: readonly ResponsiveTableColumn[] = [
    { key: 'name', label: '姓名', minWidth: 160, priority: 1, collapsible: false },
    { key: 'grade', label: '年級', minWidth: 120, priority: 2, collapsible: true },
    { key: 'phone', label: '電話', minWidth: 160, priority: 3, collapsible: true },
    { key: 'address', label: '地址', minWidth: 220, priority: 4, collapsible: true },
  ];

  it('keeps all columns when container width is enough', () => {
    const result = computeColumnVisibility(columns, 900, 40);

    expect(result.visibleColumns.map((column) => column.key)).toEqual([
      'name',
      'grade',
      'phone',
      'address',
    ]);
    expect(result.collapsedColumns).toEqual([]);
  });

  it('collapses lowest-priority collapsible columns first', () => {
    const result = computeColumnVisibility(columns, 470, 40);

    expect(result.visibleColumns.map((column) => column.key)).toEqual(['name', 'grade']);
    expect(result.collapsedColumns.map((column) => column.key)).toEqual(['phone', 'address']);
  });

  it('preserves all non-collapsible columns even when width is insufficient', () => {
    const columns: readonly ResponsiveTableColumn[] = [
      { key: 'name', label: '姓名', minWidth: 260, priority: 1, collapsible: false },
      { key: 'class', label: '班級', minWidth: 240, priority: 2, collapsible: false },
      { key: 'phone', label: '電話', minWidth: 160, priority: 3, collapsible: true },
    ];

    const result = computeColumnVisibility(columns, 120, 40);

    expect(result.visibleColumns.map((column) => column.key)).toEqual(['name', 'class']);
    expect(result.collapsedColumns.map((column) => column.key)).toEqual(['phone']);
  });
});
