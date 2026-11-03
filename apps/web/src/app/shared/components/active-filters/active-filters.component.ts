import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface ActiveFilter {
  /** 給 `removed` 用，頁面自己認得 */
  readonly key: string;
  readonly label: string;
}

/**
 * 已套用的篩選條件，一顆一顆列出來、點 × 直接拿掉（#2206，使用者 11-03 裁定：只在手機）。
 *
 * 跟 `app-filter-chip` 不同：那支是「開關」（只看 X），這支是「移除」。
 * 沒有條件時整個不渲染、不佔高度；桌機（≥861）隱藏，桌機看「篩選：國三 · 已停用」按鈕上的字。
 */
@Component({
  selector: 'app-active-filters',
  templateUrl: './active-filters.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActiveFiltersComponent {
  readonly filters = input.required<readonly ActiveFilter[]>();
  readonly removed = output<string>();
}
