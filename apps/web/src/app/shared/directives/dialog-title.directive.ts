import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

let nextId = 0;

/**
 * 掛在 DynamicDialog 內容的標題（h2）上：把外層 `[role="dialog"]` 的可及名稱指到這個標題。
 * PrimeNG 只在有 header 時自己掛 aria-labelledby；表單對話框都是 `showHeader: false`、標題寫在內容裡，
 * 不補的話報讀只會念「對話框」（A6 `.fdlg` 是 `aria-labelledby` 指 h2）。同 role-picker 的作法（#1636）。
 */
@Directive({
  selector: '[appDialogTitle]',
  host: { '[id]': 'id' },
})
export class DialogTitleDirective {
  protected readonly id = `dialog-title-${++nextId}`;

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => el.closest('[role="dialog"]')?.setAttribute('aria-labelledby', this.id));
  }
}
