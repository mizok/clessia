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

  readonly clearSelection = output<void>();
  readonly openBatchSheet = output<BatchMode | null>();
}
