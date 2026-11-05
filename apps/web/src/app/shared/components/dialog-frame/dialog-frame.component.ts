import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DialogTitleDirective } from '@shared/directives/dialog-title.directive';

/**
 * 全站對話框的共用殼（#2290，規則見 kb/wiki/architecture/dialog-frame.md）。
 *
 * 標頭（h2＋副標＋關閉）、內距、sticky 底部、手機貼底抽屜的底部留白（`--sheet-foot-gap`＋safe-area）都在這裡；
 * 對話框只寫內容與底部的鈕。h2 掛 `appDialogTitle`，DynamicDialog（`showHeader: false`）也有可及名稱。
 *
 * ```html
 * <app-dialog-frame title="新增家長" sub="…" (closed)="cancel()">
 *   …內容…
 *   <ng-container dialogFoot><button>取消</button><button>建立</button></ng-container>
 * </app-dialog-frame>
 * ```
 * 底部沒有投影任何元素就藏起來（`.form-dialog__footer:not(:has(*))`）；左邊要放「還沒填：…」就給 `class="form-dialog__why"`。
 */
@Component({
  selector: 'app-dialog-frame',
  imports: [DialogTitleDirective],
  templateUrl: './dialog-frame.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class DialogFrameComponent {
  readonly title = input.required<string>();
  readonly sub = input('');
  /** 按 ✕：對話框自己決定關閉的語意（多半等同「取消」） */
  readonly closed = output<void>();
}
