import type { CanDeactivateFn } from '@angular/router';

/**
 * 手機整頁表單的離開保護（#2396 L4）。**這支檔案不得 import primeng 或 `form-page.util`**：
 * `app.routes.ts` 靜態 import 它，帶進來的東西都會進 initial bundle（#2414 曾因 guard 跟
 * `PageDialogRef extends DynamicDialogRef` 同檔，initial 從預算內漲到 896 kB、build 紅）。
 * 問要不要放棄的對話框由頁面自己的 `canLeave()` 開（頁面是 lazy 載入的）。
 */
export interface LeaveGuarded {
  canLeave(): boolean | Promise<boolean>;
}

export const formPageLeaveGuard: CanDeactivateFn<LeaveGuarded> = (page) => page.canLeave();
