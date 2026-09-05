import { describe, expect, it } from 'vitest';

import { summariseSessions } from './session-summary';

/**
 * 只實作這支函式用得到的鏈：`.select().eq()...` 一路回自己，await 時給空陣列。
 * 這組測試不關心出勤/在籍/考試的統計邏輯（那些有各自的純函式測試），
 * 只釘住 `classes.uses_contact_book` → `usesContactBook` 這條新映射。
 */
function chainable(): any {
  const obj: any = {
    eq: () => obj,
    in: () => obj,
    gte: () => obj,
    lte: () => obj,
    select: () => obj,
    then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data: [] }),
  };
  return obj;
}

function fakeSupabase(): any {
  return { from: () => chainable() };
}

describe('summariseSessions 的 usesContactBook 映射', () => {
  it('把 classes.uses_contact_book 帶進 usesContactBook', async () => {
    const sessions = [
      {
        id: 's1',
        event_id: null,
        session_date: '2026-09-05',
        status: 'scheduled',
        class_id: 'c1',
        teacher_id: null,
        teacher: null,
        schedules: null,
        classes: { name: 'A班', course_id: null, campus_id: null, uses_contact_book: true },
        events: null,
      },
    ];

    const [result] = await summariseSessions(fakeSupabase(), 'org-1', sessions);

    expect(result.usesContactBook).toBe(true);
  });

  // 老師端要靠這個欄位分入口（聯絡簿 vs 教務日誌），沒有值時預設 false 才不會
  // 把「還沒設定」的班誤導成聯絡簿模式
  it('classes.uses_contact_book 缺席時預設 false', async () => {
    const sessions = [
      {
        id: 's2',
        event_id: null,
        session_date: '2026-09-05',
        status: 'scheduled',
        class_id: 'c2',
        teacher_id: null,
        teacher: null,
        schedules: null,
        classes: { name: 'B班', course_id: null, campus_id: null },
        events: null,
      },
    ];

    const [result] = await summariseSessions(fakeSupabase(), 'org-1', sessions);

    expect(result.usesContactBook).toBe(false);
  });
});
