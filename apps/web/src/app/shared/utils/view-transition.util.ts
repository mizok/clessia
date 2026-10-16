import { ApplicationRef, inject } from '@angular/core';

/** 頁內 VT 進行中時掛在 `<html>` 上；styles.css 用它決定 `.vt-seg` 的名字生不生效 */
export const IN_PAGE_VT_ATTR = 'data-vt';

/**
 * 頁內模式切換的同文件 view transition（#1641 項 4，設計稿 kb/wiki/architecture/motion.md）。
 *
 * ```ts
 * private readonly viewTransition = injectViewTransition();
 * this.viewTransition(() => this.items.set(res.data));
 * ```
 *
 * **只給低頻、一次一下的切換**（日／週、篩選分段鈕）。換週箭頭這種連點的不能用 ——
 * VT 動畫期間點擊一律打到 `<html>`，第二下會被吞掉（W3C CSS View Transitions §7.1.1，
 * 實測見設計稿 §3）；那些用 `StepMotionDirective`。
 *
 * **要包在「畫面真的換掉」的那一刻**：打 API 的切換，包的是回應套進 signal 那一行，
 * 不是點擊。包錯地方的話，VT 只拍到點擊當下幾乎沒變的畫面，內容還是瞬間跳。
 *
 * 動畫本身不在這裡：內容區（`route-content`）沿用換頁的同層淡入淡出（styles.css）。
 * 分段鈕選中的那一顆加 `vt-seg` class 並給一個唯一的 `view-transition-name`，就會平移到新位置；
 * 那個名字只在頁內 VT 期間生效（`<html data-vt="in-page">`），換頁時它不會脫離內容區單獨動。
 *
 * 不做的時候直接執行 `update`：瀏覽器不支援、分頁在背景、使用者開了「減少動態」（設計稿 Q3，照 A6）。
 */
export function injectViewTransition(): (update: () => void) => void {
  const appRef = inject(ApplicationRef);
  return (update) => {
    if (
      typeof document.startViewTransition !== 'function' ||
      document.hidden ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      update();
      return;
    }
    const root = document.documentElement;
    root.setAttribute(IN_PAGE_VT_ATTR, 'in-page');
    const vt = document.startViewTransition(() => {
      update();
      // zoneless：signal 改了之後畫面要等 Angular 的排程才更新，而 VT 在 callback 結束時就拍新畫面。
      // 這裡同步跑一次變更偵測，讓新畫面在 callback 回傳前就畫進 DOM。
      appRef.tick();
    });
    // 被下一個 VT（含換頁）中斷時 finished 一樣會結束，所以不管成敗都拿掉
    vt.finished.finally(() => root.removeAttribute(IN_PAGE_VT_ATTR));
  };
}
