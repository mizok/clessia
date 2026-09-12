import { Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

/**
 * 取數失敗時的頁面主體狀態。
 *
 * **為什麼需要一個獨立的狀態，而不是沿用空狀態**：`catchError` 回 `EMPTY`
 * （或 `subscribe({ error })` 什麼都不做）之後，「失敗」與「成功但沒有資料」
 * 在頁面的狀態上**完全相同** —— 於是畫面渲染成「尚未有學生資料」，
 * 還附一顆「新增學生」邀請使用者建出重複資料，而唯一的錯誤訊號是**會自己消失的 toast**（#788）。
 *
 * **標題與圖示刻意寫死**：這一句對使用者的意義是「你看到的不是你的資料」，
 * 每頁自己改字只會讓同一件事長出七種說法。
 * 只有 `description` 是每頁的 —— 它要說**是哪一種資料沒讀到**。
 *
 * 形狀照 `/admin/payments`（#791 認定的全 admin 正例）。
 */
@Component({
  selector: 'app-load-failed',
  standalone: true,
  imports: [EmptyStateComponent, ButtonModule],
  templateUrl: './load-failed.component.html',
})
export class LoadFailedComponent {
  /** 例：`沒有讀到學生資料，可能是連線問題` */
  readonly description = input.required<string>();
  readonly retry = output<void>();
}
