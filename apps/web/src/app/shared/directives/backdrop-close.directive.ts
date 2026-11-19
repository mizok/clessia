import { Directive, output } from '@angular/core';

/**
 * 原生 `<dialog>` 的「點背景關閉」：點到 dialog 本身（＝`::backdrop`，內容都包在裡面那層）才發出。
 *
 * 抽成 directive 而不是每個彈窗在 template 寫 `(click)`：那是滑鼠專屬的捷徑，lint 的
 * `click-events-have-key-events`／`interactive-supports-focus` 會要求鍵盤對應。鍵盤的對應本來就在 —— 原生
 * dialog 的 Esc 會觸發 `cancel`／`close`，所以這裡不必（也不該）再補一個 keydown。
 */
@Directive({
  selector: 'dialog[backdropClose]',
  host: { '(click)': 'onClick($event)' },
})
export class BackdropCloseDirective {
  readonly backdropClose = output<void>();

  protected onClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.backdropClose.emit();
  }
}
