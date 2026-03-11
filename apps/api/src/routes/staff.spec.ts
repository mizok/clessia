import { describe, expect, it } from 'vitest';

import * as staffRoute from './staff';

describe('buildStaffSummary', () => {
  it('builds global summary counts from filtered staff rows', () => {
    const buildStaffSummary = (staffRoute as Record<string, unknown>)['buildStaffSummary'] as
      | ((
          rows: Array<{ user_id: string; is_active: boolean }>,
          roleInfoMap: Map<string, { roles: Array<'admin' | 'teacher'> }>,
          total: number,
        ) => {
          total: number;
          adminCount: number;
          teacherCount: number;
          activeCount: number;
        })
      | undefined;

    expect(buildStaffSummary).toBeTypeOf('function');

    const summary = buildStaffSummary?.(
      [
        { user_id: 'user-1', is_active: true },
        { user_id: 'user-2', is_active: false },
        { user_id: 'user-3', is_active: true },
      ],
      new Map([
        ['user-1', { roles: ['admin'] }],
        ['user-2', { roles: ['teacher'] }],
        ['user-3', { roles: ['admin', 'teacher'] }],
      ]),
      3,
    );

    expect(summary).toEqual({
      total: 3,
      adminCount: 2,
      teacherCount: 2,
      activeCount: 2,
    });
  });
});
