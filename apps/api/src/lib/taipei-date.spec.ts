import { describe, expect, it } from 'vitest';
import { addDaysToDateString } from './taipei-date';

describe('addDaysToDateString', () => {
  it('往前推一天（leaves.ts 的「昨天」用法）', () => {
    expect(addDaysToDateString('2026-09-05', -1)).toBe('2026-09-04');
  });

  it('往後推一天', () => {
    expect(addDaysToDateString('2026-09-05', 1)).toBe('2026-09-06');
  });

  it('跨月邊界', () => {
    expect(addDaysToDateString('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('跨年邊界', () => {
    expect(addDaysToDateString('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('days 是 0 時原樣回傳', () => {
    expect(addDaysToDateString('2026-09-05', 0)).toBe('2026-09-05');
  });
});
