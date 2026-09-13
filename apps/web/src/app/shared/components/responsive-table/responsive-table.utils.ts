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

  // 主欄（#848）：明確標記的優先，否則就是**宣告順序的第一欄**。
  //
  // 用宣告順序而不是 `sortedColumns` 是刻意的 —— 後者已經按 priority 重排過，
  // 而「哪一欄是身分」是模板寫的順序決定的，不是重要性決定的。
  //
  // 第一欄若本來就不可收合（操作欄或選取欄排在最前面的那些表），
  // **這條規則什麼都不做** —— 它已經釘住了，再釘一根只會讓一個本該收合的欄留在列上。
  const primaryColumn = columns.find((column) => column.primary) ?? columns[0];

  const collapsibleInDescendingPriority = [...sortedColumns]
    .filter((column) => column.collapsible && column.key !== primaryColumn?.key)
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
