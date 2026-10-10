import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A6 的灰摺疊列（成績／紀錄／家長／基本資料）：左標題、右摘要，點開才看內容。
 * 帳單章（`student-billing-chapter`）是同一個形，那邊有自己的資料與對話框，不併進來。
 */
@Component({
  selector: 'app-student-fold',
  templateUrl: './student-fold.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class StudentFoldComponent {
  readonly title = input.required<string>();
  /** 右邊那句摘要，收著的時候就要讀得懂 */
  readonly meta = input('');
}
