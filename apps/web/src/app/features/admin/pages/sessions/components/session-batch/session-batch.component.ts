import { Component, input, output } from '@angular/core';

export type BatchMode = 'assign' | 'time' | 'cancel' | 'uncancel';

@Component({
  selector: 'app-session-batch',
  imports: [],
  templateUrl: './session-batch.component.html',
})
export class SessionBatchComponent {
  readonly selectedCount = input(0);

  readonly clearSelection = output<void>();
  readonly openBatchSheet = output<BatchMode | null>();
}
