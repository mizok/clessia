import { SlicePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import type { Class } from '@core/classes.service';

const ROW_BASE = 'grid items-center gap-y-1 border-t border-zinc-100 py-3 wide:gap-x-5 gap-x-3';

const LAYOUT_WITH_CHECKBOX = {
  row: `${ROW_BASE} cursor-pointer grid-cols-[28px_minmax(0,1fr)_44px] wide:grid-cols-[28px_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_44px]`,
  name: 'col-start-2 row-start-1 flex min-w-0 items-center gap-0.5',
  schedules: 'col-start-2 text-md text-zinc-700 tabular-nums wide:col-start-3 wide:row-start-1',
  info: 'col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 wide:col-start-4 wide:row-start-1',
  menu: 'col-start-3 row-start-1 justify-self-end wide:col-start-5',
  dates: 'col-[2/span_2] text-sm text-zinc-600 tabular-nums wide:col-[2/span_3]',
} as const;

const LAYOUT_PLAIN = {
  row: `${ROW_BASE} grid-cols-[minmax(0,1fr)_44px] wide:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_44px]`,
  name: 'col-start-1 row-start-1 flex min-w-0 items-center gap-0.5',
  schedules: 'col-start-1 text-md text-zinc-700 tabular-nums wide:col-start-2 wide:row-start-1',
  info: 'col-start-1 flex flex-wrap items-center gap-x-3 gap-y-1 wide:col-start-3 wide:row-start-1',
  menu: 'col-start-2 row-start-1 justify-self-end wide:col-start-4',
  dates: 'col-[1/span_2] text-sm text-zinc-600 tabular-nums wide:col-[1/span_3]',
} as const;

/**
 * 開課班列表的一列。
 *
 * 從 `courses.page` 抽出來的理由原本是樣式（`.class-row` 佔頁面 SCSS 近一半）；A6 換版後樣式是 utility（#991 courses C1）。
 *
 * **輸出刻意只帶最小酬載**。原本的標記依賴 `group.course.id`（外層 `@for` 的變數）
 * 與 `actionMenu`（頁面層共用的 popup 參考）—— 那些是頁面的脈絡，不是這一列的。
 * 元件只說「有人點了導覽」，由頁面決定導去哪。
 */
@Component({
  selector: 'app-class-row',
  imports: [SlicePipe, ButtonModule],
  templateUrl: './class-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassRowComponent {
  readonly cls = input.required<Class>();
  readonly selected = input(false);
  readonly historical = input(false);
  readonly scheduleSummary = input('');
  readonly mobile = input(false);
  /**
   * 批次選取模式（A6 預設沒有勾選框）。**預設 true 是給單獨使用這個元件的場合**；
   * 課程頁預設傳 false，進入「批次選取」才傳 true。
   */
  readonly selectable = input(true);

  /**
   * 兩種版面（有／沒有勾選欄）的 class。**整串寫在 TS 裡、用 `[class]` 綁** ——
   * 任意值 class 不能寫成 `[class.xxx-[..]]`（靜默失效）；沒有勾選欄時每個格位左移一格。
   */
  protected readonly layout = computed(() =>
    this.selectable() ? LAYOUT_WITH_CHECKBOX : LAYOUT_PLAIN,
  );

  readonly toggleSelection = output<MouseEvent>();
  readonly navigate = output<void>();
  readonly navigateUnassigned = output<void>();
  readonly generateSessions = output<void>();
  readonly openMenu = output<MouseEvent>();

  /** 點列的空白處＝勾選；點在 checkbox 上交給它自己的 change（不然會勾兩次） */
  protected onRowClick(event: MouseEvent): void {
    if (!this.selectable() || event.target instanceof HTMLInputElement) return;
    this.toggleSelection.emit(event);
  }
}
