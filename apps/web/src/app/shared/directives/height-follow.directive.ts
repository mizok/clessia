import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

const DURATION_MS = 200;
/** `--arrive` 沒定義時的退路（同 styles.css #1634 的值） */
const ARRIVE_FALLBACK = 'cubic-bezier(0.23, 1, 0.32, 1)';

/**
 * 資料回來把內容撐高（或縮短）時，宿主的高度用滑的跟上，不是一下跳過去（#1853；使用者 10-22「跳改成滑」，
 * kb/wiki/architecture/motion.md）。
 *
 * ```html
 * <div class="coll__body" appHeightFollow>
 *   <div>…骨架 → 列表…</div>
 * </div>
 * ```
 *
 * 量的是宿主的**第一個子元素**（要是 block —— inline 的自訂元素量不到高度），動的是宿主的 `height`。
 * 只在「本來就有高度」的內容變高變矮時動：第一次出現（例如 `<details>` 剛打開、內容從 0 長出來）
 * 交給那個元件自己的展開過渡，不疊兩段。減少動態、沒有 WAAPI／ResizeObserver 時不動。
 *
 * 動的過程中 `overflow: clip`，結束就拿掉 —— 不會在平常狀態把焦點外框之類的切掉。
 */
@Directive({ selector: '[appHeightFollow]' })
export class HeightFollowDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private anim: Animation | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const content = this.host.firstElementChild;
      if (!content || typeof ResizeObserver === 'undefined') return;
      let last = 0;
      let hostHeight = this.host.offsetHeight;
      const observer = new ResizeObserver(([entry]) => {
        const next = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const prev = last;
        last = next;
        // 動畫進行中量到的是動畫的高度，不是「上一個靜止高度」
        const from = this.anim ? this.host.getBoundingClientRect().height : hostHeight;
        this.anim?.cancel();
        this.anim = null;
        hostHeight = this.host.offsetHeight;
        if (prev === 0 || next === 0 || prev === next) return;
        this.play(from, hostHeight);
      });
      observer.observe(content);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  private play(from: number, to: number): void {
    if (typeof this.host.animate !== 'function' || from === to) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const easing =
      getComputedStyle(document.documentElement).getPropertyValue('--arrive').trim() ||
      ARRIVE_FALLBACK;
    const anim = this.host.animate(
      [
        { height: `${from}px`, overflow: 'clip' },
        { height: `${to}px`, overflow: 'clip' },
      ],
      { duration: DURATION_MS, easing },
    );
    this.anim = anim;
    anim.finished
      .then(() => {
        if (this.anim === anim) this.anim = null;
      })
      .catch(() => undefined);
  }
}
