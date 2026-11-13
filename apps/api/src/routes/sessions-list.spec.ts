import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import sessionsApp from './sessions';

/**
 * `GET /api/sessions`（#950）—— 課堂頁一支請求拿齊：eventId、依課堂日期的在籍人數、
 * 被狀態篩選藏起來的停課數。
 *
 * 替身記下每一支查詢下了哪些條件（`ops`），回傳由 `resolve` 依條件決定 ——
 * 分校範圍那條只能斷言查詢形狀（條件下對下錯，固定 fixture 回的東西一樣）。
 */
interface Op {
  readonly name: string;
  readonly args: readonly unknown[];
}

interface RecordedQuery {
  readonly table: string;
  readonly ops: Op[];
}

type Resolver = (query: RecordedQuery) => { data?: unknown; count?: number | null };

function has(query: RecordedQuery, name: string, ...args: unknown[]): boolean {
  return query.ops.some(
    (op) =>
      op.name === name &&
      args.every((arg, i) => JSON.stringify(op.args[i]) === JSON.stringify(arg)),
  );
}

/**
 * #953：替身**照查詢實際下的狀態條件**過濾報名（`in`／`eq` 都認；沒下條件就全回）——
 * 條件寫成「只收 active」或忘了寫，人數就會跟著錯。
 */
function byStatus<T extends { status: string; effective_to: string | null }>(
  q: RecordedQuery,
  rows: readonly T[],
): T[] {
  const inOp = q.ops.find((op) => op.name === 'in' && op.args[0] === 'status');
  const eqOp = q.ops.find((op) => op.name === 'eq' && op.args[0] === 'status');
  // 認得 `.or('status.eq.active,effective_to.not.is.null')`（退班沒結束日 fail-closed）；沒下就不篩
  const failClosed = q.ops.some(
    (op) => op.name === 'or' && op.args[0] === 'status.eq.active,effective_to.not.is.null',
  );
  return rows.filter(
    (r) =>
      (!inOp || (inOp.args[1] as readonly string[]).includes(r.status)) &&
      (!eqOp || eqOp.args[1] === r.status) &&
      (!failClosed || r.status === 'active' || r.effective_to !== null),
  );
}

function createApp(resolve: Resolver, campusScope: string[] | null = null) {
  const queries: RecordedQuery[] = [];

  const supabase = {
    from(table: string) {
      const recorded: RecordedQuery = { table, ops: [] };
      queries.push(recorded);
      const query: Record<string, unknown> = new Proxy(
        {},
        {
          get(_target, prop: string) {
            if (prop === 'then') {
              return (onfulfilled?: (value: unknown) => unknown) =>
                Promise.resolve({
                  data: null,
                  count: null,
                  error: null,
                  ...resolve(recorded),
                }).then(onfulfilled);
            }
            return (...args: unknown[]) => {
              recorded.ops.push({ name: prop, args });
              return query;
            };
          },
        },
      );
      return query;
    },
  };

  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const ctx = c as unknown as { set: (k: string, v: unknown) => void };
    ctx.set('supabase', supabase);
    ctx.set('orgId', 'org-1');
    ctx.set('userId', 'user-1');
    ctx.set('roles', ['admin']);
    ctx.set('campusScope', campusScope);
    await next();
  });
  app.route('/api/sessions', sessionsApp);

  return { app, queries };
}

function sessionRow(id: string, sessionDate: string, eventId: string | null) {
  return {
    id,
    session_date: sessionDate,
    start_time: '09:00:00',
    end_time: '11:00:00',
    status: 'scheduled',
    class_id: 'class-1',
    teacher_id: null,
    assignment_status: 'assigned',
    event_id: eventId,
    classes: {
      name: '數學 A',
      courses: { id: 'course-1', name: '數學' },
      campuses: { id: 'campus-1', name: '總校' },
    },
    staff: null,
    events: eventId ? { attendance_taken_at: null } : null,
    makeup_for: null,
    made_up_by: [],
  };
}

