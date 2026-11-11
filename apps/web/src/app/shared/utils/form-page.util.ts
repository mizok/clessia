import { Injectable, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * 手機整頁表單（#2396 L4，`kb/wiki/architecture/dialog-frame.md`「整頁宿主」）。
 *
 * 同一支表單元件兩種宿主：桌機是 DynamicDialog，手機是頁面路由。表單只認得
 * `DynamicDialogRef`／`DynamicDialogConfig`，所以頁面宿主在自己的 `providers` 換上這支
 * ref —— 表單呼叫 `close()` 就是回來源頁，表單本身一行不改。
 *
 * 離開保護的 guard 在 `form-page-leave.guard.ts`：`app.routes` 靜態 import 那支，
 * 這支帶 primeng 依賴、只給 lazy 的頁面 import（initial bundle 預算，#2414）。
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
