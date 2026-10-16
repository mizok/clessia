import { ApplicationRef, inject } from '@angular/core';

/** 頁內 VT 進行中時掛在 `<html>` 上；styles.css 用它決定 `.vt-seg` 的名字生不生效 */
export const IN_PAGE_VT_ATTR = 'data-vt';

/** 最後一次頁內 VT 的序號。被下一個 VT 截掉的那個，結束時不能拿掉後一個剛寫上的屬性 */
let latestInPageVt = 0;

/**
 * 進行中的頁內 VT。新的一個要等它播完才開始（#1641 5b）：點擊時起了一個 VT、資料在它播完前就回來，
 * 「套資料」那一個若直接開始，會把前一個截掉（W3C §6.1.1），畫面反而跳一下。
 */
let running: Promise<void> | null = null;

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
 * 那個名字只在頁內 VT 期間生效（`<html data-vt>`），換頁時它不會脫離內容區單獨動。
 * 列表的 `.vt-row` 只在 `{ rows: true }`（`data-vt="rows"`）時生效。
 *
 * 不做的時候直接執行 `update`：瀏覽器不支援、分頁在背景、使用者開了「減少動態」（設計稿 Q3，照 A6）。
 */
export interface ViewTransitionOptions {
  /**
   * 這次是「列表增刪」（#1641 項 5）：`.vt-row` 的名字生效，新列淡入、刪掉的淡出、其餘補位。
   * 篩選、換條件不要給 —— 那是整份換掉，每一列都跑一次進場反而吵（設計稿 motion.md「列表」）。
   */
  readonly rows?: boolean;
}

export function injectViewTransition(): (
  update: () => void,
  options?: ViewTransitionOptions,
) => void {
  const appRef = inject(ApplicationRef);
  const run = (update: () => void, options?: ViewTransitionOptions): void => {
    if (
      typeof document.startViewTransition !== 'function' ||
      document.hidden ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      update();
      return;
    }
    if (running) {
      running.then(() => run(update, options));
      return;
    }
    const root = document.documentElement;
    const mine = ++latestInPageVt;
    root.setAttribute(IN_PAGE_VT_ATTR, options?.rows ? 'rows' : 'in-page');
    const vt = document.startViewTransition(() => {
      update();
      // zoneless：signal 改了之後畫面要等 Angular 的排程才更新，而 VT 在 callback 結束時就拍新畫面。
      // 這裡同步跑一次變更偵測，讓新畫面在 callback 回傳前就畫進 DOM。
      appRef.tick();
    });
    // 不管成敗都要拿掉 —— 但只在自己還是最後一個的時候：被下一個頁內 VT 截掉時，
    // 這個 finished 會晚於下一個寫上屬性才結束，拿掉的話下一個的分段鈕就不會平移
    const finished = vt.finished.finally(() => {
      if (mine === latestInPageVt) root.removeAttribute(IN_PAGE_VT_ATTR);
      if (running === finished) running = null;
    });
    running = finished;
  };
  return run;
}