// 停課計數在 endedOnly 時也帶 limit，所以主查詢的判準要排除它
const isMainQuery = (q: RecordedQuery) =>
  q.table === 'sessions' &&
  (has(q, 'range') || has(q, 'limit')) &&
  !has(q, 'in', 'status', ['cancelled']);
const isEnsureProbe = (q: RecordedQuery) =>
  q.table === 'sessions' && has(q, 'is', 'event_id', null);
const isCancelledCount = (q: RecordedQuery) =>
  q.table === 'sessions' && has(q, 'in', 'status', ['cancelled']);

describe('GET /api/sessions —— 在籍人數依課堂日期（#950）', () => {
  it('同一班兩堂課，報名生效日介於兩者之間 —— 前一堂不算、後一堂算', async () => {
    const { app } = createApp((q) => {
      if (isMainQuery(q)) {
        return {
          data: [sessionRow('s-1', '2026-04-06', 'e-1'), sessionRow('s-2', '2026-04-13', 'e-2')],
          count: 2,
        };
      }
      if (q.table === 'enrollments') {
        return {
          data: [
            { class_id: 'class-1', effective_from: '2026-01-01', effective_to: null },
            // 4/10 才入班
            { class_id: 'class-1', effective_from: '2026-04-10', effective_to: null },
          ],
        };
      }
      return { data: [] };
    });

    const res = await app.request('/api/sessions?from=2026-04-01&to=2026-04-30');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; attendanceEnrolledCount: number; eventId: string | null }>;
    };

    expect(body.data.map((s) => [s.id, s.attendanceEnrolledCount])).toEqual([
      ['s-1', 1],
      ['s-2', 2],
    ]);
  });

  // #953：在籍＝active＋withdrawal（退班靠 effective_to 收尾）；待繳費、休學、作廢都不算
  it('退班生在退班日前的課照算、之後不算；待繳費／休學／作廢不算（#953）', async () => {
    const rows = [
      { status: 'active', class_id: 'class-1', effective_from: '2026-01-01', effective_to: null },
      // 4/10 退班：4/6 那堂算、4/13 那堂不算
      {
        status: 'withdrawal',
        class_id: 'class-1',
        effective_from: '2026-01-01',
        effective_to: '2026-04-10',
      },
      {
        status: 'pending_payment',
        class_id: 'class-1',
        effective_from: '2026-01-01',
        effective_to: null,
      },
      {
        status: 'suspended',
        class_id: 'class-1',
        effective_from: '2026-01-01',
        effective_to: null,
      },
      {
        status: 'void',
        class_id: 'class-1',
        effective_from: '2026-01-01',
        effective_to: '2026-04-10',
      },
      // 退班卻沒結束日（資料不一致）：fail-closed，哪一堂都不算
      {
        status: 'withdrawal',
        class_id: 'class-1',
        effective_from: '2026-01-01',
        effective_to: null,
      },
    ];
    const { app } = createApp((q) => {
      if (isMainQuery(q)) {
        return {
          data: [sessionRow('s-1', '2026-04-06', 'e-1'), sessionRow('s-2', '2026-04-13', 'e-2')],
          count: 2,
        };
      }
      if (q.table === 'enrollments') return { data: byStatus(q, rows) };
      return { data: [] };
    });

    const res = await app.request('/api/sessions?from=2026-04-01&to=2026-04-30');
    const body = (await res.json()) as {
      data: Array<{ id: string; attendanceEnrolledCount: number }>;
    };
    expect(body.data.map((s) => [s.id, s.attendanceEnrolledCount])).toEqual([
      ['s-1', 2],
      ['s-2', 1],
    ]);
  });

  it('回 eventId；停課沒有 event 時是 null，不是空字串', async () => {
    const { app } = createApp((q) =>
      isMainQuery(q)
        ? {
            data: [sessionRow('s-1', '2026-04-06', 'e-1'), sessionRow('s-2', '2026-04-13', null)],
            count: 2,
          }
        : { data: [] },
    );

    const res = await app.request('/api/sessions?from=2026-04-01&to=2026-04-30');
    const body = (await res.json()) as { data: Array<{ eventId: string | null }> };

    expect(body.data.map((s) => s.eventId)).toEqual(['e-1', null]);
  });
});

