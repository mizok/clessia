import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';

import { FlowFieldComponent } from '@shared/components/flow-field/flow-field.component';

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
 * 副行與孩子切換器也是晚到，原本整頁一次被往下推 20–55px。內容高度變了，就用 WAAPI 把色面的高度
 * 從舊值滑到新值（色面本來就 overflow-hidden，內容是被「露出來」）。視窗寬度變了（換行重排）不滑，
 * 減少動態時不滑。只滑高度、不碰內容的 DOM，頁面照常更新。
 */
@Component({
  selector: 'app-page-open',
  imports: [FlowFieldComponent],
  templateUrl: './page-open.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class PageOpenComponent {
  private readonly band = viewChild.required<ElementRef<HTMLElement>>('band');
  private readonly content = viewChild.required<ElementRef<HTMLElement>>('content');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const ro = slideHeightOnResize(this.band().nativeElement, this.content().nativeElement);
      destroyRef.onDestroy(() => ro?.disconnect());
    });
  }

  /**
   * 人名當標題（A6 `.open__title--name`，只有學生檔案用）：桌機 72／手機 44，行高 1。
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
      ? 'm-0 max-w-[18em] text-[44px] leading-none font-bold tracking-[-0.04em] text-balance wide:text-[72px]'
      : this.compact()
        ? 'm-0 max-w-[18em] text-[26px] leading-[1.2] font-bold tracking-[-0.03em] text-balance wide:text-[40px] wide:leading-[1.14] wide:tracking-[-0.035em]'
        : 'm-0 max-w-[18em] text-[28px] leading-[1.2] font-bold tracking-[-0.03em] text-balance wide:text-[48px] wide:leading-[1.14] wide:tracking-[-0.035em]',
  );
}

/** 進場的時長（同 #1634 的彈出物）；曲線讀 styles.css 的 `--arrive` */
const SLIDE_MS = 200;

/**
 * `content` 的高度變了就把 `band` 的高度從舊值滑到新值。寬度也變了（視窗縮放、換行重排）不滑。
 * 連續變化時從「目前畫面上的高度」接著滑，不跳回上一個終點。
 */
export function slideHeightOnResize(band: HTMLElement, content: HTMLElement) {
  if (typeof ResizeObserver === 'undefined') return null;
  let last = content.getBoundingClientRect();
  const ro = new ResizeObserver(() => {
    const next = content.getBoundingClientRect();
    const prev = last;
    last = next;
    if (next.height === prev.height || next.width !== prev.width) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const running = band.getAnimations();
    const from = running.length ? band.getBoundingClientRect().height : prev.height;
    running.forEach((a) => a.cancel());
    band.animate([{ height: `${from}px` }, { height: `${next.height}px` }], {
      duration: SLIDE_MS,
      easing: getComputedStyle(document.documentElement).getPropertyValue('--arrive') || 'ease-out',
    });
  });
  ro.observe(content);
  return ro;
}
