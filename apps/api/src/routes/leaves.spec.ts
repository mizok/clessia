import { describe, it, expect } from 'vitest';
import {
  buildLeaveAttendanceAuditDetails,
  buildLeaveAuditResourceName,
  buildLeaveAttendanceUpserts,
  getLeaveValidationError,
  toLeaveResponse,
} from './leaves';

describe('toLeaveResponse', () => {
  it('maps DB row to camelCase response', () => {
    const row = {
      id: 'lr-1',
      org_id: 'org-1',
      student_id: 'stu-1',
      student_name: '王小明',
      start_date: '2026-04-01',
      end_date: '2026-04-01',
      reason: '身體不適',
      submitted_by: 'user-1',
      submitted_by_role: 'admin',
      submitted_by_name: '張老師',
      created_at: '2026-04-01T00:00:00Z',
    };
    const result = toLeaveResponse(row);
    expect(result.id).toBe('lr-1');
    expect(result.studentName).toBe('王小明');
    expect(result.submittedByRole).toBe('admin');
  });
});

describe('getLeaveValidationError', () => {
  it('rejects reversed date range', () => {
    expect(
      getLeaveValidationError({
        startDate: '2026-04-05',
        endDate: '2026-04-04',
        startTime: null,
        endTime: null,
      }),
    ).toBe('結束日期不可早於開始日期');
  });

  it('rejects same-day reversed time range', () => {
    expect(
      getLeaveValidationError({
        startDate: '2026-04-05',
        endDate: '2026-04-05',
        startTime: '15:00',
        endTime: '09:00',
      }),
    ).toBe('同一天請假的結束時間不可早於開始時間');
  });

  it('allows multi-day leave with independent start and end times', () => {
    expect(
      getLeaveValidationError({
        startDate: '2026-04-05',
        endDate: '2026-04-06',
        startTime: '15:00',
        endTime: '09:00',
      }),
    ).toBeNull();
  });
});

describe('buildLeaveAttendanceUpserts', () => {
  it('only marks events covered by active enrollments on that event date', () => {
    const rows = buildLeaveAttendanceUpserts({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [
        {
          id: 'event-1',
          event_date: '2026-04-02',
          sessions: { class_id: 'class-1' },
        },
        {
          id: 'event-2',
          event_date: '2026-04-02',
          sessions: { class_id: 'class-2' },
        },
        {
          id: 'event-3',
          event_date: '2026-04-10',
          sessions: { class_id: 'class-1' },
        },
      ],
      enrollments: [
        {
          class_id: 'class-1',
          effective_from: '2026-04-01',
          effective_to: '2026-04-05',
        },
      ],
    });

    expect(rows).toEqual([
      {
        org_id: 'org-1',
        student_id: 'student-1',
        event_id: 'event-1',
        status: 'on_leave',
        recorded_by: 'user-1',
        recorded_by_role: 'system',
      },
    ]);
  });

  it('supports Supabase nested session rows returned as an array', () => {
    const rows = buildLeaveAttendanceUpserts({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [
        {
          id: 'event-1',
          event_date: '2026-04-02',
          sessions: [{ class_id: 'class-1' }],
        } as any,
      ],
      enrollments: [
        {
          class_id: 'class-1',
          effective_from: '2026-04-01',
          effective_to: null,
        },
      ],
    });

    expect(rows).toEqual([
      {
        org_id: 'org-1',
        student_id: 'student-1',
        event_id: 'event-1',
        status: 'on_leave',
        recorded_by: 'user-1',
        recorded_by_role: 'system',
      },
    ]);
  });
});

describe('leave audit helpers', () => {
  it('formats leave audit resource name with student and date range', () => {
    expect(
      buildLeaveAuditResourceName({
        studentName: '劉靖雯',
        startDate: '2026-04-02',
        endDate: '2026-04-30',
      }),
    ).toBe('劉靖雯 / 2026-04-02 ~ 2026-04-30');
  });

  it('summarizes leave-driven attendance changes', () => {
    expect(buildLeaveAttendanceAuditDetails(4)).toEqual({ affectedEventCount: 4 });
  });
});
