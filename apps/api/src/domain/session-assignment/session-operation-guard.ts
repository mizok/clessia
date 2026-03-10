import type { SessionAssignmentStatus } from './session-assignment.types';

export class SessionUnassignedError extends Error {
  readonly code = 'SESSION_UNASSIGNED';

  constructor() {
    super('課堂尚未指派老師，無法執行此操作');
    this.name = 'SessionUnassignedError';
  }
}

export class SessionCancelledError extends Error {
  readonly code = 'SESSION_CANCELLED';

  constructor() {
    super('課堂已停課，無法操作');
    this.name = 'SessionCancelledError';
  }
}

export class SessionCompletedError extends Error {
  readonly code = 'SESSION_COMPLETED';

  constructor() {
    super('課堂已完成，無法操作');
    this.name = 'SessionCompletedError';
  }
}

export interface SessionOperationState {
  readonly assignmentStatus: SessionAssignmentStatus;
  readonly status: 'scheduled' | 'completed' | 'cancelled';
}

export function assertSessionOperable(session: SessionOperationState): void {
  if (session.assignmentStatus === 'unassigned') {
    throw new SessionUnassignedError();
  }
  if (session.status === 'cancelled') {
    throw new SessionCancelledError();
  }
  if (session.status === 'completed') {
    throw new SessionCompletedError();
  }
}
