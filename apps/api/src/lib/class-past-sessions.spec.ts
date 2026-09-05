import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkClassesPastSessions } from './class-past-sessions';

function createFakeSupabase(rows: Array<{ class_id: string }>) {
  const calls: { ltArgs: Array<[string, unknown]> } = { ltArgs: [] };
  const builder = {
    select: () => builder,
    in: () => builder,
    lt: (column: string, value: unknown) => {
      calls.ltArgs.push([column, value]);
      return builder;
    },
    then: (onfulfilled?: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onfulfilled ?? undefined),
  };
  return { calls, client: { from: () => builder } };
}

function createFailingSupabase() {
  const builder = {
    select: () => builder,
    in: () => builder,
    lt: () => builder,
    then: (onfulfilled?: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { message: 'boom' } }).then(onfulfilled ?? undefined),
  };
  return { from: () => builder };
}

describe('checkClassesPastSessions', () => {
  it('沒有任何 classId 時直接回空集合，不查資料庫', async () => {
    const result = await checkClassesPastSessions(createFailingSupabase() as never, []);
    expect(result).toEqual({ status: 'ok', classIdsWithPastSessions: new Set() });
  });

  it('回有過去課堂的班級集合', async () => {
    const { client } = createFakeSupabase([{ class_id: 'class-1' }, { class_id: 'class-1' }]);
    const result = await checkClassesPastSessions(client as never, ['class-1', 'class-2']);
    expect(result).toEqual({ status: 'ok', classIdsWithPastSessions: new Set(['class-1']) });
  });

  it('查詢失敗時 fail closed —— 回 check-failed，不能被誤讀成「沒有過去課堂」', async () => {
    const result = await checkClassesPastSessions(createFailingSupabase() as never, ['class-1']);
    expect(result).toEqual({ status: 'check-failed', message: 'boom' });
  });

  /**
   * 台北凌晨那個窗（#402 同一族，跟時區第一二批同一組測試形狀）。
   *
   * 一個班有「台北昨天」的課堂（session_date 是台北的昨天），在 UTC 還是前一天
   * 傍晚、台北已經跨到隔天凌晨的時刻查詢——**這支函式必須用台北的今天當門檻**，
   * 才能正確把那筆課堂算進「過去課堂」。用 UTC 算的話，UTC 今天 = 台北昨天，
   * `.lt('session_date', UTC今天)` 會把「台北昨天」的課堂排除在過去課堂之外
   * （因為它的 session_date 等於、不小於那個算錯的門檻），讓一個昨天才上過課
   * 的班被判定成「沒有過去課堂」。
   */
  describe('台北凌晨那個窗', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('UTC 還在前一天傍晚、台北已經跨到隔天凌晨 —— 台北昨天的課堂仍要算進過去課堂', async () => {
      // 台北 2026-09-06T01:00:00+08:00 = UTC 2026-09-05T17:00:00Z，#402 出事的那個窗
      vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));

      // 這個班「台北昨天」（09-05）上過課
      const { client, calls } = createFakeSupabase([{ class_id: 'class-1' }]);
      const result = await checkClassesPastSessions(client as never, ['class-1']);

      // 門檻要是台北的今天（09-06），不是 UTC 的今天（09-05）
      expect(calls.ltArgs).toEqual([['session_date', '2026-09-06']]);
      expect(result).toEqual({ status: 'ok', classIdsWithPastSessions: new Set(['class-1']) });
    });
  });
});
