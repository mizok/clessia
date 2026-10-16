import { Directive, ElementRef, effect, inject, input, untracked } from '@angular/core';

/**
 * 數字變化：新值從下方 4px 淡入 170ms（#1641 項 6，設計稿 kb/wiki/architecture/motion.md「數字變化」）。
 * 照 A6 `.dd__v.is-new`（a6.css:702）；**不做逐位滾動** —— A6 沒有，而且動畫期間數字看不清楚（Q5）。
 *
 * ```html
 * 到 <span [appValueArrive]="chapter.arrivedCount">{{ chapter.arrivedCount }}</span>／{{ total }}
 * ```
 *
 * 掛在**只包數字的那個元素**上 —— 整句一起動會讓旁邊不變的字也跟著跳。
 * 第一次出現、以及從「還沒有值」（null／undefined，例如載入中）變成有值都不算變化，不播；
 * 只有已經顯示過的數字換成另一個數字才播。
 *
 * 同 `StepMotionDirective`：WAAPI 跑在同一個元素上、不碰 DOM 結構，連續變化時新的直接蓋掉舊的。
 */
const DISTANCE_PX = 4;
const DURATION_MS = 170;
/** `--arrive` 沒定義時的退路（同 styles.css #1634 的值） */
const ARRIVE_FALLBACK = 'cubic-bezier(0.23, 1, 0.32, 1)';

@Directive({
  selector: '[appValueArrive]',
  // transform 對 inline 元素無效
  host: { style: 'display: inline-block' },
})
export class ValueArriveDirective {
  readonly appValueArrive = input.required<unknown>();

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    let prev: unknown = undefined;
    effect(() => {
      const value = this.appValueArrive();
      const changed = prev !== null && prev !== undefined && value !== prev;
      prev = value;
      if (changed) untracked(() => this.play());
    });
  }

  private play(): void {
    // 沒有 WAAPI（測試環境的 jsdom）就不動；先判斷它，jsdom 也沒有 matchMedia
    if (typeof this.el.animate !== 'function') return;
    // 減少動態：完全不動，新值直接出現（設計稿 Q3，照 A6）
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const easing =
      getComputedStyle(document.documentElement).getPropertyValue('--arrive').trim() ||
      ARRIVE_FALLBACK;
    this.el.animate(
      [
        { opacity: 0, transform: `translateY(${DISTANCE_PX}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: DURATION_MS, easing },
    );
  }
}
