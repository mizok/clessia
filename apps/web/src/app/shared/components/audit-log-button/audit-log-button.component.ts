import { ChangeDetectionStrategy, Component, output } from '@angular/core';

/**
 * 全站「操作紀錄」的入口（#2006，使用者 10-23「開啟它們的按鈕也統一」）：工具列的時鐘圖示鈕，
 * 照 A6 `tbar__icon`（courses.html、fee-templates.html：`aria-label`＋`title`「操作紀錄」）。
 * 手機也在（不收進「⋯」、不佔底部托盤）。彈窗一律 `audit-log-dialog`，各頁自己開：
 *
 * ```html
 * <app-audit-log-button (opened)="openAuditLog()" />
 * ```
 *
 * 只管外觀。用 `opened` 而不是在宿主上綁 `(click)`：宿主不是按鈕，綁在它上面會被觸控尺寸 gate 當成
 * 沒有高度下限的可點元素（它本來也不該是點擊目標，真正的目標是裡面那顆 44／40 的鈕）。
 */
@Component({
  selector: 'app-audit-log-button',
  templateUrl: './audit-log-button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class AuditLogButtonComponent {
  readonly opened = output<void>();
}
