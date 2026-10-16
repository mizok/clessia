import type { WritableSignal } from '@angular/core';
import type { Observable } from 'rxjs';
import { injectViewTransition } from './view-transition.util';

export interface OptimisticRemoveHandlers {
  /** 刪除成功：通常是成功 toast＋背景重抓（不要切回骨架） */
  readonly next?: () => void;
  /** 刪除失敗：那一列已經放回去了，這裡**一定要讓使用者知道**（toast 或對話框） */
  readonly error: (err: unknown) => void;
}

/**
 * 樂觀刪除（#1641 5b，使用者 10-16 13:56 裁定第 1 點）。
 *
 * ```ts
 * private readonly optimisticRemove = injectOptimisticRemove();
 * this.optimisticRemove(this.rows, (r) => r.id === id, this.service.delete(id), {
 *   next: () => { toast; this.load({ quiet: true }); },
 *   error: () => toast,
 * });
 * ```
 *
 * - 按下刪除的那一刻那一列就淡出、其餘補位（頁內 VT `{ rows: true }`）
 * - **失敗：那一列放回原位（淡入），再交給 `error`**。不能出現「畫面上不見了、其實沒刪掉」。
 *   `error` 是必填 —— 刻意不給預設，免得有人漏了提示。
 * - 放回去的是**刪除前的整份清單**：刪除期間若有背景重抓改了清單，以刪除前為準（下一次重抓會再對齊）。
 */
export function injectOptimisticRemove(): <T>(
  list: WritableSignal<T[]>,
  isTarget: (item: T) => boolean,
  request: Observable<unknown>,
  handlers: OptimisticRemoveHandlers,
) => void {
  const viewTransition = injectViewTransition();
  return (list, isTarget, request, handlers) => {
    const before = list();
    viewTransition(() => list.set(before.filter((item) => !isTarget(item))), { rows: true });
    request.subscribe({
      next: () => handlers.next?.(),
      error: (err) => {
        viewTransition(() => list.set(before), { rows: true });
        handlers.error(err);
      },
    });
  };
}
