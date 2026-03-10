import { Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

export type BatchMode = 'assign' | 'time' | 'cancel' | 'uncancel';

@Component({
  selector: 'app-session-batch',
  imports: [ButtonModule],
  templateUrl: './session-batch.component.html',
  styleUrl: './session-batch.component.scss',
})
export class SessionBatchComponent {
  readonly selectedCount = input(0);

  readonly clearSelection = output<void>();
  readonly openBatchSheet = output<BatchMode | null>();
}
