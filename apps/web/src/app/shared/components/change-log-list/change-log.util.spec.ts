import type { ChangeLogEntry } from '@core/sessions.service';

import { groupChanges } from './change-log.util';

function entry(overrides: Partial<ChangeLogEntry> = {}): ChangeLogEntry {
  return {
    id: 'chg-1',
    sessionId: 'sess-1',
    changeType: 'cancellation',
    summary: '停課',
    sessionDate: '2026-08-12',
    className: '國二數學 A',
    reason: '颱風',
    createdByName: '王主任',
    createdAt: '2026-08-10T03:00:00Z',
    isBatch: false,
    batchId: null,
    ...overrides,
  };
}

const TODAY = '2026-08-15';
const AT = '2026-08-10T03:00:00Z';

describe('groupChanges', () => {
  // #991 P1（A6）：依上課日分章。今天以後的在前、由近到遠；過去的在後、由近到遠
  it('分章：未來（含今天）由近到遠在前，過去由近到遠在後', () => {
    const chapters = groupChanges(
      [
        entry({ id: 'a', sessionDate: '2026-08-10' }),
        entry({ id: 'b', sessionDate: '2026-08-20' }),
        entry({ id: 'c', sessionDate: '2026-08-15' }),
        entry({ id: 'd', sessionDate: '2026-08-12' }),
        entry({ id: 'e', sessionDate: '2026-08-16' }),
      ],
      TODAY,
    );

    expect(chapters.map((c) => c.date)).toEqual([
      '2026-08-15',
      '2026-08-16',
      '2026-08-20',
      '2026-08-12',
      '2026-08-10',
    ]);
  });

  it('有 batchId：同一個 id 收成一則，即使原因或建立時間不同；不同 id 即使同秒同原因也不併', () => {
    const [chapter] = groupChanges(
      [
        entry({ id: 'b1', isBatch: true, batchId: 'X', createdAt: AT }),
        // 同批但原因被改過、建立時間差一秒 —— 合成鍵會拆開它，batchId 不會
        entry({
          id: 'b2',
          isBatch: true,
          batchId: 'X',
          createdAt: '2026-08-10T03:00:01Z',
          reason: '改',
        }),
        // 同秒、同原因、同操作者，但是另一批 —— 合成鍵會誤併，batchId 不會
        entry({ id: 'b3', isBatch: true, batchId: 'Y', createdAt: AT }),
      ],
      TODAY,
    );

    expect(chapter.items.map((i) => i.rows.map((r) => r.id))).toEqual([['b1', 'b2'], ['b3']]);
  });

  /**
   * #1195 之前沒有批次 id：同類型＋原因＋操作者＋建立時間（到秒）視為同一次批次。
   * 非批次的列即使這四樣都一樣也不能併（那是兩次各自的操作）。
   */
  it('沒有 batchId 的舊批次退回合成鍵；原因不同或非批次的不併', () => {
    const [chapter] = groupChanges(
      [
        entry({ id: 'b1', isBatch: true, createdAt: AT, className: '國二數學 A' }),
        entry({ id: 'b2', isBatch: true, createdAt: AT, className: '國三英文 B' }),
        entry({ id: 'b3', isBatch: true, createdAt: AT, reason: '停電' }),
        entry({ id: 's1', createdAt: AT }),
        entry({ id: 's2', createdAt: AT }),
      ],
      TODAY,
    );

    expect(chapter.count).toBe(5);
    expect(chapter.items.map((i) => i.rows.map((r) => r.id))).toEqual([
      ['b1', 'b2'],
      ['b3'],
      ['s1'],
      ['s2'],
    ]);
  });

  it('沒有上課日的列歸在「空日期」那一章，不丟', () => {
    const chapters = groupChanges([entry({ sessionDate: null })], TODAY);
    expect(chapters.map((c) => c.date)).toEqual(['']);
  });

  it('不改傳入的陣列', () => {
    const input = [entry({ id: 'a', sessionDate: '2026-08-10' }), entry({ id: 'b' })];
    groupChanges(input, TODAY);
    expect(input.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
