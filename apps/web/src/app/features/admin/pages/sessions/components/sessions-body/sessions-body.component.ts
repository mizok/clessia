import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Session } from '@core/sessions.service';
import { SessionBatchComponent, type BatchMode } from '../session-batch/session-batch.component';
import {
  SessionListComponent,
  type SessionListMenuRequest,
} from '../session-list/session-list.component';

export type SessionsBodyContextMenuEvent = SessionListMenuRequest;
export type SessionsBodyBatchMode = BatchMode;

@Component({
  selector: 'app-sessions-body',
  imports: [SessionListComponent, SessionBatchComponent],
  templateUrl: './sessions-body.component.html',
  styleUrl: './sessions-body.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionsBodyComponent {
  readonly loading = input(false);
  readonly sessions = input<Session[]>([]);
  readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  readonly selectedCount = input(0);
  readonly total = input(0);
  readonly pageSize = input(50);
  readonly currentPage = input(1);

  readonly selectedIdsChange = output<string[]>();
  readonly contextMenuRequested = output<SessionsBodyContextMenuEvent>();
  readonly clearSelection = output<void>();
  readonly openBatchSheet = output<SessionsBodyBatchMode | null>();
  readonly pageChange = output<number>();
}
