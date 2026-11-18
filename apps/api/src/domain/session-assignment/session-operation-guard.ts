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

/**
 * `allowCompleted`：代課是資料更正（老師點完名才發現代課沒登），已點名的堂照樣能改老師（#2546 gate）。
 * 其他動作維持擋 completed。
 */
export function assertSessionOperable(
  session: SessionOperationState,
  options: { readonly allowCompleted?: boolean } = {},
): void {
  if (session.status === 'cancelled') {
    throw new SessionCancelledError();
  }
  if (session.status === 'completed' && !options.allowCompleted) {
    throw new SessionCompletedError();
  }
  if (session.assignmentStatus === 'unassigned') {
    throw new SessionUnassignedError();
  }
}
