import {
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
} from '@angular/core';

/**
 * 週列「選中底線」的平移（#1641 項 3，設計稿 motion.md）。
 *
 * 原本每一格自己畫 `border-b-2`，換選中是一格消失、另一格出現。這支把底線收成容器上的
 * **一條**（styles.css `.selected-indicator::after`），量選中那一格的 `offsetLeft`／`offsetWidth`
 * 寫成 `--indicator-x`／`--indicator-w`，底線用 CSS transition 移過去。
 *
 * 用量的而不是用「第 i 格 × 1/7」算：老師課表手機版的週列是橫捲的，格子寬度不是容器的 1/7。
 * 容器自己就是定位基準（`position: relative`），所以橫捲時底線跟著內容一起捲。
 *
 * 第一次量完才加 `--ready`，進頁時底線直接出現在選中格下，不會從左邊滑進來。
 */
@Directive({
  selector: '[appSelectedIndicator]',
  host: { class: 'selected-indicator' },
})
export class SelectedIndicatorDirective {
  /** 選中的是誰（日期字串等）。值一變就重量 */
  readonly appSelectedIndicator = input<unknown>();
  /** 怎麼找到選中的那一格 */
  readonly indicatorFor = input('[aria-pressed="true"]');

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  constructor() {
    effect(() => {
      this.appSelectedIndicator();
      const selector = this.indicatorFor();
      afterNextRender(() => this.measure(selector), { injector: this.injector });
    });

    // 寬度變了（轉向、側欄收合）格子位置會跟著變
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => this.measure(this.indicatorFor()));
      ro.observe(this.el);
      inject(DestroyRef).onDestroy(() => ro.disconnect());
    }
  }

  private measure(selector: string): void {
    const target = this.el.querySelector<HTMLElement>(selector);
    if (!target) {
      this.el.style.setProperty('--indicator-w', '0px');
      return;
    }
    // offsetLeft 是相對 offsetParent；容器 position: relative，但格子外面可能還包著 <li>
    let x = 0;
    for (
      let n: HTMLElement | null = target;
      n && n !== this.el;
      n = n.offsetParent as HTMLElement | null
    ) {
      x += n.offsetLeft;
    }
    this.el.style.setProperty('--indicator-x', `${x}px`);
    this.el.style.setProperty('--indicator-w', `${target.offsetWidth}px`);
    this.el.classList.add('selected-indicator--ready');
  }
}
