import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-sessions-header',
  imports: [],
  templateUrl: './sessions-header.component.html',
  styleUrl: './sessions-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsHeaderComponent {
  readonly monthUnassignedCount = input<number>(0);
  readonly todayPendingAttendanceCount = input<number>(0);
  readonly campusName = input<string | null>(null);
  readonly filterUnassigned = output<void>();
  readonly filterPendingAttendance = output<void>();
}
