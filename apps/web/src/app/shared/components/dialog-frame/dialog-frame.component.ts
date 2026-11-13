import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DialogTitleDirective } from '@shared/directives/dialog-title.directive';

/**
 * 全站對話框的共用殼（#2290，規則見 kb/wiki/architecture/dialog-frame.md）。
 *
 * 標頭（h2＋關閉；不放副標，#2396）、內距、sticky 底部、手機貼底抽屜的底部留白（`--sheet-foot-gap`＋safe-area）都在這裡；
 * 對話框只寫內容與底部的鈕。h2 掛 `appDialogTitle`，DynamicDialog（`showHeader: false`）也有可及名稱。
 *
 * ```html
 * <app-dialog-frame title="新增家長" (closed)="cancel()">
 *   …內容…
 *   <ng-container dialogFoot><button>取消</button><button>建立</button></ng-container>
 * </app-dialog-frame>
 * ```
 * 副標不放（R5 11-06，#2396）：是誰／哪天／哪班寫內容區第一行 `data-part="dialog-context"`（text-sm zinc-600），
 * 做決定要讀的內容本體寫 `data-part="dialog-lead"`（text-base zinc-700）—— 見 dialog-frame.md。
 * 底部沒有投影任何元素就藏起來（`.form-dialog__footer:not(:has(*))`）；左邊要放「還沒填：…」就給 `class="form-dialog__why"`。
 */
@Component({
  selector: 'app-dialog-frame',
  imports: [DialogTitleDirective],
  templateUrl: './dialog-frame.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '(keydown.escape)': 'onEscape($event)' },
})
export class DialogFrameComponent {
  readonly title = input.required<string>();
  /** 按 ✕ 或 Esc：對話框自己決定關閉的語意（多半等同「取消」） */
  readonly closed = output<void>();

  /**
   * Esc＝✕（#2445）。DynamicDialog 開啟設定沒帶 `closable` 時，`p-dialog` 不掛 Esc 監聽
   * （它只在 `closeOnEscape && closable` 時掛，primeng-dialog.mjs），全站 `showHeader:false` 的開啟點都中。
   * 修在殼上：焦點在對話框裡按 Esc 就發 `closed`，跟按 ✕ 同一條路 —— 有離開保護的對話框照樣先問。
   * - `defaultPrevented`：裡面的下拉／選單先吃掉了 Esc（PrimeNG select 關清單時會 preventDefault），不關整個對話框
   * - 吃掉之後 preventDefault＋stopPropagation：外層原生 `<dialog>` 的 cancel、PrimeNG 的 document 監聽不再各關一次
   */
  protected onEscape(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    this.closed.emit();
  }
}
