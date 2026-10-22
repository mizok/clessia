import { DestroyRef, Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';

const DURATION_MS = 200;
/**
 * 距離長的滑久一點（#1859 第 4 張）：`--arrive` 是前快後慢，200ms 滑 1300px（儀表板手機：骨架換成整串名單）
 * 第一幀就走掉 1/3（實測 445px），看起來還是跳。每 px 0.4ms、最長 500ms —— 500px 以內維持 200ms 不變。
 */
const MS_PER_PX = 0.4;
const MAX_DURATION_MS = 500;
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
 * 量的是宿主的**第一個在文流中的子元素**（要是 block —— inline 的自訂元素量不到高度），動的是宿主的 `height`。
 * 絕對／固定定位的子元素跳過（#1859：頁首色面的第一個子元素是鋪滿的流場層，它的高度跟著宿主變，量它會自己追自己）。
 * 只在「本來就有高度」的內容變高變矮時動：第一次出現（例如 `<details>` 剛打開、內容從 0 長出來）
 * 交給那個元件自己的展開過渡，不疊兩段。減少動態、沒有 WAAPI／ResizeObserver 時不動。
 *
 * `appHeightFollowGrow`：連「從 0 長出來／收回 0」也滑 —— 給**資料回來才出現、自己沒有展開過渡**的東西
 * （帳單頁的「N 筆報名還沒開帳單」提示，出現時把下面整個清單往下推）。頁面剛畫出來那一次量到的高度只記下、不動。
 *
 * 動的過程中 `overflow: clip`，結束就拿掉 —— 不會在平常狀態把焦點外框之類的切掉。
 */
@Directive({ selector: '[appHeightFollow]' })
export class HeightFollowDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private anim: Animation | null = null;
  /** 從 0 長出來／收回 0 也滑（見上） */
  readonly grow = input(false, {
    alias: 'appHeightFollowGrow',
    transform: (v: boolean | '') => v !== false,
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const content =
        [...this.host.children].find(
          (el) => !/^(absolute|fixed)$/.test(getComputedStyle(el).position),
        ) ?? null;
      if (!content || typeof ResizeObserver === 'undefined') return;
      let last = 0;
      let first = true;
      let hostHeight = this.host.offsetHeight;
      const observer = new ResizeObserver(([entry]) => {
        const next = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const prev = last;
        last = next;
        const initial = first;
        first = false;
        // 動畫進行中量到的是動畫的高度，不是「上一個靜止高度」
        const from = this.anim ? this.host.getBoundingClientRect().height : hostHeight;
        this.anim?.cancel();
        this.anim = null;
        hostHeight = this.host.offsetHeight;
        if (prev === next) return;
        if (this.grow() ? initial : prev === 0 || next === 0) return;
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
      {
        duration: Math.min(MAX_DURATION_MS, Math.max(DURATION_MS, Math.abs(to - from) * MS_PER_PX)),
        easing,
      },
    );
    // 停在第一格（舊高度）、下一幀才開始走：建立動畫的這一幀常常很重（剛畫出一整串列，dev 實測 60ms），
    // 直接 play 的話時間從這一幀算起，畫面上第一次看到的已經是 1/3 的位置（儀表板手機一步 500px）
    anim.pause();
    requestAnimationFrame(() => {
      if (this.anim === anim) anim.play();
    });
    this.anim = anim;
    anim.finished
      .then(() => {
        if (this.anim === anim) this.anim = null;
      })
      .catch(() => undefined);
  }
}