describe('GET /api/sessions —— meta.hiddenCancelledCount（#950）', () => {
  it('狀態篩選不含停課時，用同一組其他條件數停課', async () => {
    const { app, queries } = createApp((q) => {
      if (isCancelledCount(q)) return { count: 3 };
      if (isMainQuery(q)) return { data: [], count: 0 };
      return { data: [] };
    });

    const res = await app.request(
      '/api/sessions?from=2026-04-01&to=2026-04-30&statuses=scheduled,completed&classIds=class-1',
    );
    const body = (await res.json()) as { meta: { hiddenCancelledCount: number } };

    expect(body.meta.hiddenCancelledCount).toBe(3);
    const cancelled = queries.find(isCancelledCount);
    // 「其他條件」要跟主查詢一樣 —— 問的是「我這個範圍裡藏了幾堂」
    expect(cancelled && has(cancelled, 'in', 'class_id', ['class-1'])).toBe(true);
    expect(cancelled && has(cancelled, 'gte', 'session_date', '2026-04-01')).toBe(true);
    expect(cancelled && has(cancelled, 'lte', 'session_date', '2026-04-30')).toBe(true);
  });

  it('沒指定狀態（停課本來就看得到）時是 0，而且不多發那支查詢', async () => {
    const { app, queries } = createApp((q) => (isMainQuery(q) ? { data: [], count: 0 } : {}));

    const res = await app.request('/api/sessions?from=2026-04-01&to=2026-04-30');
    const body = (await res.json()) as { meta: { hiddenCancelledCount: number } };

    expect(body.meta.hiddenCancelledCount).toBe(0);
    expect(queries.some(isCancelledCount)).toBe(false);
  });

  it('帶 endedOnly 時只數已經結束的停課（跟主查詢同一個推導）', async () => {
    const { app } = createApp((q) => {
      if (isCancelledCount(q)) {
        return {
          data: [
            { session_date: '2000-01-01', start_time: '09:00:00', end_time: '11:00:00' },
            { session_date: '2999-01-01', start_time: '09:00:00', end_time: '11:00:00' },
          ],
        };
      }
      if (isMainQuery(q)) return { data: [], count: 0 };
      return { data: [] };
    });

    const res = await app.request('/api/sessions?statuses=scheduled,completed&endedOnly=true');
    const body = (await res.json()) as { meta: { hiddenCancelledCount: number } };

    expect(body.meta.hiddenCancelledCount).toBe(1);
  });
});

/**
 * 補建出勤事件（`ensureAttendanceSessionEvents`）現在每次都跑（#950 裁決 3），
 * 而它會**寫入** —— 分校範圍不能只靠讀取端過濾，否則 A 校的管理員查詢時會替
 * B 校的課堂建 event（跟 `attendance.spec.ts` 的同名斷言同一個理由）。
 */
describe('GET /api/sessions —— 補建 event 只在呼叫者的分校範圍內', () => {
  it('沒帶 attendanceTaken 也補建，而且探測查詢帶著受限管理員的分校清單', async () => {
    const { app, queries } = createApp(
      (q) => (isMainQuery(q) ? { data: [], count: 0 } : { data: [] }),
      ['campus-1'],
    );

    const res = await app.request('/api/sessions?from=2026-04-01&to=2026-04-30');
    expect(res.status).toBe(200);

    const probe = queries.find(isEnsureProbe);
    expect(probe).toBeDefined();
    expect(probe && has(probe, 'in', 'classes.campus_id', ['campus-1'])).toBe(true);
  });

  it('只查停課時不補建 —— 一次讀取不該觸發寫入（#123）', async () => {
    const { app, queries } = createApp((q) =>
      isMainQuery(q) ? { data: [], count: 0 } : { data: [] },
    );

    await app.request('/api/sessions?statuses=cancelled');

    expect(queries.some(isEnsureProbe)).toBe(false);
  });
});

