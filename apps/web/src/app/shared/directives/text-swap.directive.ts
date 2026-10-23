import { DestroyRef, Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';

/**
 * 四個可調的值住在 styles.css 的 `--text-swap-*`（#2023：使用者覺得「淡入淡出很不明顯」，之後要再調只改那裡）。
 * 這裡的數字是變數沒定義時的退路，跟 styles.css 同值。
 */
const EXIT_FALLBACK_MS = 350;
const ENTER_FALLBACK_MS = 650;
const BLUR_FALLBACK = '8px';
/** 遮罩邊緣柔的寬度（漸層裡透明→不透明那一段佔多少）；越寬「由左到右」越看得出方向 */
const EDGE_FALLBACK = 40;
/** `--arrive`／`--leave` 沒定義時的退路（同 styles.css #1634 的值） */
const ARRIVE_FALLBACK = 'cubic-bezier(0.23, 1, 0.32, 1)';
const LEAVE_FALLBACK = 'cubic-bezier(0.4, 0, 1, 1)';
/**
 * 由左到右的遮罩：漸層寬 3 倍、邊緣柔 `--text-swap-edge`，`mask-position` 100% → 0% 時圖往右移，
 * 左邊那一段先掃進字裡。出場是「左邊先透明」、進場是「左邊先出現」。
 */
const MASK_SIZE = '300% 100%';
const masks = (edge: number) => {
  const a = 50 - edge / 2;
  const b = 50 + edge / 2;
  return {
    exit: `linear-gradient(90deg, transparent ${a}%, #000 ${b}%)`,
    enter: `linear-gradient(90deg, #000 ${a}%, transparent ${b}%)`,
  };
};

/** `350ms`／`0.35s`／空字串 → 毫秒 */
function ms(value: string, fallback: number): number {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return fallback;
  return value.trim().endsWith('ms') ? n : value.trim().endsWith('s') ? n * 1000 : n;
}

function maskFrame(image: string, position: string): Keyframe {
  return {
    maskImage: image,
    maskSize: MASK_SIZE,
    maskRepeat: 'no-repeat',
    maskPosition: position,
    // Safari 的 mask 還有一部分要前綴
    webkitMaskImage: image,
    webkitMaskSize: MASK_SIZE,
    webkitMaskRepeat: 'no-repeat',
    webkitMaskPosition: position,
  } as Keyframe;
}

/**
 * 文字替換（#1895，設計 kb/wiki/architecture/motion.md「文字替換」）：API 回來才產生的字換掉時，
 * 舊字由左到右模糊淡出，新字再由左到右從模糊變清晰淡入；骨架／空白換成字只做淡入那一半。
 *
 * ```html
 * <h1 appTextSwap>…投影進來的句子…</h1>
 * ```
 *
 * **看宿主自己的 DOM 變化（MutationObserver），不吃 input**：頁首句子是各頁投影進 `app-page-open` 的，
 * 掛在 page-open 的 h1／p 上一處改、全站生效；而且 Angular 換字當下舊字已經沒了，本來就要自己留複本。
 *
 * - 舊字是上一次定下來時的 `cloneNode`，**插在宿主外面**（sibling、絕對定位對齊宿主）。
 *   放在裡面的話觀察者會看到自己插的節點、`textContent` 也會算進複本的字 → 誤判、自己觸發自己（計畫席 10-23）。
 * - 新字一開始就在版面裡（高度變化交給 appHeightFollow），宿主的進場延後到出場播完、`fill: backwards` 先壓透明。
 * - 字串沒變不動；連續換值打斷前一段、拿掉複本，最新的值直接進場；減少動態直接換。
 * - 複本 `aria-hidden`、`inert`、`pointer-events: none`：讀屏只念宿主裡的新字一次，點擊不被擋。
 */
@Directive({ selector: '[appTextSwap]' })
export class TextSwapDirective {
  /**
   * 停用：`[appTextSwap]="false"`（只寫 `appTextSwap` 照舊是開）。停用時照樣記下內容、不播，
   * 中途打開也接得上（使用者 10-23：儀表板頁首的補習班名稱不要動畫，見 page-open 的 `titleSwap`）。
   */
  readonly enabled = input(true, {
    alias: 'appTextSwap',
    transform: (v: boolean | '') => v !== false,
  });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** 上一次定下來的內容（宿主本身的深複本） */
  private settled: HTMLElement | null = null;
  /**
   * 那份內容當時的寬（取小數）。複本要用**舊字自己的寬**：用宿主現在（新字）的寬的話，
   * 舊字比較寬時最後幾個字會折到下一行（「找到 0 位」→「找到 1 位」，數字不是等寬字，#1983 實測）；
   * `offsetWidth` 也不行，它取整（實寬 114.47 給 114）。
   */
  private settledWidth = 0;
  private clone: HTMLElement | null = null;
  private running: Animation[] = [];

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // 第一次畫出來的字只記下、不播（頁面切換時 page-open 重建）
      this.settled = this.snapshot();
      if (typeof MutationObserver === 'undefined') return;
      let queued = false;
      const observer = new MutationObserver(() => {
        // 同一輪變更檢查的多筆變化合成一次換字
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          this.swap();
        });
      });
      observer.observe(this.host, { characterData: true, childList: true, subtree: true });
      destroyRef.onDestroy(() => {
        observer.disconnect();
        this.stop();
      });
    });
  }

  private snapshot(): HTMLElement {
    this.settledWidth = this.host.getBoundingClientRect().width;
    return this.host.cloneNode(true) as HTMLElement;
  }

  private swap(): void {
    const old = this.settled;
    const oldWidth = this.settledWidth;
    const next = this.snapshot();
    if ((old?.textContent ?? '').trim() === (next.textContent ?? '').trim()) {
      this.settled = next;
      return;
    }
    // 連續換值：前一段還在播就打斷，接最新的值，不排隊
    const interrupted = this.running.length > 0;
    this.stop();
    this.settled = next;
    if (!this.enabled()) return;
    if (typeof this.host.animate !== 'function') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const root = getComputedStyle(document.documentElement);
    const arrive = root.getPropertyValue('--arrive').trim() || ARRIVE_FALLBACK;
    const leave = root.getPropertyValue('--leave').trim() || LEAVE_FALLBACK;
    const exitMs = ms(root.getPropertyValue('--text-swap-exit'), EXIT_FALLBACK_MS);
    const enterMs = ms(root.getPropertyValue('--text-swap-enter'), ENTER_FALLBACK_MS);
    const blur = `blur(${root.getPropertyValue('--text-swap-blur').trim() || BLUR_FALLBACK})`;
    const edge = parseFloat(root.getPropertyValue('--text-swap-edge'));
    const { exit: exitMask, enter: enterMask } = masks(Number.isNaN(edge) ? EDGE_FALLBACK : edge);
    const hasOld = !interrupted && !!old && (old.textContent ?? '').trim() !== '';

    if (hasOld) {
      const clone = old!;
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      clone.setAttribute('aria-hidden', 'true');
      // 第二階段的宿主有的包著按鈕（#1983）：複本裡的按鈕不能被 Tab 到
      clone.inert = true;
      clone.removeAttribute('appTextSwap');
      Object.assign(clone.style, {
        position: 'absolute',
        top: `${this.host.offsetTop}px`,
        left: `${this.host.offsetLeft}px`,
        width: `${oldWidth}px`,
        margin: '0',
        pointerEvents: 'none',
      });
      this.host.after(clone);
      this.clone = clone;
      const exit = clone.animate(
        [
          { opacity: 1, filter: 'blur(0)', ...maskFrame(exitMask, '100% 0') },
          { opacity: 0, filter: blur, ...maskFrame(exitMask, '0% 0') },
        ],
        { duration: exitMs, easing: leave, fill: 'forwards' },
      );
      exit.finished
        .then(() => {
          this.running = this.running.filter((a) => a !== exit);
          if (this.clone === clone) {
            clone.remove();
            this.clone = null;
          }
        })
        .catch(() => undefined);
      this.running.push(exit);
    }

    const enter = this.host.animate(
      [
        { opacity: 0, filter: blur, ...maskFrame(enterMask, '100% 0') },
        { opacity: 1, filter: 'blur(0)', ...maskFrame(enterMask, '0% 0') },
      ],
      hasOld
        ? { duration: enterMs, easing: arrive, delay: exitMs, fill: 'backwards' }
        : { duration: enterMs, easing: arrive },
    );
    this.running.push(enter);
    enter.finished
      .then(() => {
        this.running = this.running.filter((a) => a !== enter);
      })
      .catch(() => undefined);
  }

  private stop(): void {
    this.running.forEach((a) => a.cancel());
    this.running = [];
    this.clone?.remove();
    this.clone = null;
  }
}
