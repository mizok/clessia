import {
  DestroyRef,
  Directive,
  ElementRef,
  HostBinding,
  Renderer2,
  effect,
  inject,
  input,
} from '@angular/core';
import type { ResponsiveTableRowId } from './responsive-table.models';
import { RESPONSIVE_TABLE } from './responsive-table.token';

@Directive({
  selector: 'tr[appRtRow]',
})
export class RtRowDirective {
  private readonly destroyRef = inject(DestroyRef);
  private readonly renderer = inject(Renderer2);
  private readonly rowRef = inject<ElementRef<HTMLTableRowElement>>(ElementRef);
  private readonly table = this.resolveTable();

  readonly rowData = input<unknown>(undefined, { alias: 'appRtRow' });
  readonly rowId = input.required<ResponsiveTableRowId>({ alias: 'appRtRowId' });

  private expandCell: HTMLTableCellElement | null = null;
  private expandButton: HTMLButtonElement | null = null;
  private expandIconElement: HTMLElement | null = null;
  private detailRow: HTMLTableRowElement | null = null;
  private detailCell: HTMLTableCellElement | null = null;
  private removeClickListener: (() => void) | null = null;
  private readonly movedNodesByColumn = new Map<string, readonly Node[]>();

  @HostBinding('class.responsive-table__row')
  protected readonly rowClass = true;

  constructor() {
    effect(() => {
      const rowId = this.rowId();
      const hasCollapsedColumns = this.table.hasCollapsedColumns();
      const isExpanded = this.table.isRowExpanded(rowId);
      const position = this.table.getExpandControlPosition();

      if (hasCollapsedColumns) {
        this.ensureExpandControlCell();
        this.placeExpandControlCell(position);
        this.syncExpandIcon(rowId, isExpanded);
      } else {
        this.removeExpandControlCell();
      }

      if (hasCollapsedColumns && isExpanded) {
        this.ensureDetailRow();
        this.syncDetailContent();
      } else {
        this.removeDetailRow();
      }
    });

    this.destroyRef.onDestroy(() => {
      this.removeExpandControlCell();
      this.removeDetailRow();
    });
  }

  private ensureExpandControlCell(): void {
    if (this.expandCell && this.expandButton && this.expandIconElement) {
      return;
    }

    const expandCell = this.renderer.createElement('td') as HTMLTableCellElement;
    this.renderer.addClass(expandCell, 'responsive-table__expand-cell');

    const expandButton = this.renderer.createElement('button') as HTMLButtonElement;
    this.renderer.setAttribute(expandButton, 'type', 'button');
    this.renderer.addClass(expandButton, 'responsive-table__expand-button');

    const iconElement = this.renderer.createElement('i') as HTMLElement;
    this.renderer.addClass(iconElement, 'pi');
    this.renderer.addClass(iconElement, 'responsive-table__expand-icon');

    this.renderer.appendChild(expandButton, iconElement);
    this.renderer.appendChild(expandCell, expandButton);

    this.removeClickListener = this.renderer.listen(expandButton, 'click', () => {
      this.table.toggleRow(this.rowId());
    });

    this.expandCell = expandCell;
    this.expandButton = expandButton;
    this.expandIconElement = iconElement;
  }

  private placeExpandControlCell(position: 'start' | 'end'): void {
    if (!this.expandCell) {
      return;
    }

    const rowElement = this.rowRef.nativeElement;
    if (position === 'start') {
      if (rowElement.firstChild !== this.expandCell) {
        this.renderer.insertBefore(rowElement, this.expandCell, rowElement.firstChild);
      }
      return;
    }

    if (rowElement.lastChild !== this.expandCell) {
      this.renderer.appendChild(rowElement, this.expandCell);
    }
  }

  private syncExpandIcon(rowId: ResponsiveTableRowId, isExpanded: boolean): void {
    if (!this.expandButton || !this.expandIconElement) {
      return;
    }

    const iconClass = this.table.getExpandIconClass(rowId);
    this.expandIconElement.className = `pi responsive-table__expand-icon ${iconClass}`;
    this.renderer.setAttribute(this.expandButton, 'aria-expanded', String(isExpanded));
    this.renderer.setAttribute(
      this.expandButton,
      'aria-label',
      isExpanded ? '收合詳細資訊' : '展開詳細資訊',
    );
  }

  private removeExpandControlCell(): void {
    if (!this.expandCell) {
      return;
    }

    const rowElement = this.rowRef.nativeElement;
    if (rowElement.contains(this.expandCell)) {
      this.renderer.removeChild(rowElement, this.expandCell);
    }

    this.removeClickListener?.();
    this.removeClickListener = null;
    this.expandCell = null;
    this.expandButton = null;
    this.expandIconElement = null;
  }

