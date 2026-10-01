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
