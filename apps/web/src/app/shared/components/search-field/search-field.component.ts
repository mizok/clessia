import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime } from 'rxjs';

let seq = 0;

/**
 * A6 的搜尋欄位（標籤＋44px 輸入框，跟 `app-select-field` 並排時等高）。
 *
 * - 輸入法組字中（`isComposing`）不送，`compositionend` 才送 —— 中文打到一半的注音不是查詢。
 * - 停手 300ms 後才發 `searchChange`；跟 `value`（外部目前的查詢）相同就不發，
 *   所以「清除篩選」把 `value` 設回空字串時輸入框跟著清空，不會再多送一次。
 */
@Component({
  selector: 'app-search-field',
  templateUrl: './search-field.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchFieldComponent {
  readonly label = input.required<string>();
  readonly placeholder = input('');
  /** 目前生效的查詢；外部改它，輸入框跟著變 */
  readonly value = input('');
  readonly searchChange = output<string>();

  protected readonly inputId = `search-field-${++seq}`;
  private readonly typed = new Subject<string>();

  constructor() {
    this.typed.pipe(debounceTime(300), takeUntilDestroyed(inject(DestroyRef))).subscribe((text) => {
      if (text.trim() !== this.value().trim()) this.searchChange.emit(text.trim());
    });
  }

  protected onInput(event: Event): void {
    if ((event as InputEvent).isComposing) return;
    this.typed.next((event.target as HTMLInputElement).value);
  }

  protected onCompositionEnd(event: CompositionEvent): void {
    this.typed.next((event.target as HTMLInputElement).value);
  }
}
