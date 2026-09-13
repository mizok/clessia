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
  /**
   * 這一欄是這筆資料的**身分**嗎（#848）。不給就是宣告順序的第一欄 ——
   * 只有慣例不成立的表要標（`/admin/contact-book` 第一欄是日期，身分是學生）。
   */
  readonly primary = input(false, { alias: 'appRtColDefPrimary' });

  constructor() {
    effect(() => {
      this.table.upsertColumn(this.definitionId, {
        key: this.key().trim(),
        label: this.resolveLabel(),
        minWidth: this.minWidth(),
        priority: this.priority(),
        collapsible: this.collapsible(),
        primary: this.primary(),
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

  /**
   * 把主欄標記暴露到 DOM（#848）。**不是為了樣式，是為了讓這個不變量在外面看得見** ——
   * 版面健全度掃描的判準是「宣告順序第一個非動作欄有沒有被收合」，
   * 而 `/admin/contact-book` 正當地 opt-out 了；沒有這個屬性，掃描只能把它報成缺陷，
   * 而「正當的例外」與「真的壞掉」在報告上會長得一模一樣。
   */
  @HostBinding('attr.data-rt-col-primary')
  protected get dataColumnPrimary(): string | null {
    return this.primary() ? '' : null;
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
