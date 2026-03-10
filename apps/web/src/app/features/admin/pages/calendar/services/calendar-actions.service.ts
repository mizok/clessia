import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  SessionsService,
  type BatchActionResult,
  type BatchAssignResult,
} from '@core/sessions.service';

export type CalendarActionBatchMode = 'assign' | 'time' | 'cancel' | 'uncancel';

export interface CalendarBatchRequest {
  readonly mode: CalendarActionBatchMode | null;
  readonly sessionIds: readonly string[];
  readonly teacherId: string | null;
  readonly startTime: string;
  readonly endTime: string;
  readonly cancelReason: string;
}

@Injectable({
  providedIn: 'root',
})
export class CalendarActionsService {
  private readonly sessionsService = inject(SessionsService);

  previewBatch(
    request: CalendarBatchRequest,
  ): Observable<BatchAssignResult | BatchActionResult> | null {
    return this.getBatchObservable(request, true);
  }

  applyBatch(request: CalendarBatchRequest): Observable<BatchAssignResult | BatchActionResult> | null {
    return this.getBatchObservable(request, false);
  }

  uncancelSingle(sessionId: string): Observable<BatchActionResult> {
    return this.sessionsService.batchUncancel({ sessionIds: [sessionId], dryRun: false });
  }

  private getBatchObservable(
    request: CalendarBatchRequest,
    dryRun: boolean,
  ): Observable<BatchAssignResult | BatchActionResult> | null {
    if (request.sessionIds.length === 0) return null;

    switch (request.mode) {
      case 'assign':
        if (!request.teacherId) return null;
        return this.sessionsService.batchAssignTeacher({
          sessionIds: [...request.sessionIds],
          teacherId: request.teacherId,
          dryRun,
        });
      case 'time':
        return this.sessionsService.batchUpdateTime({
          sessionIds: [...request.sessionIds],
          startTime: request.startTime,
          endTime: request.endTime,
          dryRun,
        });
      case 'cancel':
        return this.sessionsService.batchCancel({
          sessionIds: [...request.sessionIds],
          reason: request.cancelReason || undefined,
          dryRun,
        });
      case 'uncancel':
        return this.sessionsService.batchUncancel({
          sessionIds: [...request.sessionIds],
          dryRun,
        });
      default:
        return null;
    }
  }
}
