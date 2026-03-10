import { describe, expect, it } from 'vitest';
import { deriveAssignmentStatus, validateAssignmentState } from './session-assignment.rules';

describe('session-assignment.rules', () => {
  it('assigned 必須有 teacherId', () => {
    expect(() =>
      validateAssignmentState({ assignmentStatus: 'assigned', teacherId: null }),
    ).toThrow();
  });

  it('unassigned 必須沒有 teacherId', () => {
    expect(() =>
      validateAssignmentState({ assignmentStatus: 'unassigned', teacherId: 'teacher-1' }),
    ).toThrow();
  });

  it('deriveAssignmentStatus 應依 teacherId 推導', () => {
    expect(deriveAssignmentStatus('teacher-1')).toBe('assigned');
    expect(deriveAssignmentStatus(null)).toBe('unassigned');
  });
});
