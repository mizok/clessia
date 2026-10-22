import { DestroyRef, Directive, inject } from '@angular/core';
import { Popover } from 'primeng/popover';

/** 浮層跟按鈕之間（PrimeNG 的 `popover.gutter`，用 margin 做：往下是 margin-top、翻上去是 margin-bottom） */
const GAP = 10;
/** 浮層跟視窗邊緣至少留這麼多 */
const MARGIN = 8;

export interface PopoverPlacement {
  /** 翻到按鈕上方 */
  readonly up: boolean;
  /** 浮層外框的 top（視窗座標，不含 gutter —— 那段是 PrimeNG 的 margin） */
  readonly top: number;
  /** `.p-popover-content` 的最大高度；超過就在裡面捲動 */
  readonly contentMax: number;
}

/**
 * 篩選浮層要放哪裡（#1873）。純計算，給 `FitPopoverDirective` 用、也方便單獨測。
 *
 * - 下方放得下就放下方；放不下而上方比較大就翻上去；兩邊都不夠就放在比較大的那邊、內部捲動
 * - `chrome`：外框比內容多出來的高度（邊框、內距），最大高度要扣掉它才是內容區能用的
 */
export function placePopover(o: {
  anchorTop: number;
  anchorBottom: number;
  /**
   * 看得到的那一塊的上緣（`visualViewport.offsetTop`）。按鈕的座標是 layout viewport 的；
   * iOS 鍵盤彈出、兩指放大時看得到的那塊不從 0 開始（二讀）。預設 0
   */
  viewportTop?: number;
  viewportHeight: number;
  naturalHeight: number;
  chrome: number;
}): PopoverPlacement {
  const top0 = o.viewportTop ?? 0;
  const below = top0 + o.viewportHeight - o.anchorBottom - GAP - MARGIN;
  const above = o.anchorTop - top0 - GAP - MARGIN;
  // 剛好放得下、或上下一樣大都不翻（嚴格大於）
  const up = o.naturalHeight > below && above > below;
  // 視窗矮到兩邊都不夠時 space 會是負的：夾到 0，否則翻上去的 top 會跑到按鈕下面
  const space = Math.max(0, up ? above : below);
  const height = Math.min(o.naturalHeight, space);
  return {
    up,
    top: up ? o.anchorTop - height : o.anchorBottom,
    contentMax: Math.max(0, space - o.chrome),
  };
}

/**
 * PrimeNG Popover 的「依可用空間放」（#1873）：PrimeNG 只在打開那一刻擺一次、不限高度，
 * 內容一長（例：課程篩選打開「含歷史班級」多兩個日期欄）就超出視窗，翻到上方時還會切掉上面。
 *
 * ```html
 * <p-popover appFitPopover styleClass="filter-popover">…</p-popover>
 * ```
 *
 * 打開後接手 top：最大高度＝按鈕到視窗邊緣的可用空間，超出的在 `.p-popover-content` 裡捲動
 * （設在外框會把箭頭一起切掉）；內容高度一變就重算。視窗高用 `visualViewport`，不用 viewport 單位（c6）。
 * 手機的左右內縮仍在 styles.css（`.filter-popover`），這裡只管上下。
 */
@Directive({ selector: 'p-popover[appFitPopover]' })
export class FitPopoverDirective {
  private readonly popover = inject(Popover);
  private observer: ResizeObserver | null = null;

  constructor() {
    const show = this.popover.onShow.subscribe(() => this.start());
    const hide = this.popover.onHide.subscribe(() => this.stop());
    inject(DestroyRef).onDestroy(() => {
      show.unsubscribe();
      hide.unsubscribe();
      this.stop();
    });
  }

  private start(): void {
    this.fit();
    const content = this.content();
    if (!content || typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver(() => this.fit());
    for (const child of Array.from(content.children)) this.observer.observe(child);
  }

  private stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private content(): HTMLElement | null {
    return (this.popover.container?.querySelector('.p-popover-content') as HTMLElement) ?? null;
  }

  private fit(): void {
    const box = this.popover.container as HTMLElement | null;
    const target = this.popover.target as HTMLElement | null;
    const content = this.content();
    if (!box || !target || !content) return;
    // 先拿掉上一次的限制，量自然高度
    content.style.maxHeight = '';
    const naturalHeight = box.offsetHeight;
    const chrome = naturalHeight - content.offsetHeight;
    const r = target.getBoundingClientRect();
    const vv = globalThis.visualViewport;
    const p = placePopover({
      anchorTop: r.top,
      anchorBottom: r.bottom,
      viewportTop: vv?.offsetTop ?? 0,
      viewportHeight: vv?.height ?? document.documentElement.clientHeight,
      naturalHeight,
      chrome,
    });
    content.style.maxHeight = `${p.contentMax}px`;
    content.style.overflowY = 'auto';
    content.style.overscrollBehavior = 'contain';
    // PrimeNG 掛在 body 用文件座標：加回捲動量
    box.style.top = `${p.top + scrollY}px`;
    // 箭頭朝向：PrimeNG 翻上去時加這個 class（箭頭畫在下緣）
    box.classList.toggle('p-popover-flipped', p.up);
    if (p.up) box.setAttribute('data-p-popover-flipped', 'true');
    else box.removeAttribute('data-p-popover-flipped');
  }
}
