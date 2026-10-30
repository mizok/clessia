import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { SessionsService } from '@core/sessions.service';

import { SessionsActionsService } from './sessions-actions.service';

describe('SessionsActionsService', () => {
  let service: SessionsActionsService;
  const empty = () =>
    of({ updated: 0, skipped: 0, processableIds: [], conflicts: [], dryRun: true });
  const batchReschedule = vi.fn(empty);
  const batchSubstitute = vi.fn(empty);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SessionsService,
          useValue: {
            batchAssignTeacher: () =>
              of({
                updated: 0,
                skippedConflicts: 0,
                skippedNotEligible: 0,
                conflicts: [],
                dryRun: true,
              }),
            batchUpdateTime: () =>
              of({ updated: 0, skipped: 0, processableIds: [], conflicts: [], dryRun: true }),
            batchCancel: () =>
              of({ updated: 0, skipped: 0, processableIds: [], conflicts: [], dryRun: true }),
            batchUncancel: () =>
              of({ updated: 0, skipped: 0, processableIds: [], conflicts: [], dryRun: true }),
            batchReschedule,
            batchSubstitute,
          },
        },
      ],
    });
    service = TestBed.inject(SessionsActionsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // #1314 S7：改到別天、批次代課
  const request = {
    sessionIds: ['s1', 's2'],
    teacherId: 't9',
    startTime: '18:00',
    endTime: '20:00',
    reason: '老師請假',
    targetWeekday: 3,
  } as const;

  it('改到別天：同一週週幾＋新時段，預覽帶 dryRun', () => {
    service.previewBatch({ ...request, mode: 'move' })!.subscribe();
    expect(batchReschedule).toHaveBeenCalledWith({
      sessionIds: ['s1', 's2'],
      targetWeekday: 3,
      startTime: '18:00',
      endTime: '20:00',
      reason: '老師請假',
      dryRun: true,
    });
  });

  it('批次代課：老師帶成 substituteTeacherId；沒選老師就不送', () => {
    service.applyBatch({ ...request, mode: 'sub' })!.subscribe();
    expect(batchSubstitute).toHaveBeenCalledWith({
      sessionIds: ['s1', 's2'],
      substituteTeacherId: 't9',
      reason: '老師請假',
      dryRun: false,
    });
    expect(service.applyBatch({ ...request, mode: 'sub', teacherId: null })).toBeNull();
  });
});
