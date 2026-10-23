import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * 全站「操作紀錄」的入口（#2006，使用者 10-23「開啟它們的按鈕也統一」）：工具列的時鐘圖示鈕，
 * 照 A6 `tbar__icon`（courses.html、fee-templates.html：`aria-label`＋`title`「操作紀錄」）。
 * 手機也在（不收進「⋯」、不佔底部托盤）。彈窗一律 `audit-log-dialog`，各頁自己開：
 *
 * ```html
 * <app-audit-log-button (click)="openAuditLog()" />
 * ```
 *
 * 只管外觀，沒有 output：內層按鈕的 click（含鍵盤 Enter／Space）會冒泡到宿主。
 */
@Component({
  selector: 'app-audit-log-button',
  templateUrl: './audit-log-button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class AuditLogButtonComponent {}
