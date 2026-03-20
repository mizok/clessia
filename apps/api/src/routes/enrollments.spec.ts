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
