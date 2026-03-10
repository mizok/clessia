import type { SessionAssignmentStatus } from './session-assignment.types';

export class SessionAssignmentInvariantError extends Error {
  readonly code = 'SESSION_ASSIGNMENT_INVARIANT';

  constructor(message: string) {
    super(message);
    this.name = 'SessionAssignmentInvariantError';
  }
}

export interface SessionAssignmentState {
  readonly assignmentStatus: SessionAssignmentStatus;
  readonly teacherId: string | null;
}

export function validateAssignmentState(state: SessionAssignmentState): void {
  if (state.assignmentStatus === 'assigned' && !state.teacherId) {
    throw new SessionAssignmentInvariantError('assigned requires teacherId');
  }

  if (state.assignmentStatus === 'unassigned' && state.teacherId) {
    throw new SessionAssignmentInvariantError('unassigned requires null teacherId');
  }
}

export function deriveAssignmentStatus(teacherId: string | null): SessionAssignmentStatus {
  return teacherId ? 'assigned' : 'unassigned';
}
