import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-sessions-header',
  imports: [],
  templateUrl: './sessions-header.component.html',
  styleUrl: './sessions-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsHeaderComponent {
  readonly unassignedCount = input<number>(0);
  readonly filterUnassigned = output<void>();
}
