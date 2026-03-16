import { describe, expect, it } from 'vitest';

import * as staffRoute from './staff';

describe('buildStaffSummary', () => {
  it('builds global summary counts from filtered staff rows', () => {
    const buildStaffSummary = (staffRoute as Record<string, unknown>)['buildStaffSummary'] as
      | ((
          rows: Array<{ user_id: string; status: string }>,
          roleInfoMap: Map<string, { roles: Array<'admin' | 'teacher'> }>,
        ) => {
          total: number;
          adminCount: number;
          teacherCount: number;
          activeCount: number;
          inactiveCount: number;
          archivedCount: number;
        })
      | undefined;

    expect(buildStaffSummary).toBeTypeOf('function');

    const summary = buildStaffSummary?.(
      [
        { user_id: 'user-1', status: 'active' },
        { user_id: 'user-2', status: 'inactive' },
        { user_id: 'user-3', status: 'archived' },
      ],
      new Map([
        ['user-1', { roles: ['admin'] }],
        ['user-2', { roles: ['teacher'] }],
        ['user-3', { roles: ['admin', 'teacher'] }],
      ]),
    );

    expect(summary).toEqual({
      total: 3,
      adminCount: 2,
      teacherCount: 2,
      activeCount: 1,
      inactiveCount: 1,
      archivedCount: 1,
    });
  });
});
