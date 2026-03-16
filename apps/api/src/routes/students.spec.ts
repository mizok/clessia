import { describe, expect, it } from 'vitest';
import * as studentsRoute from './students';

describe('buildStudentSummary', () => {
  it('counts active students from rows', () => {
    const buildStudentSummary = (studentsRoute as Record<string, unknown>)[
      'buildStudentSummary'
    ] as ((rows: Array<{ is_active: boolean }>, total: number) => {
      total: number;
      activeCount: number;
    }) | undefined;

    expect(buildStudentSummary).toBeTypeOf('function');

    const result = buildStudentSummary?.(
      [{ is_active: true }, { is_active: false }, { is_active: true }],
      3,
    );

    expect(result).toEqual({ total: 3, activeCount: 2 });
  });
});

describe('toStudentResponse', () => {
  it('maps snake_case DB row to camelCase response', () => {
    const toStudentResponse = (studentsRoute as Record<string, unknown>)[
      'toStudentResponse'
    ] as ((row: Record<string, unknown>, parentNames?: string[]) => Record<string, unknown>) | undefined;

    expect(toStudentResponse).toBeTypeOf('function');

    const row = {
      id: 'abc-123',
      org_id: 'org-456',
      name: '林子璿',
      grade: 'J1',
      school: '台北市立文山國中',
      birthday: '2010-05-15',
      gender: 'male',
      phone: null,
      address: null,
      emergency_contact_name: '林志明',
      emergency_contact_phone: '0912345678',
      notes: null,
      is_active: true,
      created_at: '2026-03-16T00:00:00Z',
      updated_at: '2026-03-16T00:00:00Z',
    };

    const result = toStudentResponse?.(row, ['林志明']);

    expect(result).toMatchObject({
      id: 'abc-123',
      orgId: 'org-456',
      name: '林子璿',
      grade: 'J1',
      school: '台北市立文山國中',
      birthday: '2010-05-15',
      gender: 'male',
      emergencyContactName: '林志明',
      emergencyContactPhone: '0912345678',
      isActive: true,
      parentNames: ['林志明'],
    });
  });

  it('handles null optional fields', () => {
    const toStudentResponse = (studentsRoute as Record<string, unknown>)[
      'toStudentResponse'
    ] as ((row: Record<string, unknown>, parentNames?: string[]) => Record<string, unknown>) | undefined;

    const row = {
      id: 'abc-123', org_id: 'org-456', name: '林子璿', grade: 'J1',
      school: '學校', birthday: null, gender: null, phone: null,
      address: null, emergency_contact_name: null, emergency_contact_phone: null,
      notes: null, is_active: false, created_at: '2026-01-01', updated_at: '2026-01-01',
    };

    const result = toStudentResponse?.(row);

    expect(result?.['birthday']).toBeNull();
    expect(result?.['gender']).toBeNull();
    expect(result?.['emergencyContactName']).toBeNull();
    expect(result?.['parentNames']).toEqual([]);
  });
});
