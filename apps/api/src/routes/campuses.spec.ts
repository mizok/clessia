import { describe, expect, it } from 'vitest';

import * as campusesRoute from './campuses';

describe('buildCampusSummary', () => {
  it('builds global campus summary counts from filtered rows', () => {
    const buildCampusSummary = (campusesRoute as Record<string, unknown>)['buildCampusSummary'] as
      | ((rows: Array<{ is_active: boolean }>, total: number) => {
          total: number;
          activeCount: number;
          inactiveCount: number;
        })
      | undefined;

    expect(buildCampusSummary).toBeTypeOf('function');

    const summary = buildCampusSummary?.(
      [
        { is_active: true },
        { is_active: false },
        { is_active: true },
      ],
      3,
    );

    expect(summary).toEqual({
      total: 3,
      activeCount: 2,
      inactiveCount: 1,
    });
  });
});
