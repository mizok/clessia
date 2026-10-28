import { describe, expect, it } from 'vitest';

import { toCatalogClass } from './catalog-class';

// #1100 #22：還沒生效的未來時段要帶生效日（畫面標「X 起」）；已經有效的回 null、已結束的不列
describe('toCatalogClass —— 時段生效日', () => {
  it('今天有效 → null；未來 → 那天；已結束 → 不列', () => {
    const slot = (weekday: number, effective_from: string, effective_to: string | null) => ({
      weekday,
      start_time: '18:00:00',
      end_time: '20:00:00',
      effective_from,
      effective_to,
    });
    const row = {
      id: 'c',
      name: 'x',
      max_students: 10,
      schedules: [
        slot(1, '2026-09-01', '2026-10-31'),
        slot(3, '2026-11-01', null),
        slot(5, '2026-01-01', '2026-08-31'),
      ],
    };
    expect(toCatalogClass(row, 0, '2026-10-28').slots).toEqual([
      { weekday: 1, startTime: '18:00', endTime: '20:00', effectiveFrom: null },
      { weekday: 3, startTime: '18:00', endTime: '20:00', effectiveFrom: '2026-11-01' },
    ]);
  });
});
