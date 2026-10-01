import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import attendanceRoute from './attendance';

/**
 * `GET /api/attendance/student-day`（#964 送出前預覽）的**路由層**：誰能打、查詢有沒有
 * 下對範圍。組裝邏輯在 `lib/student-day.spec.ts` 測過，這裡測「資料怎麼餵進去」——
 * charter 的老話：bug 常在「餵進純函式」那一層，純函式測試從定義上就在那一層之後。
 */

interface Chain {
  table: string;
  calls: Array<[string, ...unknown[]]>;
}

function fakeSupabase(rows: Record<string, unknown[]>) {
  const chains: Chain[] = [];
  const client = {
    from(table: string) {
      const chain: Chain = { table, calls: [] };
      chains.push(chain);
      const query: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'lt', 'lte', 'gt', 'gte', 'order', 'limit']) {
        query[m] = (...args: unknown[]) => {
          chain.calls.push([m, ...args]);
          return query;
        };
      }
      query['then'] = (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(ok);
      return query;
    },
  };
  const argsOf = (table: string, method: string) =>
    chains
      .filter((c) => c.table === table)
      .flatMap((c) => c.calls.filter(([m]) => m === method).map(([, ...a]) => a));
  return { client, chains, argsOf };
}

function appWith(
  supabase: unknown,
  opts: { roles?: string[]; campusScope?: readonly string[] | null } = {},
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', supabase);
    set('orgId', 'org-1');
    set('userId', 'u1');
    set('roles', opts.roles ?? ['admin']);
    set('campusScope', opts.campusScope ?? null);
    await next();
  });
  app.route('/', attendanceRoute as unknown as Hono);
  return app;
}

const STUDENT = '00000000-0000-0000-0000-000000000051';

const ROWS = {
  enrollments: [
    {
      class_id: 'math',
      effective_from: '2026-09-01',
      effective_to: null,
      classes: { name: '國三數學 A', campus_id: 'c1' },
    },
  ],
  sessions: [
    {
      id: 's1',
      event_id: 'e1',
      class_id: 'math',
      session_date: '2026-10-01',
      start_time: '14:00:00',
      end_time: '15:30:00',
      status: 'scheduled',
    },
  ],
  attendance_records: [{ event_id: 'e1', status: 'absent' }],
  leave_requests: [],
};

async function get(app: Hono, qs: string) {
  const res = await app.request(`/student-day?${qs}`);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('GET /api/attendance/student-day', () => {
  // `/api/attendance` 掛給 admin 與 teacher；這支是行政的接電話流程，老師不需要
  it('老師打不到（403）', async () => {
    const { client } = fakeSupabase(ROWS);
    const { status } = await get(
      appWith(client, { roles: ['teacher'] }),
      `studentId=${STUDENT}&date=2026-10-01`,
    );

    expect(status).toBe(403);
  });

  it('日期格式錯 → 400', async () => {
    const { client } = fakeSupabase(ROWS);
    const { status } = await get(appWith(client), `studentId=${STUDENT}&date=10/01`);

    expect(status).toBe(400);
  });

  it('回那天的課與點名狀態', async () => {
    const { client } = fakeSupabase(ROWS);
    const { status, body } = await get(appWith(client), `studentId=${STUDENT}&date=2026-10-01`);

    expect(status).toBe(200);
    expect(body['data']).toMatchObject({
      date: '2026-10-01',
      sessions: [
        { startTime: '14:00', endTime: '15:30', className: '國三數學 A', attendance: 'absent' },
      ],
      nextSession: null,
    });
  });

  it('報名查詢限定本 org、這個學生、active', async () => {
    const fake = fakeSupabase(ROWS);
    await get(appWith(fake.client), `studentId=${STUDENT}&date=2026-10-01`);

    expect(fake.argsOf('enrollments', 'eq')).toEqual(
      expect.arrayContaining([
        ['org_id', 'org-1'],
        ['student_id', STUDENT],
        ['status', 'active'],
      ]),
    );
    expect(fake.argsOf('leave_requests', 'eq')).toEqual(
      expect.arrayContaining([
        ['org_id', 'org-1'],
        ['student_id', STUDENT],
      ]),
    );
  });

  // 讀取端點照 middleware 的分校範圍收斂（c1：授權在 middleware 層成立，路由照用）
  it('受分校限制的管理員：報名查詢帶上分校條件', async () => {
    const fake = fakeSupabase(ROWS);
    await get(
      appWith(fake.client, { campusScope: ['c1'] }),
      `studentId=${STUDENT}&date=2026-10-01`,
    );

    expect(fake.argsOf('enrollments', 'in')).toEqual([['classes.campus_id', ['c1']]]);
  });

  it('沒有任何在讀的班 → 空的一天，不再查課堂', async () => {
    const fake = fakeSupabase({ ...ROWS, enrollments: [] });
    const { body } = await get(appWith(fake.client), `studentId=${STUDENT}&date=2026-10-01`);

    expect(body['data']).toEqual({ date: '2026-10-01', sessions: [], nextSession: null });
    expect(fake.chains.some((c) => c.table === 'sessions')).toBe(false);
  });
});
