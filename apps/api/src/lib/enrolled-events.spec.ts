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

/**
 * **停課的課堂不算「到過」**（使用者 2026-09-06 裁定 1(a)，issue #485）。
 *
 * 這條之所以要在這裡守：停課只改 `sessions.status`，**那筆 event 留著、
 * `sessions.event_id` 還指著它**。所以掃碼撈當天 event 時它照樣會出現，
 * 而它一旦被寫成 `present`，扣堂數那側就會把它算進去 ——
 * **一堂停掉的課會扣掉學生一堂已付費的堂數**。
 */
describe('enrolledEventIds —— 停課的課堂', () => {
  const enrolled = [{ class_id: 'class-1', effective_from: '2020-01-01', effective_to: null }];

  it('⚠️ 停課的課堂不寫出勤 —— 否則那堂課會扣掉一堂已付費的堂數', () => {
    expect(
      enrolledEventIds(
        [{ id: 'ev-cancelled', sessions: [{ class_id: 'class-1', status: 'cancelled' }] }],
        enrolled,
        '2026-04-06',
      ),
    ).toEqual([]);
  });

  it('正常的課堂照舊寫 —— 過濾只砍停課那些', () => {
    expect(
      enrolledEventIds(
        [
          { id: 'ev-ok', sessions: [{ class_id: 'class-1', status: 'scheduled' }] },
          { id: 'ev-cancelled', sessions: [{ class_id: 'class-1', status: 'cancelled' }] },
        ],
        enrolled,
        '2026-04-06',
      ),
    ).toEqual(['ev-ok']);
  });

  it('沒帶 status 的 session 視為要寫 —— 缺欄位不該靜靜地少寫紀錄', () => {
    // 呼叫端漏 select `status` 時，行為要退回「照舊寫」而不是「全部不寫」。
    // 反過來設計的話，一次漏 select 會讓整批到班紀錄靜靜消失，而且沒有訊號。
    expect(
      enrolledEventIds(
        [{ id: 'ev-1', sessions: [{ class_id: 'class-1' }] }],
        enrolled,
        '2026-04-06',
      ),
    ).toEqual(['ev-1']);
  });

  it('同一筆 event 掛兩堂課、只有一堂停課 → 仍然要寫', () => {
    // event 對 session 是一對多的形狀（型別上允許陣列），只要還有一堂真的要上，
    // 這個 event 就該有出勤紀錄
    expect(
      enrolledEventIds(
        [
          {
            id: 'ev-1',
            sessions: [
              { class_id: 'class-1', status: 'cancelled' },
              { class_id: 'class-1', status: 'scheduled' },
            ],
          },
        ],
        enrolled,
        '2026-04-06',
      ),
    ).toEqual(['ev-1']);
  });
});
