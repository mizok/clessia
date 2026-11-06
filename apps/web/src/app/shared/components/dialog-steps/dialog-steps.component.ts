import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * 手機重量級對話框分步的步驟標示（#2396，規則見 kb/wiki/architecture/dialog-frame.md「操作量分級」）。
 * 放在殼內容區的第一行；只在手機（≤860）顯示 —— 桌機是單頁、不分步。
 * `aria-live`：換步時報讀器念出「第 2／3 步 · 計費」（焦點會移到新一步的第一個欄位）。
 *
 * ```html
 * <app-dialog-steps [current]="step()" [total]="2" [label]="step() === 1 ? '計費' : '首期帳單'" />
 * ```
 */
@Component({
  selector: 'app-dialog-steps',
  template: `<p class="m-0 text-sm text-zinc-600 tabular-nums wide:hidden" aria-live="polite">
    第 {{ current() }}／{{ total() }} 步 · {{ label() }}
  </p>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class DialogStepsComponent {
  readonly current = input.required<number>();
  readonly total = input.required<number>();
  readonly label = input.required<string>();
}

/**
 * 這一刻是否分步（手機）。只在送出那一刻判斷：`ngSubmit` 在手機、還沒到最後一步時＝下一步，桌機＝送出。
 * 版面的顯示／隱藏走 CSS（`max-wide:hidden`），不用這支。
 */
export function dialogStepsActive(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 860px)').matches;
}
