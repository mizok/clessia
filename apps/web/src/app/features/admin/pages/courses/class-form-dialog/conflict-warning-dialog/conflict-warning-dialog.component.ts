import { Component, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DynamicDialogRef, DynamicDialogConfig } from 'primeng/dynamicdialog';

import type { ScheduleConflict } from '@core/classes.service';

export interface ConflictWarningDialogData {
  conflicts: ScheduleConflict[];
}

/**
 * 排課衝突警告。
 *
 * **這支元件的存在是為了修一個看不見的 bug。** 它原本是 `class-form-dialog` 模板
 * 尾巴的一段 `@if`，掛著 `conflict-modal-overlay` 等 7 個 class —— 而那 7 個
 * **全庫沒有任何 CSS 定義**（infra 的死 class 掃描抓到）。
 *
 * 沒有 `position: fixed` 的「遮罩」不是遮罩，是文件流裡的一個普通區塊：
 * 它出現在整張表單的**下方**，被對話框的高度推到視野之外。
 * **使用者可能根本沒看到排課衝突警告就按了儲存** —— 而 DOM 裡那段確實在，
 * 所以不會有任何測試變紅。
 *
 * 抽成獨立的 DynamicDialog 而不是把樣式補回去，是因為補樣式等於在 PrimeNG 的
 * 對話框裡再手刻一套彌編系統：要自己壓過 z-index 25000、自己做焦點囚禁與 Esc。
 * 交給框架，這些都是現成的。
 */
@Component({
  selector: 'app-conflict-warning-dialog',
  standalone: true,
  imports: [ButtonModule],
  templateUrl: './conflict-warning-dialog.component.html',
  styleUrl: './conflict-warning-dialog.component.scss',
})
export class ConflictWarningDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<ConflictWarningDialogData>);

  protected get conflicts(): ScheduleConflict[] {
    return this.config.data.conflicts;
  }

  // 兩行的東西，不為它另立共用工具（AGENTS.md：不要過早抽象）
  protected getWeekdayLabel(weekday: number): string {
    return ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'][weekday] ?? '';
  }

  /** 返回修改 —— 不儲存 */
  protected cancel(): void {
    this.ref.close(false);
  }

  /** 仍要儲存 —— 明知衝突仍然送出 */
  protected proceed(): void {
    this.ref.close(true);
  }
}
