import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * 內容高度變了，宿主的高度用滑的（#1859，使用者 10-22「跳改成滑沒有問題」）。
 *
 * 資料晚到撐開、或載入中的佔位比實際內容高，原本整塊一次跳到新高度，下面的東西跟著跳。
 * 這支觀察宿主**在文流中的子元素**（絕對定位的裝飾層跟著宿主高度變，觀察它會自己追自己），
 * 一變就用 WAAPI 把宿主的 `height` 從舊值滑到新值；動畫期間 `overflow: clip`，結束還原，
 * 平常不裁掉焦點框。
 *
 * - 不需要包裝層：宿主是 `flex flex-col` 的區塊也能直接掛，不改它的版面
 * - 寬度變了（視窗縮放、換行重排）不滑；減少動態不滑
 * - 連續變化：從畫面上目前的高度接著滑，不跳回上一個終點
 */
@Directive({ selector: '[appSlideHeight]' })
export class SlideHeightDirective {
  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const stop = slideHeight(host);
      destroyRef.onDestroy(stop);
    });
  }
}

/** 進場的時長（同 #1634 的彈出物）；曲線讀 styles.css 的 `--arrive` */
const SLIDE_MS = 200;

export function slideHeight(host: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  let last = host.getBoundingClientRect();

  const onResize = () => {
    const running = host.getAnimations();
    const from = running.length ? host.getBoundingClientRect().height : last.height;
    running.forEach((a) => a.cancel());
    const next = host.getBoundingClientRect();
    const widthChanged = next.width !== last.width;
    last = next;
    if (widthChanged || next.height === from) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const overflow = host.style.overflow;
    host.style.overflow = 'clip';
    const anim = host.animate([{ height: `${from}px` }, { height: `${next.height}px` }], {
      duration: SLIDE_MS,
      easing: getComputedStyle(document.documentElement).getPropertyValue('--arrive') || 'ease-out',
    });
    const restore = () => (host.style.overflow = overflow);
    anim.finished.then(restore, restore);
  };

  const ro = new ResizeObserver(onResize);
  const watch = (el: Element) => {
    if (!/^(absolute|fixed)$/.test(getComputedStyle(el).position)) ro.observe(el);
  };
  [...host.children].forEach(watch);
  // 晚到的區塊是新加進來的子元素（@if 換分支）：加進來就開始觀察，並把這次的高度變化算一次
  const mo = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n instanceof Element && watch(n));
    onResize();
  });
  mo.observe(host, { childList: true });

  return () => {
    ro.disconnect();
    mo.disconnect();
  };
}
