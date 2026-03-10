import type {
  BatchAssignConflict,
  BatchAssignPlanInput,
  BatchAssignPlanOutput,
} from './session-assignment.types';
import { isTimeOverlap } from './time-utils';

export function planBatchAssign(input: BatchAssignPlanInput): BatchAssignPlanOutput {
  const updatedIds: string[] = [];
  const conflicts: BatchAssignConflict[] = [];
  let skippedNotEligible = 0;

  const conflictSessionIds = new Set<string>();

  for (const session of input.targetSessions) {
    const eligible =
      session.status === 'scheduled' &&
      (session.assignmentStatus === 'unassigned' || input.includeAssigned);
    if (!eligible) {
      skippedNotEligible += 1;
      continue;
    }

    if (input.mode === 'force') {
      updatedIds.push(session.id);
      continue;
    }

    const sessionConflicts = input.teacherBusySlots.filter(
      (busy) =>
        busy.sessionDate === session.sessionDate &&
        busy.sessionId !== session.id &&
        isTimeOverlap(session.startTime, session.endTime, busy.startTime, busy.endTime),
    );

    if (sessionConflicts.length > 0) {
      conflictSessionIds.add(session.id);
      for (const conflict of sessionConflicts) {
        conflicts.push({
          sessionId: session.id,
          sessionDate: session.sessionDate,
          startTime: session.startTime,
          endTime: session.endTime,
          conflictWithSessionId: conflict.sessionId,
        });
      }
      continue;
    }

    updatedIds.push(session.id);
  }

  if (input.mode === 'strict' && conflicts.length > 0) {
    return {
      updatedIds: [],
      skippedConflicts: conflictSessionIds.size,
      skippedNotEligible,
      conflicts,
    };
  }

  return {
    updatedIds,
    skippedConflicts: conflictSessionIds.size,
    skippedNotEligible,
    conflicts,
  };
}
