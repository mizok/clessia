import { Directive, input, output } from '@angular/core';

/** 勾一堂（`shiftKey`：按著 Shift ＝ 範圍勾，A6） */
export interface SchedulePickRequest {
  readonly id: string;
  readonly shiftKey: boolean;
}

/**
 * 勾選框外層 44px `<label>` 的 click（掛在 label 上：觸控尺寸 gate 看的是有 `(click)` 的元素）。
 * - 只處理**落在 checkbox 上**的那一下：點 label 空白處時瀏覽器會再對 checkbox 補發一次 click，不處理會勾兩次。
 * - **擋掉瀏覽器自己的切換**，勾不勾一律由頁面的狀態決定：Shift 範圍勾在已勾的那格上按，
 *   狀態不變（只加不減），瀏覽器卻會先把它取消勾 —— `[checked]` 的值沒變，Angular 不會改回來。
 */
export function pickEvent(event: MouseEvent, id: string): SchedulePickRequest | null {
  if (!(event.target instanceof HTMLInputElement)) return null;
  event.preventDefault();
  return { id, shiftKey: event.shiftKey };
}

/**
 * 勾選框外層 44px `<label>` 的點擊（觸控尺寸 gate 要的是外層這個大的點擊面）。寫成 directive 而不是 template 的
 * `(click)`：label 上的 `(click)` 會被 a11y lint 要求鍵盤對應，而鍵盤的對應本來就是裡面那個 checkbox
 *（Tab、空白鍵），不是 label。
 */
@Directive({
  selector: 'label[pickClick]',
  host: { '(click)': 'onClick($event)' },
})
export class PickClickDirective {
  /** 這一列的 id */
  readonly pickClick = input.required<string>();
  readonly picked = output<SchedulePickRequest>();

  protected onClick(event: MouseEvent): void {
    const req = pickEvent(event, this.pickClick());
    if (req) this.picked.emit(req);
  }
}
