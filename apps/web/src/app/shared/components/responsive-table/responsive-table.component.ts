import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  Renderer2,
  TemplateRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { PaginatorModule, type PaginatorState } from 'primeng/paginator';
import type {
  ResponsiveTableAccordionBehavior,
  ResponsiveTableBodyState,
  ResponsiveTableColumn,
  ResponsiveTablePageEvent,
  ResponsiveTablePaginationConfig,
  ResponsiveTableRowId,
} from './responsive-table.models';
import { computeColumnVisibility } from './responsive-table.utils';
import { RESPONSIVE_TABLE } from './responsive-table.token';

@Component({
  selector: 'app-responsive-table',
  imports: [NgTemplateOutlet, PaginatorModule],
  providers: [
    {
      provide: RESPONSIVE_TABLE,
      useExisting: forwardRef(() => ResponsiveTableComponent),
    },
  ],
  templateUrl: './responsive-table.component.html',
  styleUrl: './responsive-table.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class ResponsiveTableComponent {
  private static readonly defaultCurrentPageReportTemplate = '顯示 {first} - {last}，共 {totalRecords} 筆';
  private static readonly defaultMobileCurrentPageReportTemplate = '第 {currentPage} / {totalPages} 頁';

  private readonly destroyRef = inject(DestroyRef);
  private readonly renderer = inject(Renderer2);
  protected readonly templateInjector = inject(Injector);
  readonly headTemplate = input.required<TemplateRef<unknown>>();
  readonly bodyTemplate = input.required<TemplateRef<{ state: ResponsiveTableBodyState }>>();
  readonly pagination = input<ResponsiveTablePaginationConfig | null>(null);
  readonly accordionBehavior = input<ResponsiveTableAccordionBehavior>('multi');
  readonly expandIcon = input('pi-chevron-right');
  readonly collapseIcon = input('pi-chevron-down');
  readonly expandControlPosition = input<'start' | 'end'>('start');
  readonly expandControlWidth = input(48);
  readonly page = output<ResponsiveTablePageEvent>();

  protected readonly containerRef = viewChild.required<ElementRef<HTMLElement>>('containerRef');
  private readonly tableRef = viewChild.required<ElementRef<HTMLTableElement>>('tableRef');

  private readonly containerWidth = signal(Number.POSITIVE_INFINITY);
  private readonly viewReady = signal(false);
  private readonly columnDefinitionsById = signal<ReadonlyMap<string, ResponsiveTableColumn>>(
    new Map(),
  );
  private readonly expandedRowIds = signal<ReadonlySet<ResponsiveTableRowId>>(new Set());

  protected readonly visibleColumns = signal<readonly ResponsiveTableColumn[]>([]);
  protected readonly collapsedColumns = signal<readonly ResponsiveTableColumn[]>([]);
  private readonly visibleColumnKeySet = computed(
    () => new Set(this.visibleColumns().map((column) => column.key)),
  );

  protected readonly bodyState: ResponsiveTableBodyState = {
    visibleColumns: () => this.visibleColumns(),
    collapsedColumns: () => this.collapsedColumns(),
    hasCollapsedColumns: () => this.hasCollapsedColumns(),
    isRowExpanded: (rowId) => this.isRowExpanded(rowId),
    toggleRow: (rowId) => this.toggleRow(rowId),
  };

  protected readonly bodyContext = {
    state: this.bodyState,
  };
  protected readonly effectivePagination = computed(() => {
    const pagination = this.pagination();
    if (!pagination) {
      return null;
    }
    const isCompactPaginator = this.isCompactPaginator();

    return {
      first: Math.max(pagination.first, 0),
      rows: Math.max(pagination.rows, 1),
      totalRecords: Math.max(pagination.totalRecords, 0),
      rowsPerPageOptions: isCompactPaginator
        ? undefined
        : pagination.rowsPerPageOptions
        ? [...pagination.rowsPerPageOptions]
        : undefined,
      showCurrentPageReport: pagination.showCurrentPageReport ?? true,
      currentPageReportTemplate: isCompactPaginator
        ? ResponsiveTableComponent.defaultMobileCurrentPageReportTemplate
        : pagination.currentPageReportTemplate ??
          ResponsiveTableComponent.defaultCurrentPageReportTemplate,
      alwaysShow: pagination.alwaysShow ?? false,
    };
  });
  protected readonly isCompactPaginator = computed(() => this.containerWidth() <= 768);
  protected readonly shouldShowPaginator = computed(() => {
    const pagination = this.effectivePagination();
    if (!pagination) {
      return false;
    }

    return pagination.alwaysShow || pagination.totalRecords > pagination.rows;
  });

  private resizeObserver?: ResizeObserver;
  private removeWindowResizeListener: (() => void) | null = null;
  private expandHeaderCell: HTMLTableCellElement | null = null;

  constructor() {
    afterNextRender(() => {
      this.viewReady.set(true);
      this.setupResizeObserver();
      this.syncExpandHeaderCell();
    });

    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.removeWindowResizeListener?.();
      this.removeWindowResizeListener = null;
      this.removeExpandHeaderCell();
    });

    effect(() => {
      const columnDefinitions = [...this.columnDefinitionsById().values()];
      this.validateColumnDefinitions(columnDefinitions);

      const visibilityResult = computeColumnVisibility(
        columnDefinitions,
        this.containerWidth(),
        this.expandControlWidth(),
      );

      this.visibleColumns.set(visibilityResult.visibleColumns);
      this.collapsedColumns.set(visibilityResult.collapsedColumns);

      if (visibilityResult.collapsedColumns.length === 0 && this.expandedRowIds().size > 0) {
        this.expandedRowIds.set(new Set());
      }

      if (this.viewReady()) {
        this.syncExpandHeaderCell();
      }
    });
  }

  upsertColumn(definitionId: string, column: ResponsiveTableColumn): void {
    this.columnDefinitionsById.update((currentMap) => {
      const nextMap = new Map(currentMap);
      nextMap.set(definitionId, column);
      return nextMap;
    });
  }

  removeColumn(definitionId: string): void {
    this.columnDefinitionsById.update((currentMap) => {
      if (!currentMap.has(definitionId)) {
        return currentMap;
      }

      const nextMap = new Map(currentMap);
      nextMap.delete(definitionId);
      return nextMap;
    });
  }

  isColumnVisible(columnKey: string): boolean {
    const normalizedColumnKey = columnKey.trim();
    if (normalizedColumnKey.length === 0) {
      return true;
    }

    const hasAnyDefinition = this.columnDefinitionsById().size > 0;
    if (!hasAnyDefinition) {
      return true;
    }

    return this.visibleColumnKeySet().has(normalizedColumnKey);
  }

  hasCollapsedColumns(): boolean {
    return this.collapsedColumns().length > 0;
  }

  getCollapsedColumns(): readonly ResponsiveTableColumn[] {
    return this.collapsedColumns();
  }

  toggleRow(rowId: ResponsiveTableRowId): void {
    if (!this.hasCollapsedColumns()) {
      return;
    }

    this.expandedRowIds.update((currentIds) => {
      const nextIds = new Set(currentIds);
      if (this.accordionBehavior() === 'accordion') {
        if (nextIds.has(rowId)) {
          return new Set<ResponsiveTableRowId>();
        }

        return new Set<ResponsiveTableRowId>([rowId]);
      }

      if (nextIds.has(rowId)) {
        nextIds.delete(rowId);
      } else {
        nextIds.add(rowId);
      }

      return nextIds;
    });
  }

  isRowExpanded(rowId: ResponsiveTableRowId): boolean {
    return this.expandedRowIds().has(rowId);
  }

  getExpandIconClass(rowId: ResponsiveTableRowId): string {
    return this.isRowExpanded(rowId) ? this.collapseIcon() : this.expandIcon();
  }

  getExpandControlPosition(): 'start' | 'end' {
    return this.expandControlPosition();
  }

  protected handlePageChange(event: PaginatorState): void {
    if (this.expandedRowIds().size > 0) {
      this.expandedRowIds.set(new Set());
    }

    this.page.emit({
      first: event.first ?? 0,
      rows: event.rows ?? 0,
      page: event.page ?? 0,
      pageCount: event.pageCount ?? 0,
    });
  }

  private setupResizeObserver(): void {
    const containerElement = this.containerRef().nativeElement;
    this.containerWidth.set(Math.max(containerElement.getBoundingClientRect().width, 0));

    const ResizeObserverCtor = globalThis.ResizeObserver;
    if (typeof ResizeObserverCtor !== 'function') {
      this.removeWindowResizeListener = this.renderer.listen('window', 'resize', () => {
        this.containerWidth.set(Math.max(containerElement.getBoundingClientRect().width, 0));
      });
      return;
    }

    this.resizeObserver = new ResizeObserverCtor((entries) => {
      const latestWidth = entries[0]?.contentRect.width ?? Number.POSITIVE_INFINITY;
      this.containerWidth.set(latestWidth);
    });

    this.resizeObserver.observe(containerElement);
  }

  private syncExpandHeaderCell(): void {
    const headerRow = this.findHeaderRow();
    if (!headerRow) {
      return;
    }

    if (!this.hasCollapsedColumns()) {
      this.removeExpandHeaderCell();
      return;
    }

    this.ensureExpandHeaderCell();
    if (!this.expandHeaderCell) {
      return;
    }

    if (this.getExpandControlPosition() === 'start') {
      if (headerRow.firstChild !== this.expandHeaderCell) {
        this.renderer.insertBefore(headerRow, this.expandHeaderCell, headerRow.firstChild);
      }
      return;
    }

    if (headerRow.lastChild !== this.expandHeaderCell) {
      this.renderer.appendChild(headerRow, this.expandHeaderCell);
    }
  }

  private ensureExpandHeaderCell(): void {
    if (this.expandHeaderCell) {
      return;
    }

    const th = this.renderer.createElement('th') as HTMLTableCellElement;
    this.renderer.addClass(th, 'responsive-table__expand-header');
    this.renderer.setAttribute(th, 'aria-hidden', 'true');
    this.expandHeaderCell = th;
  }

  private removeExpandHeaderCell(): void {
    if (!this.expandHeaderCell) {
      return;
    }

    const parent = this.expandHeaderCell.parentElement;
    if (parent) {
      this.renderer.removeChild(parent, this.expandHeaderCell);
    }

    this.expandHeaderCell = null;
  }

  private findHeaderRow(): HTMLTableRowElement | null {
    return this.tableRef().nativeElement.querySelector('thead tr');
  }

  private validateColumnDefinitions(columns: readonly ResponsiveTableColumn[]): void {
    const keys = new Set<string>();

    for (const column of columns) {
      const normalizedKey = column.key.trim();
      if (normalizedKey.length === 0) {
        throw new Error('Responsive table column key must not be empty.');
      }

      if (keys.has(normalizedKey)) {
        throw new Error(`Responsive table has duplicate column key: ${normalizedKey}.`);
      }
      keys.add(normalizedKey);

      if (!Number.isFinite(column.priority)) {
        throw new Error(`Responsive table column "${normalizedKey}" has invalid priority.`);
      }

      if (!Number.isFinite(column.minWidth) || column.minWidth <= 0) {
        throw new Error(`Responsive table column "${normalizedKey}" minWidth must be > 0.`);
      }
    }
  }
}
