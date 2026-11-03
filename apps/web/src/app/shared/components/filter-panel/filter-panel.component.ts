import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  TemplateRef,
  contentChild,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { Popover, PopoverModule } from 'primeng/popover';
import { FitPopoverDirective } from '@shared/directives/fit-popover.directive';

/** 跟 styles.css 的手機規則同一條線（`max-width: 860px`）。`BrowserStateService.isMobile` 是 CDK Handset，對不上 */
const NARROW = '(max-width: 860px)';

/**
 * 列表頁的篩選面板（#2206，使用者 11-03 裁定）：
 *
 * - 桌機：貼在「篩選」鈕下的浮層（`filter-popover`＋`appFitPopover`，A6 `.pop`），跟以前一樣
 * - ≤860：貼底抽屜 —— 就是 `p-dialog`，全站樣式（#1776）在手機已經把它變成抽屜，
 *   圓角、鍵盤讓位、safe-area、滑入動畫都不用另寫。標題「篩選」、有條件時右上「清除」、底部「完成」
 *
 * 套用時機不歸這裡管：各頁的按鈕照舊點了就套用，「完成」只關閉（裁定 2）。
 * 內容只寫一次，用 `<ng-template>` 投影進來：
 *
 * ```html
 * <app-filter-panel #filters [hasFilters]="hasFilter()" (cleared)="clearFilters()">
 *   <ng-template>…條件…</ng-template>
 * </app-filter-panel>
 * <button (click)="filters.toggle($event)">篩選</button>
 * ```
 *
 * ⚠️ 內容裡的下拉（p-select、p-multiselect、p-datepicker）要 `appendTo="body"`：
 * 抽屜內容會捲動，PrimeNG 的 overlay 預設掛在自己旁邊（`self`），會被裁，而且一捲動就自己收起來。
 */
@Component({
  selector: 'app-filter-panel',
  imports: [NgTemplateOutlet, DialogModule, PopoverModule, FitPopoverDirective],
  templateUrl: './filter-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterPanelComponent {
  /** 有沒有生效中的條件：有才出「清除」 */
  readonly hasFilters = input(false);
  /** 抽屜的「清除」 */
  readonly cleared = output<void>();
  /** 開了／關了（給「篩選」鈕的 aria-expanded） */
  readonly openChange = output<boolean>();

  protected readonly content = contentChild.required(TemplateRef);
  private readonly popover = viewChild(Popover);

  protected readonly narrow = signal(false);
  protected readonly drawerOpen = signal(false);

  constructor() {
    const mq = globalThis.matchMedia?.(NARROW);
    if (!mq) return;
    this.narrow.set(mq.matches);
    const onChange = (e: MediaQueryListEvent) => {
      // 開著的時候跨過斷點：先收起來，免得換了容器還掛著另一種的開啟狀態
      this.hide();
      this.narrow.set(e.matches);
    };
    mq.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', onChange));
  }

  toggle(event: Event): void {
    if (this.narrow()) this.setDrawer(!this.drawerOpen());
    else this.popover()?.toggle(event);
  }

  hide(): void {
    if (this.drawerOpen()) this.setDrawer(false);
    this.popover()?.hide();
  }

  protected setDrawer(open: boolean): void {
    this.drawerOpen.set(open);
    this.openChange.emit(open);
  }
}
