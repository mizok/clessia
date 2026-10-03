import { Component, input, output } from '@angular/core';

export type BatchMode = 'assign' | 'time' | 'cancel' | 'uncancel';

@Component({
  selector: 'app-session-batch',
  imports: [],
  templateUrl: './session-batch.component.html',
})
export class SessionBatchComponent {
  readonly selectedCount = input(0);
  /** 勾到的課裡有沒有已停課的（有才出「恢復課堂」） */
  readonly hasCancelled = input(false);
  /** 勾到的課怎麼來的（「逐堂勾選」「林老師這週（今天起）」，A6 `.bar__src`） */
  readonly source = input('');
  /** 勾到的課裡現在畫面上看得到幾堂（快速選取會勾到別天的） */
  readonly visibleCount = input(0);

  readonly clearSelection = output<void>();
  readonly openBatchSheet = output<BatchMode | null>();
}
