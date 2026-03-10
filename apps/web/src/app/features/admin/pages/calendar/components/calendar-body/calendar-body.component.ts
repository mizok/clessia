import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Session } from '@core/sessions.service';
import { SessionBatchComponent, type BatchMode } from '../session-batch/session-batch.component';
import {
  SessionListComponent,
  type SessionListMenuRequest,
} from '../session-list/session-list.component';

export type CalendarBodyContextMenuEvent = SessionListMenuRequest;
export type CalendarBodyBatchMode = BatchMode;

@Component({
  selector: 'app-calendar-body',
  imports: [SessionListComponent, SessionBatchComponent],
  templateUrl: './calendar-body.component.html',
  styleUrl: './calendar-body.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarBodyComponent {
  readonly loading = input(false);
  readonly sessions = input<Session[]>([]);
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  readonly selectedCount = input(0);

  readonly selectedIdsChange = output<string[]>();
  readonly contextMenuRequested = output<CalendarBodyContextMenuEvent>();
  readonly clearSelection = output<void>();
  readonly openBatchSheet = output<CalendarBodyBatchMode | null>();
}
