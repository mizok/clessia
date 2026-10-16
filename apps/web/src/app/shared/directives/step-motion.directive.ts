import { Directive, ElementRef, effect, inject, input, untracked } from '@angular/core';

/**
 * 換週／換日的「方向淡入」（#1641 項 3，設計稿 kb/wiki/architecture/motion.md「連點型控制項」）。
 *
 * **刻意不用 view transition**：VT 動畫期間所有點擊都打到 `<html>`（W3C CSS View
 * Transitions §7.1.1），實測包了 VT 之後連點「下一週」兩下只前進一週。換週是老師的日常連點操作。
 *
 * **也不用 `@for` 換 key 重建 DOM 再 `animate.enter`**：行政課表的週視圖裡有甘特圖，
 * 每換一週就整塊重建太貴。這支只在「新內容已經套上」那一刻對同一個元素跑一段 WAAPI，
 * 不碰 DOM 結構、不擋點擊；連點時新的動畫直接蓋掉舊的。
 *
 * 呼叫端在**資料套上的那一刻**給一個新的 `stepMotion(dir)` —— 不是點擊那一刻：
 * 換週要打 API，點擊當下畫面還是舊的。
 */
export type StepDir = 'forward' | 'back';

export interface StepMotion {
  readonly dir: StepDir;
  /** 建立時間。元素因為別的原因重建（例如重試）時，不重播很久以前的那一步 */
  readonly at: number;
}

export function stepMotion(dir: StepDir): StepMotion {
  return { dir, at: performance.now() };
}

/** 超過這個時間的 motion 視為過期（元素重建時不重播） */
const STALE_MS = 500;
const DISTANCE_PX = 12;
const DURATION_MS = 200;
/** `--arrive` 沒定義時的退路（同 styles.css #1634 的值） */
const ARRIVE_FALLBACK = 'cubic-bezier(0.23, 1, 0.32, 1)';

@Directive({ selector: '[appStepMotion]' })
export class StepMotionDirective {
  readonly appStepMotion = input<StepMotion | null>(null);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    effect(() => {
      const m = this.appStepMotion();
      if (!m || performance.now() - m.at > STALE_MS) return;
      untracked(() => this.play(m.dir));
    });
  }

  private play(dir: StepDir): void {
    // 沒有 WAAPI（測試環境的 jsdom）就不動；先判斷它，jsdom 也沒有 matchMedia
    if (typeof this.el.animate !== 'function') return;
    // 減少動態：完全不動（設計稿 Q3，照 A6）
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const easing =
      getComputedStyle(document.documentElement).getPropertyValue('--arrive').trim() ||
      ARRIVE_FALLBACK;
    const from = dir === 'forward' ? DISTANCE_PX : -DISTANCE_PX;
    this.el.animate(
      [
        { opacity: 0, transform: `translateX(${from}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: DURATION_MS, easing },
    );
  }
}
