import { describe, expect, it } from 'vitest';

import {
  buildSingleSessionChangeInsert,
  mapSessionChange,
  SESSION_CHANGES_SELECT,
} from './sessions';

describe('session history mapping', () => {
  it('maps original teacher and operation source metadata for substitute changes', () => {
    expect(SESSION_CHANGES_SELECT).toContain('original_teacher_id');
    expect(SESSION_CHANGES_SELECT).toContain('original_teacher_name');
    expect(SESSION_CHANGES_SELECT).toContain('operation_source');

    const result = mapSessionChange({
      id: '11111111-1111-1111-1111-111111111111',
      change_type: 'substitute',
      original_session_date: null,
      original_start_time: null,
      original_end_time: null,
      new_session_date: null,
      new_start_time: null,
      new_end_time: null,
      original_teacher_id: '22222222-2222-2222-2222-222222222222',
      original_teacher_name: '王老師',
      operation_source: 'single',
      reason: '老師請假',
      created_by_name: '教務主任',
      created_at: '2026-03-10T08:00:00.000Z',
      staff: {
        id: '33333333-3333-3333-3333-333333333333',
        display_name: '李老師',
      },
    });

    expect(result).toMatchObject({
      originalTeacherId: '22222222-2222-2222-2222-222222222222',
      originalTeacherName: '王老師',
      operationSource: 'single',
      substituteTeacherName: '李老師',
    });
  });
});

describe('single session history payloads', () => {
  it('records original teacher snapshot and single operation source for substitute', () => {
    const payload = buildSingleSessionChangeInsert({
      orgId: 'org-1',
      sessionId: 'session-1',
      changeType: 'substitute',
      sessionState: {
        assignmentStatus: 'assigned',
        status: 'scheduled',
        classId: 'class-1',
        sessionDate: '2026-03-10',
        startTime: '09:00:00',
        endTime: '11:00:00',
        teacherId: 'teacher-origin',
        teacherName: '原任老師',
      },
      createdByName: '教務主任',
      reason: '老師請假',
      substituteTeacherId: 'teacher-substitute',
    });

    expect(payload).toMatchObject({
      change_type: 'substitute',
      original_teacher_id: 'teacher-origin',
      original_teacher_name: '原任老師',
      substitute_teacher_id: 'teacher-substitute',
      operation_source: 'single',
    });
  });
});
