import { describe, expect, it } from 'vitest';

import {
  applyAttendanceTakenFilter,
  ensureAttendanceSessionEvents,
  eventsJoinModifier,
  unreferencedEventIds,
} from './attendance-session-events';

/**
 * 這兩支是 `/api/attendance/sessions` 與 `/api/sessions` 的 `attendanceTaken`
 * 共用的判定 —— 測一次就是測兩支，不會出現「同一個概念兩支端點各算一次然後漂移」。
 */
describe('eventsJoinModifier', () => {
  it('要下 attendanceTaken 條件時换成 !inner', () => {
    expect(eventsJoinModifier(true)).toBe('!event_id!inner');
  });

  it('不下條件時維持原本的 left join', () => {
    expect(eventsJoinModifier(false)).toBe('!event_id');
  });
});

describe('applyAttendanceTakenFilter', () => {
  function fakeQuery() {
    const calls: { is?: [string, unknown]; not?: [string, string, unknown] } = {};
    const query: any = {
      is: (col: string, value: unknown) => {
        calls.is = [col, value];
        return query;
      },
      not: (col: string, op: string, value: unknown) => {
        calls.not = [col, op, value];
        return query;
      },
    };
    return { calls, query };
  }

  it('false：查得到 event 但還沒點名', () => {
    const { calls, query } = fakeQuery();
    applyAttendanceTakenFilter(query, false);
    expect(calls.is).toEqual(['events.attendance_taken_at', null]);
    expect(calls.not).toBeUndefined();
  });

  it('true：查得到 event 而且點過了', () => {
    const { calls, query } = fakeQuery();
    applyAttendanceTakenFilter(query, true);
    expect(calls.not).toEqual(['events.attendance_taken_at', 'is', null]);
    expect(calls.is).toBeUndefined();
  });

  it('undefined：不下任何條件（原樣回傳同一個 query）', () => {
    const { calls, query } = fakeQuery();
    const result = applyAttendanceTakenFilter(query, undefined);
    expect(result).toBe(query);
    expect(calls.is).toBeUndefined();
    expect(calls.not).toBeUndefined();
  });
});

/**
 * **補建是三步（讀 → 建 event → 認領），而三步之間沒有鎖。**
 *
 * 兩個並行的 GET 會各自看到同一批 `event_id IS NULL` 的課堂、各自建一批 event
 * （id 是 `crypto.randomUUID()` 生的，**所以不可能撞到任何約束**），然後各自
 * 覆寫 `sessions.event_id` —— 後寫的贏，先寫的那批 event 變成孤兒。
 *
 * 這組測試釘的是**認領的形狀**：update 必須帶 `is('event_id', null)`
 * （compare-and-set），而且沒搶到的那些要把自己剛建的 event 收回去。
 */
