import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import sessionPacksApp from './session-packs';

/**
 * #1928：堂數帳的每一段讀取失敗都要回 500，**不能回一個算錯的剩餘堂數**。
 *
 * 原本四支讀取都只拿 `data`：
 * - 報名讀不到 → 回 404「報名不存在」（其實是讀取失敗）
 * - 堂數包讀不到 → 已購 0 → 剩餘變負數，看起來像「該追補買」
 * - 課堂或出勤讀不到（出勤那支把班級歷來所有 event 塞進 `.in()`，久了就 414）→ 已扣 0、剩餘＝已購
 * 剩餘堂數會被拿去判斷要不要續購或收費，算錯就是金額錯。
 */

const ENROLLMENT_ID = '00000000-0000-4000-8000-0000000000e1';
const BOOM = { message: 'URI too long', code: '414' };

afterEach(() => vi.restoreAllMocks());

function appWith(failTable: string | null, pool?: { query: (...a: unknown[]) => unknown }) {
  const supabase = {
    from(table: string) {
      const query: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'not', 'neq', 'in']) query[m] = () => query;
      const result = (data: unknown) =>
        table === failTable ? { data: null, error: BOOM } : { data, error: null };
      query['maybeSingle'] = () =>
        Promise.resolve(
          result({
            id: ENROLLMENT_ID,
            class_id: 'class-1',
            student_id: 'stu-1',
            classes: { leave_deducts_session: false },
          }),
        );
      query['then'] = (ok: (v: unknown) => unknown) => {
        const data =
          table === 'session_packs'
            ? [
                {
                  id: 'pack-1',
                  enrollment_id: ENROLLMENT_ID,
                  purchased_count: 10,
                  purchased_at: '2026-04-01T00:00:00Z',
                  amount: 5000,
                },
              ]
            : table === 'sessions'
              ? [{ event_id: 'ev-1' }]
              : table === 'attendance_records'
                ? [{ status: 'present' }]
                : [];
        return Promise.resolve(result(data)).then(ok);
      };
      return query;
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', supabase);
    set('orgId', 'org-1');
    if (pool) set('auth', { pool });
    await next();
  });
  app.route('/', sessionPacksApp);
  return app;
}

describe('GET /api/session-packs：讀取失敗回 500，不回算錯的剩餘堂數（#1928）', () => {
  it('對照組：正常時買 10、上 1 → 剩 9', async () => {
    const res = await appWith(null).request(`/?enrollmentId=${ENROLLMENT_ID}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { summary: { remaining: number } }).summary.remaining).toBe(9);
  });

  it.each(['enrollments', 'session_packs', 'sessions', 'attendance_records'])(
    '%s 讀取失敗 → 500 READ_FAILED',
    async (table) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = await appWith(table).request(`/?enrollmentId=${ENROLLMENT_ID}`);
      expect(res.status).toBe(500);
      expect(((await res.json()) as { code: string }).code).toBe('READ_FAILED');
    },
  );
});

/**
 * 正式環境走的是 pg 那條（有 pool）。二讀 @a8bb44e5 的突變 Q5：把 pg 的 catch 改成 `statuses = []`
 * 單元與契約都綠 —— 那正是這張要修的症狀（讀不到就當沒上過課、剩餘＝已購）。這裡守住它。
 */
describe('GET /api/session-packs：pg 那條讀取失敗也回 500（#1928 二讀）', () => {
  it('對照組：pg 回出勤 → 照算（買 10、到 3、請假不扣 1 → 剩 7）', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { status: 'present', n: 3 },
          { status: 'on_leave', n: 1 },
        ],
      }),
    };
    const res = await appWith(null, pool).request(`/?enrollmentId=${ENROLLMENT_ID}`);
    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(((await res.json()) as { summary: { remaining: number } }).summary.remaining).toBe(7);
  });

  it('pool.query 丟錯 → 500 READ_FAILED，回應裡沒有 remaining', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = {
      query: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: '53300' })),
    };
    const res = await appWith(null, pool).request(`/?enrollmentId=${ENROLLMENT_ID}`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('READ_FAILED');
    expect(body).not.toHaveProperty('summary');
    expect(JSON.stringify(body)).not.toContain('remaining');
  });
});
