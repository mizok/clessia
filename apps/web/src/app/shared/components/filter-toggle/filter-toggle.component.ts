import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

/**
 * 手機的「篩選：全部」鈕（A6 `.tbar` 手機版，#1314 ③）。
 *
 * 手機上搜尋框＋這顆鈕共用一列，其餘篩選控制項收進它點開的面板，首屏不再被四五個
 * 垂直堆疊的下拉吃掉 40–50%。**桌機預設不渲染**（`wide:hidden`）—— 桌機的控制項本來就攤開；
 * 傳 `always` 才連桌機也渲染。
 *
 * 元件只管「鈕＋開合狀態」；面板是頁面自己的 DOM（它放的是各頁不同的控制項），
 * 用 `controls` 綁 `aria-controls`、用 `[(open)]` 讀開合：
 *
 * ```html
 * <app-filter-toggle [summary]="filterSummary()" [(open)]="filtersOpen" controls="x-filters" />
 * <div id="x-filters" [class.hidden]="!filtersOpen()" class="wide:flex">…</div>
 * ```
 */
@Component({
  selector: 'app-filter-toggle',
  imports: [],
  templateUrl: './filter-toggle.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClass()' },
})
export class FilterToggleComponent {
  /** 目前生效的條件摘要；沒有條件就是「全部」 */
  readonly summary = input('全部');
  /** 是否有條件生效（鈕上多一個點，收起時也看得出有東西在濾） */
  readonly active = input(false);
  /** 面板的 id，給 `aria-controls` */
  readonly controls = input.required<string>();
  readonly open = model(false);
  /**
   * 桌機也渲染。預設只有手機（桌機的控制項本來就攤開）；只剩**一項**篩選的頁
   * （parents 只有狀態）桌機也收進這顆鈕，照 A6 的「篩選：全部」。
   */
  readonly always = input(false);
  protected readonly hostClass = computed(() => (this.always() ? '' : 'wide:hidden'));
}
