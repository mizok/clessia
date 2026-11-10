import { Injectable, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router, type CanDeactivateFn } from '@angular/router';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * 手機整頁表單（#2396 L4，`kb/wiki/architecture/dialog-frame.md`「整頁宿主」）。
 *
 * 同一支表單元件兩種宿主：桌機是 DynamicDialog，手機是頁面路由。表單只認得
 * `DynamicDialogRef`／`DynamicDialogConfig`，所以頁面宿主在自己的 `providers` 換上這支
 * ref —— 表單呼叫 `close()` 就是回來源頁，表單本身一行不改。
 */
@Injectable()
export class PageDialogRef extends DynamicDialogRef {
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** 存檔成功（`close` 帶了結果）：之後的離開不問 */
  saved = false;
  /** 直接打網址進來（沒有站內上一頁）時要回的地方 */
  fallback: unknown[] = ['/'];

  override close(result?: unknown): void {
    if (result) this.saved = true;
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) this.location.back();
    else void this.router.navigate(this.fallback);
  }
}

/** 頁面宿主實作這個：有改過、還沒存就問要不要放棄 */
export interface LeaveGuarded {
  canLeave(): boolean | Promise<boolean>;
}

export const formPageLeaveGuard: CanDeactivateFn<LeaveGuarded> = (page) => page.canLeave();