describe('ensureAttendanceSessionEvents —— 並行補建的認領', () => {
  interface FakeCall {
    table: string;
    op: 'select' | 'update' | 'insert' | 'delete';
    isNull: string[];
    inValues?: unknown[];
    payload?: unknown;
  }

  function createFake(options: {
    /** 這些 session id 的認領會失敗（模擬被另一個請求搶先） */
    lostSessionIds?: string[];
    /** 收回孤兒 event 時回錯誤 */
    deleteFails?: boolean;
  }) {
    const lost = new Set(options.lostSessionIds ?? []);
    const calls: FakeCall[] = [];

    const missingSessions = [
      {
        id: 'sess-1',
        event_id: null,
        session_date: '2026-04-10',
        start_time: '18:00',
        end_time: '20:00',
        status: 'scheduled',
        class_id: 'class-1',
        classes: { name: '數學 A', course_id: 'course-1', campus_id: 'campus-1' },
      },
      {
        id: 'sess-2',
        event_id: null,
        session_date: '2026-04-11',
        start_time: '18:00',
        end_time: '20:00',
        status: 'scheduled',
        class_id: 'class-1',
        classes: { name: '數學 A', course_id: 'course-1', campus_id: 'campus-1' },
      },
    ];

    const supabase = {
      from(table: string) {
        const record: FakeCall = { table, op: 'select', isNull: [] };
        let targetSessionId: string | null = null;

        const query: Record<string, unknown> = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            if (table === 'sessions' && column === 'id') targetSessionId = value as string;
            return query;
          },
          in: (_column: string, values: unknown[]) => {
            record.inValues = values;
            return query;
          },
          gte: () => query,
          lte: () => query,
          is: (column: string, value: unknown) => {
            if (value === null) record.isNull.push(column);
            return query;
          },
          // ⚠️ **`update` / `delete` 之後還會接 `.eq().is().select()`**，所以它們
          // 必須回 `query` 而不是 Promise —— 第一版直接回 Promise，於是後面那幾個
          // 條件掛在一個沒有那些方法的物件上，測試看起來像實作沒寫。**終點統一在 `then`。**
          update: (payload: unknown) => {
            record.op = 'update';
            record.payload = payload;
            return query;
          },
          delete: () => {
            record.op = 'delete';
            return query;
          },
          insert: (payload: unknown) => {
            record.op = 'insert';
            record.payload = payload;
            calls.push(record);
            return Promise.resolve({ error: null });
          },
          then: (onfulfilled?: ((value: unknown) => unknown) | null) => {
            calls.push(record);

            if (record.op === 'update') {
              // **認領的結果綁在「有沒有真的下 compare-and-set 條件」上。**
              // 不綁的話，實作把 `is('event_id', null)` 拿掉之後替身照樣回零列，
              // 於是「沒搶到要收回 event」那條仍然綠 —— **替身不管實作怎麼寫都回
              // 一樣的東西，就沒有在測那件事。**
              // 沒有下條件 = 無條件覆寫 = 一定「搶到」，那正是修掉的那個 bug。
              const isCompareAndSet = record.isNull.includes('event_id');
              const claimed =
                targetSessionId !== null && (!isCompareAndSet || !lost.has(targetSessionId));
              return Promise.resolve({
                data: claimed ? [{ id: targetSessionId }] : [],
                error: null,
              }).then(onfulfilled ?? undefined);
            }

            if (record.op === 'delete') {
              return Promise.resolve({
                data: null,
                error: options.deleteFails ? { message: '刪不掉' } : null,
              }).then(onfulfilled ?? undefined);
            }

            const data = table === 'sessions' ? missingSessions : [];
            return Promise.resolve({ data, error: null }).then(onfulfilled ?? undefined);
          },
        };
        return query;
      },
    };

    async function run() {
      return ensureAttendanceSessionEvents({
        supabase: supabase as never,
        orgId: 'org-1',
        campusScope: null,
        courseIdList: [],
        classIdList: [],
        statusList: ['scheduled', 'completed'],
        dateFromValue: '2026-04-01',
        dateToValue: '2026-04-30',
      });
    }

    return { run, calls };
  }

  it('認領是 compare-and-set —— update 帶 `is(event_id, null)`', async () => {
    // 少了這個條件，晚到的請求會把先到的請求已經寫好的 event_id 覆蓋掉。
    // 那個覆蓋最壞的後果不是多一列垃圾：如果中間有人在舊 event 上點過名，
    // **那次點名會從課堂查不到**（記錄掛在舊 event 上，而課堂已經指向新的）。
    const { run, calls } = createFake({});
    const result = await run();

    const updates = calls.filter((call) => call.table === 'sessions' && call.op === 'update');
    expect(updates).toHaveLength(2);
    for (const update of updates) expect(update.isNull).toContain('event_id');
    expect(result.error).toBeNull();
    expect(result.created).toBe(2);
  });

  it('沒搶到的把自己剛建的 event 收回去 —— 不留孤兒', async () => {
    const { run, calls } = createFake({ lostSessionIds: ['sess-2'] });
    const result = await run();

    const deletes = calls.filter((call) => call.table === 'events' && call.op === 'delete');
    expect(deletes).toHaveLength(1);
    // 收回的是**沒搶到那一筆**的 event，不是整批
    expect(deletes[0]?.inValues).toHaveLength(1);
    expect(result.error).toBeNull();
    // `created` 回的是**真的認領到幾筆**，不是「本來想建幾筆」——
    // 後者在有競爭時會誇大，而這個數字是給稽核與除錯看的
    expect(result.created).toBe(1);
  });

  it('全部都沒搶到 → created 是 0，而且不是錯誤', async () => {
    // 另一個請求已經補完了，這不是失敗 —— 呼叫端接著查的資料是正確的
    const { run } = createFake({ lostSessionIds: ['sess-1', 'sess-2'] });
    const result = await run();

    expect(result.created).toBe(0);
    expect(result.error).toBeNull();
  });

  it('⚠️ 收回孤兒失敗不讓請求失敗 —— 不為了清垃圾讓使用者看不到課表', async () => {
    // 孤兒 event 目前對使用者不可見（沒有 /api/events，其餘讀取要嘛用已知 id、
    // 要嘛配 !inner）。為了清一筆看不見的垃圾而讓整份課表 400，代價完全不對等。
    const { run } = createFake({ lostSessionIds: ['sess-2'], deleteFails: true });
    const result = await run();

    expect(result.error).toBeNull();
    expect(result.created).toBe(1);
  });
});

describe('unreferencedEventIds（#582 認領失敗時的補償）', () => {
  it('沒有任何 session 指著的 event 就是孤兒', () => {
    expect(unreferencedEventIds(['e1', 'e2', 'e3'], ['e2'])).toEqual(['e1', 'e3']);
  });

  // 認領步驟「失敗」不等於「沒寫進去」—— 連線在 commit 之後斷掉的話，
  // session 其實已經指著那個 event 了。**刪掉它會把一堂課的出勤事件拔掉**
  //（FK 是 ON DELETE SET NULL，所以不會報錯，只是那堂課悄悄回到「沒有 event」）。
  // 所以補償只刪「查得到沒人指著」的，不是刪「我剛插入的全部」。
  it('已經被認領的不能刪 —— 失敗不代表沒寫進去', () => {
    expect(unreferencedEventIds(['e1', 'e2'], ['e1', 'e2'])).toEqual([]);
  });

  it('全部都沒被認領時全部都是孤兒', () => {
    expect(unreferencedEventIds(['e1', 'e2'], [])).toEqual(['e1', 'e2']);
  });

  it('不認得的認領紀錄不影響判斷', () => {
    expect(unreferencedEventIds(['e1'], ['other-event'])).toEqual(['e1']);
  });
});
