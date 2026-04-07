import { describe, expect, it, vi } from 'vitest';
import * as classesRoute from './classes';

describe('applyClassDetailScheduleScope', () => {
  it('only scopes schedules by class_id', () => {
    const applyClassDetailScheduleScope = (classesRoute as Record<string, unknown>)[
      'applyClassDetailScheduleScope'
    ] as
      | (<T extends { eq: (column: string, value: unknown) => T }>(query: T, classId: string) => T)
      | undefined;

    expect(applyClassDetailScheduleScope).toBeTypeOf('function');

    const eq = vi.fn();
    const query = { eq } as { eq: (column: string, value: unknown) => typeof query };
    eq.mockReturnValue(query);

    applyClassDetailScheduleScope?.(query, 'class-1');

    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('class_id', 'class-1');
  });
});
