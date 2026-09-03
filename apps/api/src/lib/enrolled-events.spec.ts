import { describe, expect, it } from 'vitest';

import { enrolledEventIds } from './enrolled-events';

const enrollment = (classId: string, from = '2020-01-01', to: string | null = null) => ({
  class_id: classId,
  effective_from: from,
  effective_to: to,
});

describe('enrolledEventIds', () => {
  it('只留下學生有報名的班的課堂', () => {
    const events = [
      { id: 'ev-1', sessions: [{ class_id: 'class-1' }] },
      { id: 'ev-2', sessions: [{ class_id: 'class-2' }] },
    ];

    expect(enrolledEventIds(events, [enrollment('class-1')], '2026-04-06')).toEqual(['ev-1']);
  });

  it('在籍區間沒蓋到那一天就不算', () => {
    const events = [{ id: 'ev-1', sessions: [{ class_id: 'class-1' }] }];

    // 還沒開始
    expect(enrolledEventIds(events, [enrollment('class-1', '2026-05-01')], '2026-04-06')).toEqual(
      [],
    );
    // 已經結束
    expect(
      enrolledEventIds(events, [enrollment('class-1', '2020-01-01', '2026-04-05')], '2026-04-06'),
    ).toEqual([]);
    // 剛好是最後一天 —— 邊界含在內
    expect(
      enrolledEventIds(events, [enrollment('class-1', '2020-01-01', '2026-04-06')], '2026-04-06'),
    ).toEqual(['ev-1']);
  });

  it('沒有 session 的 event 不算課堂', () => {
    // 活動、公告之類的 event 也住在同一張表，掃碼不該替它們寫出勤
    expect(
      enrolledEventIds([{ id: 'ev-1', sessions: null }], [enrollment('class-1')], '2026-04-06'),
    ).toEqual([]);
  });

  it('關聯回單一物件時也要處理', () => {
    expect(
      enrolledEventIds(
        [{ id: 'ev-1', sessions: { class_id: 'class-1' } }],
        [enrollment('class-1')],
        '2026-04-06',
      ),
    ).toEqual(['ev-1']);
  });

  it('一個都沒報名 → 空陣列（到班紀錄本身另外處理）', () => {
    expect(
      enrolledEventIds([{ id: 'ev-1', sessions: [{ class_id: 'class-1' }] }], [], '2026-04-06'),
    ).toEqual([]);
  });
});
