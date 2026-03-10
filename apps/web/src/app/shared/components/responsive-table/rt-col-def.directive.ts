import {
  DestroyRef,
  Directive,
  ElementRef,
  HostBinding,
  effect,
  inject,
  input,
} from '@angular/core';
import { RESPONSIVE_TABLE } from './responsive-table.token';

let columnDefinitionId = 0;

@Directive({
  selector: 'th[appRtColDef]',
})
export class RtColDefDirective {
  private readonly destroyRef = inject(DestroyRef);
  private readonly elementRef = inject<ElementRef<HTMLTableCellElement>>(ElementRef);
  private readonly table = this.resolveTable();
  private readonly definitionId = `rt-col-def-${columnDefinitionId++}`;

  readonly key = input.required<string>({ alias: 'appRtColDef' });
  readonly label = input<string | undefined>(undefined, { alias: 'appRtColDefLabel' });
  readonly minWidth = input.required<number>({ alias: 'appRtColDefMinWidth' });
  readonly priority = input.required<number>({ alias: 'appRtColDefPriority' });
  readonly collapsible = input(true, { alias: 'appRtColDefCollapsible' });

  constructor() {
    effect(() => {
      this.table.upsertColumn(this.definitionId, {
        key: this.key().trim(),
        label: this.resolveLabel(),
        minWidth: this.minWidth(),
        priority: this.priority(),
        collapsible: this.collapsible(),
      });
    });

    this.destroyRef.onDestroy(() => {
      this.table.removeColumn(this.definitionId);
    });
  }

  @HostBinding('style.display')
  protected get display(): string | null {
    return this.table.isColumnVisible(this.key()) ? null : 'none';
  }

  @HostBinding('attr.data-rt-col-key')
  protected get dataColumnKey(): string {
    return this.key();
  }

  @HostBinding('class.responsive-table__header-cell')
  protected readonly headerCellClass = true;

  private resolveLabel(): string {
    const providedLabel = this.label()?.trim();
    if (providedLabel && providedLabel.length > 0) {
      return providedLabel;
    }

    const textContent = this.elementRef.nativeElement.textContent?.trim();
    if (textContent && textContent.length > 0) {
      return textContent;
    }

    return this.key();
  }

  private resolveTable() {
    const table = inject(RESPONSIVE_TABLE, { optional: true });
    if (!table) {
      throw new Error('appRtColDef must be used inside app-responsive-table.');
    }

    return table;
  }
}
