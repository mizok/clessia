import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { FlowFieldComponent } from '@shared/components/flow-field/flow-field.component';
import { HeightFollowDirective } from '@shared/directives/height-follow.directive';
import { TextSwapDirective } from '@shared/directives/text-swap.directive';

/**
 * A6 的開場色面（#991 殼切片 S1）：每頁一塊全寬橘面，放「這一頁的那句話」，流場在裡面。
 *
 * **由頁面自己放在模板最上面**，不由殼從 route data 生成 —— 標題常是頁面算出來的
 * （changes 的「10 月 12 則異動」），投影零狀態、零服務。殼看到 main 裡有它就拿掉內距
 * 讓它出血（`shell-layout` 的 `:has(app-page-open)`），頁面本體自己包 `page-wrap`。
 *
 * 流場會動（A6），捲出畫面與 `prefers-reduced-motion` 由 flow-field 自己停。
 * 對比：橘面上只用 `band-ink(-muted)`，那兩個 token 的透明度地板見 styles.css。
 *
 * 具名插槽：`openBack`（返回連結，學生檔案起）、`openTitle`、`openSub`，其餘內容接在下面。
 * ponytail: A6 的統計列（`stats`）等第一個需要的頁再加。
 *
 * **高度變化用滑的**（#1859，使用者 10-22「跳改成滑沒有問題」）：標題常是資料回來才換成兩行、
 * 副行與孩子切換器也是晚到，原本整頁一次被往下推 20–55px。色面掛 `appHeightFollow`
 * （shared/directives/height-follow.directive.ts，#1861），內容高度變了就從舊高度滑到新高度。
 */
@Component({
  selector: 'app-page-open',
  imports: [FlowFieldComponent, HeightFollowDirective, TextSwapDirective],
  templateUrl: './page-open.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class PageOpenComponent {
  /**
   * 人名當標題（A6 `.open__title--name`；學生檔案、成績登錄的考試名）：桌機 72／行高 1，手機 44／行高 1.2
   *（稿的手機 `.open__title` 行高 1.2 蓋過 `--name` 的 1，#1925 量到）。
   * 預設 false＝一般標題 48／28，不影響別頁。整串寫在 TS：任意值 class 用 `[class.text-[..]]`
   * 綁會靜默失效（labor-1019 charter §二）。
   */
  readonly nameSize = input(false);

  /**
   * 副行放大（A6 `a6.css:633`：標題裡有分校小字時，副行改 22／16px、600、近黑）。
   * 預設 false＝一般副行 18／14px、500、淡色，別頁不變。
   */
  readonly subLarge = input(false);

  /**
   * 課表的色面（A6 `schedule.css:10-11,277`）：這頁自己把標題縮成 40／26px、桌機上內距 32／下 24。
   * 預設 false＝全站一般色面，別頁 DOM 與 class 不變。
   */
  readonly compact = input(false);

  /**
   * 標題（`openTitle`）換字時播不播文字替換（#1895）。預設 true。
   * 儀表板傳 false：標題是補習班名稱，使用者 10-23 說那一行不要動畫；副行（今日摘要）照舊播。
   */
  readonly titleSwap = input(true);

  protected readonly wrapClass = computed(
    () =>
      'page-wrap relative ' +
      (this.compact() ? '' : 'py-6 ') +
      (this.compact() ? 'pt-8 pb-6' : 'wide:pt-12 wide:pb-10'),
  );

  protected readonly subClass = computed(() =>
    this.subLarge()
      ? 'mt-4 mb-0 max-w-[46em] text-lg font-semibold tracking-[-0.01em] text-band-ink empty:hidden wide:text-2xl'
      : 'mt-3 mb-0 max-w-[46em] text-base font-medium text-band-ink-muted empty:hidden wide:text-lg',
  );

  protected readonly titleClass = computed(() =>
    this.nameSize()
      ? 'm-0 max-w-[18em] text-[44px] leading-[1.2] font-bold tracking-[-0.04em] text-balance wide:text-[72px] wide:leading-none'
      : this.compact()
        ? 'm-0 max-w-[18em] text-[26px] leading-[1.2] font-bold tracking-[-0.03em] text-balance wide:text-[40px] wide:leading-[1.14] wide:tracking-[-0.035em]'
        : 'm-0 max-w-[18em] text-[28px] leading-[1.2] font-bold tracking-[-0.03em] text-balance wide:text-[48px] wide:leading-[1.14] wide:tracking-[-0.035em]',
  );
}
