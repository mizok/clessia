import type { ActivatedRouteSnapshot } from '@angular/router';
import type { ViewTransitionInfo } from '@angular/router';

/**
 * 換頁的方向感（#1641，設計稿 kb/wiki/architecture/motion.md「換頁」）。
 *
 * 方向只看**網址段數**：`/admin/students`（2）→ `/admin/students/:id`（3）是往深一層，
 * 反過來是返回，段數一樣是同層（選單切換、設定頁的 tab）。刻意不另外維護層級表 ——
 * 新增路由不用記得多填一欄，瀏覽器的「上一頁」也照段數走，跟使用者看到的層級一致。
 */
export type RouteDirection = 'forward' | 'back' | 'lateral';

/** 方向寫在 `<html data-route-dir>` 上，styles.css 的 `::view-transition-*(route-content)` 讀它 */
export const ROUTE_DIR_ATTR = 'data-route-dir';

/** 從根往下走到最深的那一層，把每一層的網址段數加總 */
export function urlDepth(snapshot: ActivatedRouteSnapshot | null | undefined): number {
  let depth = 0;
  for (let r = snapshot; r; r = r.firstChild) depth += r.url.length;
  return depth;
}

export function routeDirection(fromDepth: number, toDepth: number): RouteDirection {
  if (toDepth > fromDepth) return 'forward';
  if (toDepth < fromDepth) return 'back';
  return 'lateral';
}

/**
 * `withViewTransitions({ onViewTransitionCreated })` 的 callback。
 *
 * - **減少動態**：直接 `skipTransition()` —— 畫面照樣換，只是不走過程（設計稿 Q3，照 A6 全關）。
 * - 其餘情況：把方向寫到 `<html>`，transition 結束後拿掉。
 *
 * 用 data 屬性而不是 VT types（`:active-view-transition-type()`）：Safari 18.0–18.1
 * 有 VT 但沒有 types；屬性在所有支援 VT 的瀏覽器上都成立。
 */
export function onRouteViewTransition({ transition, from, to }: ViewTransitionInfo): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    transition.skipTransition();
    return;
  }
  const root = document.documentElement;
  root.setAttribute(ROUTE_DIR_ATTR, routeDirection(urlDepth(from), urlDepth(to)));
  // finished 在 skip 時也會 resolve；被下一個 VT 中斷時同樣要清，所以不管成敗都拿掉
  transition.finished.finally(() => root.removeAttribute(ROUTE_DIR_ATTR));
}