describe('GET /api/sessions —— latestChange（#1194）', () => {
  it('每堂帶最新一筆異動；一次批次查、照 created_at 新到舊；沒有異動是 null', async () => {
    const { app, queries } = createApp((q) => {
      if (isMainQuery(q)) {
        return {
          data: [sessionRow('s-1', '2026-04-06', 'e-1'), sessionRow('s-2', '2026-04-13', 'e-2')],
          count: 2,
        };
      }
      if (q.table === 'schedule_changes') {
        // 替身不排序 —— 照 DB 的 order 回新到舊
        return {
          data: [
            {
              session_id: 's-1',
              change_type: 'substitute',
              reason: '病假',
              original_teacher_name: '王老師',
              original_session_date: '2026-04-06',
              original_start_time: '09:00:00',
              original_end_time: '11:00:00',
              created_at: '2026-04-05T10:00:00+00:00',
            },
            {
              session_id: 's-1',
              change_type: 'reschedule',
              reason: null,
              original_teacher_name: null,
              original_session_date: '2026-04-02',
              original_start_time: '14:00:00',
              original_end_time: '16:00:00',
              created_at: '2026-04-01T10:00:00+00:00',
            },
          ],
        };
      }
      return { data: [] };
    });

    const res = await app.request('/api/sessions?from=2026-04-01&to=2026-04-30');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; hasChanges: boolean; latestChange: unknown }>;
    };

    expect(body.data.map((s) => [s.id, s.hasChanges, s.latestChange])).toEqual([
      [
        's-1',
        true,
        {
          type: 'substitute',
          reason: '病假',
          originalTeacherName: '王老師',
          originalDate: '2026-04-06',
          originalStartTime: '09:00',
          originalEndTime: '11:00',
          createdAt: '2026-04-05T10:00:00+00:00',
        },
      ],
      ['s-2', false, null],
    ]);

    const changeQueries = queries.filter((q) => q.table === 'schedule_changes');
    expect(changeQueries).toHaveLength(1);
    expect(has(changeQueries[0], 'in', 'session_id', ['s-1', 's-2'])).toBe(true);
    expect(has(changeQueries[0], 'order', 'created_at', { ascending: false })).toBe(true);
  });
});

/**
 * #1928：月檢視一次 500 堂。出勤與在籍那兩支原本只拿 `data`，出錯（`.in()` 帶 500 個 id 會 414）
 * 時出勤數靜默變 0、在籍數靜默變 0，照樣回 200。現在讀不到就回 500，不回一個假的數字。
 */
describe('GET /api/sessions —— 出勤、在籍讀取失敗回 500（#1928）', () => {
  const BOOM = { message: 'URI too long', code: '414' };
  const withMain = (fail: (q: RecordedQuery) => boolean) =>
    createApp((q) => {
      if (fail(q)) return { error: BOOM } as never;
      if (isMainQuery(q)) return { data: [sessionRow('s-1', '2026-04-06', 'e-1')], count: 1 };
      return { data: [] };
    });

  it.each([
    ['出勤（attendance_records）', (q: RecordedQuery) => q.table === 'attendance_records'],
    ['在籍區間（enrollments）', (q: RecordedQuery) => q.table === 'enrollments'],
  ] as const)('%s 讀取失敗 → 500 READ_FAILED，不回 0', async (_label, fail) => {
    const { app } = withMain(fail);
    const res = await app.request('/api/sessions?from=2026-04-01&to=2026-04-30');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('READ_FAILED');
  });
});