  private ensureDetailRow(): void {
    if (this.detailRow && this.detailCell) {
      return;
    }

    const detailRow = this.renderer.createElement('tr') as HTMLTableRowElement;
    this.renderer.addClass(detailRow, 'responsive-table__detail-row');

    const detailCell = this.renderer.createElement('td') as HTMLTableCellElement;
    this.renderer.addClass(detailCell, 'responsive-table__detail-cell');

    this.renderer.appendChild(detailRow, detailCell);

    const rowElement = this.rowRef.nativeElement;
    const parentElement = rowElement.parentElement;
    if (parentElement) {
      this.renderer.insertBefore(parentElement, detailRow, rowElement.nextSibling);
    }

    this.detailRow = detailRow;
    this.detailCell = detailCell;
  }

  private syncDetailContent(): void {
    if (!this.detailCell) {
      return;
    }

    const collapsedColumns = this.table.getCollapsedColumns();
    const collapsedColumnKeys = new Set(collapsedColumns.map((column) => column.key));
    this.restoreMovedNodesExcept(collapsedColumnKeys);

    this.clearElement(this.detailCell);

    const hostRow = this.rowRef.nativeElement;
    this.renderer.setAttribute(
      this.detailCell,
      'colspan',
      String(Math.max(hostRow.cells.length, 1)),
    );

    const detailList = this.renderer.createElement('dl') as HTMLDListElement;
    this.renderer.addClass(detailList, 'responsive-table__detail-list');

    for (const column of collapsedColumns) {
      const detailItem = this.renderer.createElement('div') as HTMLDivElement;
      this.renderer.addClass(detailItem, 'responsive-table__detail-item');

      const detailLabel = this.renderer.createElement('dt') as HTMLElement;
      this.renderer.addClass(detailLabel, 'responsive-table__detail-label');
      this.renderer.appendChild(detailLabel, this.renderer.createText(column.label));

      const detailValue = this.renderer.createElement('dd') as HTMLElement;
      this.renderer.addClass(detailValue, 'responsive-table__detail-value');
      const movedNodes = this.moveCellNodesToDetail(column.key);
      if (movedNodes && movedNodes.length > 0) {
        for (const node of movedNodes) {
          this.renderer.appendChild(detailValue, node);
        }
      } else {
        this.renderer.appendChild(
          detailValue,
          this.renderer.createText(this.readDisplayValue(this.rowData(), column.key)),
        );
      }

      this.renderer.appendChild(detailItem, detailLabel);
      this.renderer.appendChild(detailItem, detailValue);
      this.renderer.appendChild(detailList, detailItem);
    }

    this.renderer.appendChild(this.detailCell, detailList);
  }

  private removeDetailRow(): void {
    this.restoreAllMovedNodes();

    if (!this.detailRow) {
      return;
    }

    const parentElement = this.detailRow.parentElement;
    if (parentElement) {
      this.renderer.removeChild(parentElement, this.detailRow);
    }

    this.detailRow = null;
    this.detailCell = null;
  }

  private clearElement(element: HTMLElement): void {
    while (element.firstChild) {
      this.renderer.removeChild(element, element.firstChild);
    }
  }

  private readDisplayValue(rowData: unknown, key: string): string {
    if (!rowData || typeof rowData !== 'object') {
      return '-';
    }

    const rowRecord = rowData as Record<string, unknown>;
    const value = rowRecord[key];
    if (value === null || value === undefined) {
      return '-';
    }

    return String(value);
  }

  private moveCellNodesToDetail(columnKey: string): readonly Node[] | null {
    const existingNodes = this.movedNodesByColumn.get(columnKey);
    if (existingNodes) {
      return existingNodes;
    }

    const sourceCell = this.findSourceCell(columnKey);
    if (!sourceCell) {
      return null;
    }

    const nodes = Array.from(sourceCell.childNodes);
    for (const node of nodes) {
      this.renderer.removeChild(sourceCell, node);
    }

    this.movedNodesByColumn.set(columnKey, nodes);
    return nodes;
  }

  private findSourceCell(columnKey: string): HTMLTableCellElement | null {
    const rowElement = this.rowRef.nativeElement;
    for (const cell of Array.from(rowElement.cells)) {
      if (cell.getAttribute('data-rt-col-cell-key') === columnKey) {
        return cell;
      }
    }

    return null;
  }

  private restoreMovedNodesExcept(collapsedColumnKeys: ReadonlySet<string>): void {
    for (const columnKey of Array.from(this.movedNodesByColumn.keys())) {
      if (!collapsedColumnKeys.has(columnKey)) {
        this.restoreNodesForColumn(columnKey);
      }
    }
  }

  private restoreAllMovedNodes(): void {
    for (const columnKey of Array.from(this.movedNodesByColumn.keys())) {
      this.restoreNodesForColumn(columnKey);
    }
  }

  private restoreNodesForColumn(columnKey: string): void {
    const nodes = this.movedNodesByColumn.get(columnKey);
    if (!nodes) {
      return;
    }

    const sourceCell = this.findSourceCell(columnKey);
    if (sourceCell) {
      for (const node of nodes) {
        this.renderer.appendChild(sourceCell, node);
      }
    }

    this.movedNodesByColumn.delete(columnKey);
  }

  private resolveTable() {
    const table = inject(RESPONSIVE_TABLE, { optional: true });
    if (!table) {
      throw new Error('appRtRow must be used inside app-responsive-table.');
    }

    return table;
  }
}
