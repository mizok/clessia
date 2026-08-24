import { SlicePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import type { Class } from '@core/classes.service';

/**
 * 開課班列表的一列。
 *
 * 從 `courses.page` 抽出來的理由是樣式：`.class-row` 佔了頁面 SCSS 的近一半，
 * 把整頁推過 12 kB 的預算上限、build 直接失敗。
 *
 * **輸出刻意只帶最小酬載**。原本的標記依賴 `group.course.id`（外層 `@for` 的變數）
 * 與 `actionMenu`（頁面層共用的 popup 參考）—— 那些是頁面的脈絡，不是這一列的。
 * 元件只說「有人點了導覽」，由頁面決定導去哪。
 */
@Component({
  selector: 'app-class-row',
  imports: [SlicePipe, ButtonModule, TooltipModule],
  templateUrl: './class-row.component.html',
  styleUrl: './class-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassRowComponent {
  readonly cls = input.required<Class>();
  readonly selected = input(false);
  readonly historical = input(false);
  readonly scheduleSummary = input('');
  readonly mobile = input(false);

  readonly toggleSelection = output<MouseEvent>();
  readonly navigate = output<void>();
  readonly navigateUnassigned = output<void>();
  readonly openMenu = output<MouseEvent>();
}
