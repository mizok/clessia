import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  SessionsService,
  type BatchActionResult,
  type BatchAssignResult,
} from '@core/sessions.service';

/** `move`＝改到別天（batch-reschedule）、`sub`＝批次代課（batch-substitute）—— #1314 S7 */
export type SessionsActionBatchMode = 'assign' | 'time' | 'cancel' | 'uncancel' | 'move' | 'sub';

export interface SessionsBatchRequest {
  readonly mode: SessionsActionBatchMode | null;
  readonly sessionIds: readonly string[];
  readonly teacherId: string | null;
  readonly startTime: string;
  readonly endTime: string;
  /** 停課、改到別天、代課的原因（選填） */
  readonly reason: string;
  /** 改到別天：同一週的週幾（1=週一…7=週日） */
  readonly targetWeekday: number;
}

@Injectable({
  providedIn: 'root',
})
export class SessionsActionsService {
  private readonly sessionsService = inject(SessionsService);

  previewBatch(
    request: SessionsBatchRequest,
  ): Observable<BatchAssignResult | BatchActionResult> | null {
    return this.getBatchObservable(request, true);
  }

  applyBatch(
    request: SessionsBatchRequest,
  ): Observable<BatchAssignResult | BatchActionResult> | null {
    return this.getBatchObservable(request, false);
  }

  uncancelSingle(sessionId: string): Observable<BatchActionResult> {
    return this.sessionsService.batchUncancel({ sessionIds: [sessionId], dryRun: false });
  }

  private getBatchObservable(
    request: SessionsBatchRequest,
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
          reason: request.reason || undefined,
          dryRun,
        });
      case 'uncancel':
        return this.sessionsService.batchUncancel({
          sessionIds: [...request.sessionIds],
          dryRun,
        });
      case 'move':
        return this.sessionsService.batchReschedule({
          sessionIds: [...request.sessionIds],
          targetWeekday: request.targetWeekday,
          startTime: request.startTime,
          endTime: request.endTime,
          reason: request.reason || undefined,
          dryRun,
        });
      case 'sub':
        if (!request.teacherId) return null;
        return this.sessionsService.batchSubstitute({
          sessionIds: [...request.sessionIds],
          substituteTeacherId: request.teacherId,
          reason: request.reason || undefined,
          dryRun,
        });
      default:
        return null;
    }
  }
}
