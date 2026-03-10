import { Directive, HostBinding, inject, input } from '@angular/core';
import { RESPONSIVE_TABLE } from './responsive-table.token';

@Directive({
  selector: 'td[appRtColCell]',
})
export class RtColCellDirective {
  private readonly table = this.resolveTable();
  readonly key = input.required<string>({ alias: 'appRtColCell' });

  constructor() {}

  @HostBinding('style.display')
  protected get display(): string | null {
    return this.table.isColumnVisible(this.key()) ? null : 'none';
  }

  @HostBinding('attr.data-rt-col-cell-key')
  protected get dataColumnCellKey(): string {
    return this.key();
  }

  @HostBinding('class.responsive-table__cell')
  protected readonly cellClass = true;

  private resolveTable() {
    const table = inject(RESPONSIVE_TABLE, { optional: true });
    if (!table) {
      throw new Error('appRtColCell must be used inside app-responsive-table.');
    }

    return table;
  }
}
