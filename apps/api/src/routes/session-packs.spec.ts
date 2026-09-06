import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import sessionPacksApp from './session-packs';

/**
 * **停課的課堂不扣堂數**（使用者 2026-09-06 裁定 2(b)，issue #485）。
 *
 * 這條為什麼守在扣課這一側，而不是只靠掃碼那一側：停課只改 `sessions.status`，
 * 那筆 event 與它上面**已經存在的** `attendance_records` 都留著。掃碼側的過濾
 * （#498）只擋得住之後新寫的，**擋不住老師在停課之前就點好的名**，也擋不住
 * 請假連動寫下的 `on_leave`（`leaves.ts` 走的是另一條路）。
 *
 * 所以這一道是「不論那筆紀錄從哪裡來」的最後一關 —— 它守的是**金額**。
 */
describe('GET /api/session-packs —— 停課的課堂不扣堂數', () => {
  const ENROLLMENT_ID = '00000000-0000-4000-8000-0000000000e1';

  function createApp(options?: { dropCancelledFilter?: never }) {
    // 這個班有兩堂課，各自有 event、各自有一筆 present：
    //   ev-live      → 正常上的課
    //   ev-cancelled → 已停課的課（event 還在，因為停課不刪 event）
    const sessions = [
      { event_id: 'ev-live', status: 'scheduled' },
      { event_id: 'ev-cancelled', status: 'cancelled' },
    ];
    const attendance: Record<string, string> = {
      'ev-live': 'present',
      'ev-cancelled': 'present',
    };

    const supabase = {
      from(table: string) {
        const neqs: Array<[string, unknown]> = [];
        let requestedEventIds: string[] | null = null;

        const query: Record<string, unknown> = {
          select: () => query,
          eq: () => query,
          order: () => query,
          not: () => query,
          neq: (column: string, value: unknown) => {
            neqs.push([column, value]);
            return query;
          },
          in: (_column: string, values: string[]) => {
            requestedEventIds = values;
            return query;
          },
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: ENROLLMENT_ID,
                class_id: 'class-1',
                student_id: 'stu-1',
                classes: { leave_deducts_session: false },
              },
              error: null,
            }),
          then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) => {
            let data: unknown[] = [];

            if (table === 'session_packs') {
              data = [
                {
                  id: 'pack-1',
                  enrollment_id: ENROLLMENT_ID,
                  purchased_count: 10,
                  purchased_at: '2026-04-01T00:00:00Z',
                  amount: 5000,
                  note: null,
                  created_at: '2026-04-01T00:00:00Z',
                },
              ];
            } else if (table === 'sessions') {
              // **替身照路由實際下的條件過濾。** 路由沒有排除 cancelled 時，
              // 停課那堂的 event 就會被撈出來 —— 這正是要被測出來的那個 bug。
              data = sessions
                .filter((session) =>
                  neqs.every(([column, value]) => session[column as 'status'] !== value),
                )
                .map((session) => ({ event_id: session.event_id }));
            } else if (table === 'attendance_records') {
              data = (requestedEventIds ?? [])
                .filter((eventId) => attendance[eventId])
                .map((eventId) => ({ status: attendance[eventId] }));
            }

            return Promise.resolve({ data }).then(onfulfilled ?? undefined);
          },
        };
        return query;
      },
    };

    const app = new Hono();
    app.use('/api/*', async (c, next) => {
      const context = c as unknown as { set: (key: string, value: unknown) => void };
      context.set('supabase', supabase);
      context.set('orgId', 'org-1');
      context.set('userId', 'user-1');
      context.set('roles', ['admin']);
      await next();
    });
    app.route('/api/session-packs', sessionPacksApp);

    async function fetchSummary() {
      const response = await app.request(
        `/api/session-packs?enrollmentId=${ENROLLMENT_ID}`,
        {},
        undefined,
        { waitUntil: () => undefined, passThroughOnException: () => undefined } as never,
      );
      const body = (await response.json()) as {
        summary: { purchased: number; deducted: number; remaining: number };
      };
      return { status: response.status, summary: body.summary };
    }

    return { fetchSummary };
  }

  it('⚠️ 買 10 堂、上了 1 堂、另 1 堂停課 → 只扣 1 堂，不是 2 堂', async () => {
    // 拿掉排除 cancelled 的過濾，這裡會變成 deducted=2、remaining=8 ——
    // **一堂停掉的課扣了學生一堂已付費的堂數**，而畫面上完全看不出哪一堂是它。
    const { fetchSummary } = createApp();
    const { status, summary } = await fetchSummary();

    expect(status).toBe(200);
    expect(summary.purchased).toBe(10);
    expect(summary.deducted).toBe(1);
    expect(summary.remaining).toBe(9);
  });
});
