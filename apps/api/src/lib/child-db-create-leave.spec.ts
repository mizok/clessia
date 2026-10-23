import { describe, expect, it, vi } from 'vitest';

import { createChildDb } from './child-db';

/**
 * `childDb.createLeave`（#1970）拿著沒綁 scope 的 pool，所以**動手前先驗孩子在 scope 內**。
 * route 前面也有 `isChildAllowed`，這裡是那道檢查之外的第二層：route 漏驗時 pool 也不能被拿來寫別人的孩子。
 */
describe('childDb.createLeave', () => {
  const window = {
    startDate: '2026-11-02',
    endDate: '2026-11-02',
    startTime: null,
    endTime: null,
    boundSessions: [],
  };

  it('不在 scope 的學生 → out-of-scope，連 pool 都不碰', async () => {
    const query = vi.fn();
    const pool = { query, connect: vi.fn(async () => ({ query, release: () => undefined })) };
    const childDb = createChildDb({} as never, ['mine'], 'org-1', pool as never);
    const out = await childDb.createLeave({
      studentId: 'someone-else',
      window,
      reason: null,
      userId: 'u1',
    });
    expect(out).toEqual({ kind: 'out-of-scope' });
    expect(pool.connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('不是家長（scope = null）→ 寫入面 fail-closed', async () => {
    const pool = { connect: vi.fn() };
    const childDb = createChildDb({} as never, null, 'org-1', pool as never);
    const out = await childDb.createLeave({
      studentId: 'mine',
      window,
      reason: null,
      userId: 'u1',
    });
    expect(out).toEqual({ kind: 'out-of-scope' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('沒有 pool → failed，不退回沒有交易的寫法', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const childDb = createChildDb({} as never, ['mine'], 'org-1');
    const out = await childDb.createLeave({
      studentId: 'mine',
      window,
      reason: null,
      userId: 'u1',
    });
    expect(out).toEqual({ kind: 'failed' });
  });
});
