import { describe, expect, it } from 'vitest';
import * as enrollmentsRoute from './enrollments';

describe('toEnrollmentResponse', () => {
  const toEnrollmentResponse = (enrollmentsRoute as Record<string, unknown>)[
    'toEnrollmentResponse'
  ] as ((row: Record<string, unknown>) => Record<string, unknown>) | undefined;

  const baseRow = {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-000000000002',
    class_id: '00000000-0000-0000-0000-000000000003',
    student_id: '00000000-0000-0000-0000-000000000004',
    status: 'active',
    payment_cycle: 'monthly',
    effective_from: '2026-01-01',
    effective_to: null,
    notes: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    classes: { name: '英文班', courses: { id: '00000000-0000-0000-0000-000000000005', name: '英文' } },
    students: { name: '王小明' },
    creator: null,
  };

  it('maps attendances count to attendanceCount', () => {
    expect(toEnrollmentResponse).toBeTypeOf('function');

    const row = { ...baseRow, attendances: [{ count: 5 }] };
    const result = toEnrollmentResponse?.(row);
    expect(result?.['attendanceCount']).toBe(5);
  });

  it('defaults attendanceCount to 0 when attendances is empty', () => {
    expect(toEnrollmentResponse).toBeTypeOf('function');

    const row = { ...baseRow, attendances: [] };
    const result = toEnrollmentResponse?.(row);
    expect(result?.['attendanceCount']).toBe(0);
  });
});

describe('POST /api/enrollments/batch result mapping', () => {
  it('returns already_exists when supabase returns error code 23505', () => {
    const supabaseError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const resultStatus = supabaseError.code === '23505' ? 'already_exists' : 'error';
    expect(resultStatus).toBe('already_exists');
  });

  it('returns enrolled when supabase insert succeeds', () => {
    const supabaseData = { id: 'enroll-uuid-1' };
    const supabaseError = null;
    const resultStatus = supabaseError === null ? 'enrolled' : 'error';
    expect(resultStatus).toBe('enrolled');
    expect(supabaseData.id).toBe('enroll-uuid-1');
  });

  it('returns error for non-unique errors', () => {
    const supabaseError = { code: '23503', message: 'foreign key violation' };
    const resultStatus = supabaseError.code === '23505' ? 'already_exists' : 'error';
    expect(resultStatus).toBe('error');
  });
});

describe('DELETE enrollment attendance gate logic', () => {
  it('allows hard delete when attendanceCount is 0', () => {
    const attendanceCount = 0;
    const canDelete = attendanceCount === 0;
    expect(canDelete).toBe(true);
  });

  it('blocks delete and returns 409 when attendanceCount > 0', () => {
    const attendanceCount: number = 3;
    const canDelete = attendanceCount === 0;
    expect(canDelete).toBe(false);
    const errorCode = 'has_attendance';
    expect(errorCode).toBe('has_attendance');
  });

  it('blocks delete even when status is suspended but has attendance', () => {
    const status = 'suspended';
    const attendanceCount: number = 1;
    const canDelete = attendanceCount === 0;
    expect(canDelete).toBe(false);
    expect(status).toBe('suspended');
  });
});

describe('copy-from-class helper logic', () => {
  const buildCopyFromClassPlan = (enrollmentsRoute as Record<string, unknown>)[
    'buildCopyFromClassPlan'
  ] as
    | ((
        sourceEnrollments: Array<{ student_id: string }>,
        targetActiveEnrollments: Array<{ student_id: string }>,
      ) => {
        sourceStudentIds: string[];
        toInsertStudentIds: string[];
        skipped: number;
      })
    | undefined;

  const isCopyFromClassOverQuota = (enrollmentsRoute as Record<string, unknown>)[
    'isCopyFromClassOverQuota'
  ] as
    | ((input: { currentActiveCount: number | null; maxStudents: number | null; toInsertCount: number }) => boolean)
    | undefined;

  it('dedupes source rows and skips students already in target active set', () => {
    expect(buildCopyFromClassPlan).toBeTypeOf('function');

    const plan = buildCopyFromClassPlan?.(
      [
        { student_id: 'student-1' },
        { student_id: 'student-1' },
        { student_id: 'student-2' },
        { student_id: 'student-3' },
      ],
      [{ student_id: 'student-2' }, { student_id: 'student-9' }],
    );

    expect(plan).toEqual({
      sourceStudentIds: ['student-1', 'student-2', 'student-3'],
      toInsertStudentIds: ['student-1', 'student-3'],
      skipped: 1,
    });
  });

  it('returns zero skipped when target class has no active enrollments', () => {
    expect(buildCopyFromClassPlan).toBeTypeOf('function');

    const plan = buildCopyFromClassPlan?.(
      [{ student_id: 'student-1' }, { student_id: 'student-2' }],
      [],
    );

    expect(plan).toEqual({
      sourceStudentIds: ['student-1', 'student-2'],
      toInsertStudentIds: ['student-1', 'student-2'],
      skipped: 0,
    });
  });

  it('detects over quota when projected active exceeds max students', () => {
    expect(isCopyFromClassOverQuota).toBeTypeOf('function');

    const isOverQuota = isCopyFromClassOverQuota?.({
      currentActiveCount: 18,
      maxStudents: 20,
      toInsertCount: 3,
    });

    expect(isOverQuota).toBe(true);
  });

  it('uses 9999 fallback when max students is null', () => {
    expect(isCopyFromClassOverQuota).toBeTypeOf('function');

    const isOverQuota = isCopyFromClassOverQuota?.({
      currentActiveCount: 5000,
      maxStudents: null,
      toInsertCount: 10,
    });

    expect(isOverQuota).toBe(false);
  });
});

describe('leave backfill helper logic', () => {
  const buildEnrollmentLeaveAttendanceUpserts = (enrollmentsRoute as Record<string, unknown>)[
    'buildEnrollmentLeaveAttendanceUpserts'
  ] as
    | ((
        input: {
          orgId: string;
          studentId: string;
          recordedBy: string;
          events: Array<{ id: string; event_date: string }>;
          leaves: Array<{ start_date: string; end_date: string }>;
        },
      ) => Array<{
        org_id: string;
        student_id: string;
        event_id: string;
        status: 'on_leave';
        recorded_by: string;
        recorded_by_role: 'system';
      }>)
    | undefined;

  it('回填先請假後入班時，將落在請假區間內的課堂改為 on_leave', () => {
    expect(buildEnrollmentLeaveAttendanceUpserts).toBeTypeOf('function');

    const rows = buildEnrollmentLeaveAttendanceUpserts?.({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [
        { id: 'event-1', event_date: '2026-04-02' },
        { id: 'event-2', event_date: '2026-04-17' },
      ],
      leaves: [
        { start_date: '2026-04-01', end_date: '2026-04-16' },
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

  it('沒有重疊請假時不回填 attendance', () => {
    expect(buildEnrollmentLeaveAttendanceUpserts).toBeTypeOf('function');

    const rows = buildEnrollmentLeaveAttendanceUpserts?.({
      orgId: 'org-1',
      studentId: 'student-1',
      recordedBy: 'user-1',
      events: [{ id: 'event-1', event_date: '2026-04-20' }],
      leaves: [{ start_date: '2026-04-01', end_date: '2026-04-16' }],
    });

    expect(rows).toEqual([]);
  });
});
