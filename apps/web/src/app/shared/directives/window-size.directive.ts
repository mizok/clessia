import { DestroyRef, Directive, inject, OnInit, input, HostListener } from '@angular/core';
import { DOCUMENT } from '@angular/common';

/**
 * 把視窗尺寸寫成 CSS 變數，取代 `vh` / `vw`（憲法 c6）。
 *
 * **變數寫在 `document.documentElement`（`<html>`），不是 host 元素。**
 *
 * 原本寫在 host（`.app`）上，而 PrimeNG 的 overlay 有三支是硬寫
 * `[appendTo]="'body'"` 的底部抽屜 —— 它們掛在 `.app` **外面**，繼承鏈上沒有那個
 * 變數，於是永遠吃 `.drawer-auto` 的 fallback：
 *
 * ```scss
 * max-height: calc(var(--window-height, 667px) * 0.8);   // → 533.6px，寫死
 * ```
 *
 * **每一台手機都被鎖在 533px**，不論它有多高。寫到 `<html>` 之後，任何位置的元素
 * （含未來新增的 body-append overlay）都解得到，而 `.app` 自己靠繼承拿到同一個值，
 * 行為不變。
 *
 * ⚠️ **這是全域寫入。** `widthVar` / `heightVar` 兩個 input 是為了讓呼叫端換名字，
 * 但現在它們落在同一個根元素上 —— 掛第二個實例並取不同名字是可以的，
 * 掛第二個實例用相同名字則會互相覆寫。目前只有 `app.component.html` 一個使用點。
 */
@Directive({
  selector: '[appWindowSize]',
  standalone: true,
})
export class WindowSizeDirective implements OnInit {
  readonly widthVar = input('--window-width');
  readonly heightVar = input('--window-height');

  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit() {
    this.updateSize();
    const window = this.document.defaultView;
    if (!window) return;

    // 回到前景重量（#2033，使用者 iPhone 實機）：主畫面 PWA 跳到 Safari（LINE 登入）再回來，
    // iOS 在背景期間改了視窗高，回到前景**不一定發 resize** → --window-height 停在舊值，底部空一塊白。
    // 等下一幀再量：iOS 剛回前景那一刻版面還沒穩。背景（hidden）時量到的高度不可信，不量。
    const remeasure = () => window.requestAnimationFrame(() => this.updateSize());
    const onVisibility = () => {
      if (this.document.visibilityState === 'visible') remeasure();
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', remeasure);
    window.addEventListener('focus', remeasure);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', remeasure);
      window.removeEventListener('focus', remeasure);
    });

    // 手機鍵盤（#1776）：版面視窗不跟著鍵盤縮，visual viewport 會（iOS 捲動時還會往下移）。
    // 底部抽屜用 --keyboard-inset 讓出被鍵盤蓋住的那一截。visual viewport 的 resize 也重量視窗高（#2033）：
    // iOS 有時只發這一個
    const vv = window.visualViewport;
    if (!vv) return;
    const onVvResize = () => this.updateSize();
    const onVvScroll = () => this.updateKeyboardInset();
    vv.addEventListener('resize', onVvResize);
    vv.addEventListener('scroll', onVvScroll);
    this.destroyRef.onDestroy(() => {
      vv.removeEventListener('resize', onVvResize);
      vv.removeEventListener('scroll', onVvScroll);
    });
  }

  @HostListener('window:resize')
  onResize() {
    this.updateSize();
  }

  private updateSize() {
    const window = this.document.defaultView;
    if (!window) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // `documentElement` 而不是 host —— 見類別註解。這一行是三支 body-append 抽屜
    // 從「鎖死 533px」變成「跟著螢幕高」的全部原因。
    // **量到 0 或非有限值就不寫，保留上一個值**（#1905）。寫進 0 的話，所有 `calc(var(--window-height) - …)`
    // 都變負數 → max-height 0 → 底部面板、對話框整塊不見；var() 的 fallback 只在「沒定義」時生效，擋不住 0。
    const root = this.document.documentElement;
    if (Number.isFinite(width) && width > 0) root.style.setProperty(this.widthVar(), `${width}px`);
    if (Number.isFinite(height) && height > 0)
      root.style.setProperty(this.heightVar(), `${height}px`);
    this.updateKeyboardInset();
  }

  private updateKeyboardInset() {
    const window = this.document.defaultView;
    const vv = window?.visualViewport;
    const inset = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    this.document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
  }
}
