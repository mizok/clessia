import type {
  ResponsiveTableColumn,
  ResponsiveTableVisibilityResult,
} from './responsive-table.models';

export function computeColumnVisibility(
  columns: readonly ResponsiveTableColumn[],
  containerWidth: number,
  expandControlWidth: number,
): ResponsiveTableVisibilityResult {
  if (columns.length === 0) {
    return {
      visibleColumns: [],
      collapsedColumns: [],
    };
  }

  const sortedColumns = [...columns].sort((left, right) => left.priority - right.priority);
  const visibleColumns = [...sortedColumns];
  const collapsedColumns: ResponsiveTableColumn[] = [];

  const getTotalWidth = (): number =>
    visibleColumns.reduce((total, column) => total + column.minWidth, 0) +
    (collapsedColumns.length > 0 ? expandControlWidth : 0);

  const collapsibleInDescendingPriority = [...sortedColumns]
    .filter((column) => column.collapsible)
    .sort((left, right) => right.priority - left.priority);

  for (const column of collapsibleInDescendingPriority) {
    if (getTotalWidth() <= containerWidth) {
      break;
    }

    const visibleIndex = visibleColumns.findIndex((current) => current.key === column.key);
    if (visibleIndex === -1) {
      continue;
    }

    visibleColumns.splice(visibleIndex, 1);
    collapsedColumns.push(column);
  }

  collapsedColumns.sort((left, right) => left.priority - right.priority);

  return {
    visibleColumns,
    collapsedColumns,
  };
}
