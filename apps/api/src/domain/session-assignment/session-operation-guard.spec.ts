import { describe, expect, it } from 'vitest';
import { assertSessionOperable, SessionUnassignedError } from './session-operation-guard';

describe('assertSessionOperable', () => {
  it('unassigned 課堂應拋 SessionUnassignedError', () => {
    expect(() =>
      assertSessionOperable({ assignmentStatus: 'unassigned', status: 'scheduled' }),
    ).toThrow(SessionUnassignedError);
  });

  it('assigned 課堂應可操作', () => {
    expect(() =>
      assertSessionOperable({ assignmentStatus: 'assigned', status: 'scheduled' }),
    ).not.toThrow();
  });
});
