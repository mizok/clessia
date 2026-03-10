import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SessionsService } from '@core/sessions.service';

import { CalendarActionsService } from './calendar-actions.service';

describe('CalendarActionsService', () => {
  let service: CalendarActionsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SessionsService,
          useValue: {
            batchAssignTeacher: () =>
              of({ updated: 0, skippedConflicts: 0, skippedNotEligible: 0, conflicts: [], dryRun: true }),
            batchUpdateTime: () =>
              of({ updated: 0, skipped: 0, processableIds: [], conflicts: [], dryRun: true }),
            batchCancel: () =>
              of({ updated: 0, skipped: 0, processableIds: [], conflicts: [], dryRun: true }),
            batchUncancel: () =>
              of({ updated: 0, skipped: 0, processableIds: [], conflicts: [], dryRun: true }),
          },
        },
      ],
    });
    service = TestBed.inject(CalendarActionsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
