import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkClassesPastSessions } from './class-past-sessions';

function createFakeSupabase(rows: Array<{ class_id: string }>) {
  // `lt` 也留著並記錄：拿掉它的話，修前那一版會死在
  // `lt is not a function`（編譯層的紅），而那證明不了條件對不對 ——
  // 只證明替身換了介面。兩個都留，修前才是**斷言的紅**。
  const calls: { orArgs: string[]; ltArgs: Array<[string, unknown]> } = { orArgs: [], ltArgs: [] };
  const builder = {
    select: () => builder,
    in: () => builder,
    lt: (column: string, value: unknown) => {
      calls.ltArgs.push([column, value]);
      return builder;
    },
    or: (filters: string) => {
      calls.orArgs.push(filters);
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
    or: () => builder,
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
   * #762：今天稍早已上完並點過名的課。
   *
   * `session_date < today` 對它回 false，於是那個班在今天一整天被視為「沒有歷史
   * 課堂」→ 刪除守門放行 → 報名與出勤紀錄跟著級聯刪除。
   *
   * ⚠️ **這兩支釘的是查詢條件的逐字形狀，不是資料庫真的怎麼篩** —— 這裡的替身
   * 不套用任何條件（本 repo 每支 spec 各寫一份假 supabase，沒有一份會求值）。
   * 所以它們擋得住「條件被改錯／被拿掉」，擋不住「PostgREST 對這個字串的解讀跟
   * 我們以為的不同」。後者只有實機查得出來。
   */
  describe('條件必須是 OR，兩半缺一不可', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // 台北 2026-09-13（UTC 09-13 02:00Z）
      vi.setSystemTime(new Date('2026-09-13T02:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('今天已點名的課要算進過去課堂 —— 條件含 status.eq.completed', async () => {
      const { client, calls } = createFakeSupabase([{ class_id: 'class-1' }]);
      await checkClassesPastSessions(client as never, ['class-1']);

      expect(calls.orArgs).toHaveLength(1);
      expect(calls.orArgs[0]).toContain('status.eq.completed');
      // 日期那半必須搬進同一個 or，不能留在獨立的 `.lt()` —— 那會變成 AND
      expect(calls.ltArgs).toEqual([]);
    });

    it('過去日期但從沒點名的課仍要算進過去課堂 —— 條件仍含 session_date.lt.<台北今天>（守門不放鬆）', async () => {
      const { client, calls } = createFakeSupabase([{ class_id: 'class-1' }]);
      await checkClassesPastSessions(client as never, ['class-1']);

      expect(calls.orArgs[0]).toContain('session_date.lt.2026-09-13');
    });
  });

  /**
   * 台北凌晨那個窗（#402 同一族，跟時區第一二批同一組測試形狀）。
   *
   * 一個班有「台北昨天」的課堂（session_date 是台北的昨天），在 UTC 還是前一天
   * 傍晚、台北已經跨到隔天凌晨的時刻查詢——**這支函式必須用台北的今天當門檻**，
   * 才能正確把那筆課堂算進「過去課堂」。用 UTC 算的話，UTC 今天 = 台北昨天，
   * `session_date.lt.<UTC今天>` 會把「台北昨天」的課堂排除在過去課堂之外
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
      expect(calls.orArgs).toEqual(['session_date.lt.2026-09-06,status.eq.completed']);
      expect(result).toEqual({ status: 'ok', classIdsWithPastSessions: new Set(['class-1']) });
    });
  });
});
