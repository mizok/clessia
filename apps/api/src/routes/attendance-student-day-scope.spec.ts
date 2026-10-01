import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

/**
 * #970：`GET /api/attendance/student-day` 的 `attendance_records` / `leave_requests`
 * 兩支查詢要**自己**帶範圍，不能只靠組裝端「以 sessions 為骨幹、只把它們當查表」。
 *
 * reviewer 在 #967 標的失效方向：哪天有人把 records 或 leaves 直接放進回應，
 * 那一刻就變成跨分校可見 —— **而那次改動的 diff 不會碰到任何範圍相關的字**。
 *
 * 所以這裡**模擬那次改動**：把組裝函式換成「原封不動回傳它收到的輸入」，
 * 再確認他校的資料仍然不在回應裡。替身照查詢實際下的 `.in()` 過濾，
 * 範圍條件沒有下在查詢上，資料就會漏出來、測試就會紅。
 */
vi.mock('../lib/student-day', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/student-day')>();
  return {
    ...original,
    // 「組裝端直接回傳 records／leaves」的那個假想改動
    buildStudentDay: (input: { records: unknown; leaves: unknown }) => ({
      date: '2026-10-01',
      sessions: [],
      nextSession: null,
      rawRecords: input.records,
      rawLeaves: input.leaves,
    }),
  };
});

const { default: attendanceRoute } = await import('./attendance');

const STUDENT = '00000000-0000-0000-0000-000000000051';

/** 依欄位路徑取值：'events.campus_id' → row.events.campus_id */
function pick(row: Record<string, any>, path: string): unknown {
  return path.split('.').reduce<any>((v, k) => (v == null ? v : v[k]), row);
}

/**
 * 只模擬這支路由用到的過濾：`.in(column, values)` 真的過濾（含巢狀欄位），
 * 其他條件只記不濾 —— 這組測試的主題就是「範圍條件有沒有下在查詢上」。
 */
function fakeSupabase(rows: Record<string, Array<Record<string, any>>>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown[]]> = [];
      const query: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'lt', 'lte', 'gt', 'gte', 'order', 'limit']) {
        query[m] = () => query;
      }
      query['in'] = (column: string, values: unknown[]) => {
        filters.push([column, values]);
        return query;
      };
      query['then'] = (ok: (v: unknown) => unknown) =>
        Promise.resolve({
          data: (rows[table] ?? []).filter((row) =>
            filters.every(([column, values]) => values.includes(pick(row, column))),
          ),
          error: null,
        }).then(ok);
      return query;
    },
  };
}

function appWith(supabase: unknown, campusScope: readonly string[] | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', supabase);
    set('orgId', 'org-1');
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', campusScope);
    await next();
  });
  app.route('/', attendanceRoute as unknown as Hono);
  return app;
}

/** 王小明在 c1、c2 兩校都有班；查詢者只管 c1 */
const ROWS = {
  enrollments: [
    {
      student_id: STUDENT,
      class_id: 'math-c1',
      effective_from: '2026-09-01',
      effective_to: null,
      classes: { name: '數學（c1）', campus_id: 'c1' },
    },
    {
      student_id: STUDENT,
      class_id: 'eng-c2',
      effective_from: '2026-09-01',
      effective_to: null,
      classes: { name: '英文（c2）', campus_id: 'c2' },
    },
  ],
  sessions: [
    {
      id: 's-c1',
      event_id: 'e-c1',
      class_id: 'math-c1',
      session_date: '2026-10-01',
      start_time: '09:00:00',
      end_time: '10:00:00',
      status: 'scheduled',
    },
    {
      id: 's-c2',
      event_id: 'e-c2',
      class_id: 'eng-c2',
      session_date: '2026-10-01',
      start_time: '18:00:00',
      end_time: '19:00:00',
      status: 'scheduled',
    },
  ],
  attendance_records: [
    {
      student_id: STUDENT,
      event_id: 'e-c1',
      status: 'present',
      events: { event_date: '2026-10-01', campus_id: 'c1' },
    },
    {
      student_id: STUDENT,
      event_id: 'e-c2',
      status: 'absent',
      events: { event_date: '2026-10-01', campus_id: 'c2' },
    },
  ],
  leave_requests: [
    // 只蓋到 c2 那堂（18:00–19:00）的半天假
    {
      student_id: STUDENT,
      start_date: '2026-10-01',
      end_date: '2026-10-01',
      start_time: '17:30',
      end_time: '19:30',
    },
  ],
};

async function rawOf(campusScope: readonly string[] | null) {
  const res = await appWith(fakeSupabase(ROWS), campusScope).request(
    `/student-day?studentId=${STUDENT}&date=2026-10-01`,
  );
  const body = (await res.json()) as { data: { rawRecords: any[]; rawLeaves: any[] } };
  return body.data;
}

describe('student-day 的 records／leaves 查詢自己帶範圍（#970）', () => {
  it('組裝端就算直接回傳 records，他校那堂的出勤也不在裡面', async () => {
    const { rawRecords } = await rawOf(['c1']);

    expect(rawRecords.map((r) => r.eventId)).toEqual(['e-c1']);
  });

  it('組裝端就算直接回傳 leaves，只蓋到他校課堂的請假也不在裡面', async () => {
    const { rawLeaves } = await rawOf(['c1']);

    expect(rawLeaves).toEqual([]);
  });

  // 對照組：證明上面兩條不是因為替身什麼都不回才綠
  it('不受分校限制時兩校的都在', async () => {
    const { rawRecords, rawLeaves } = await rawOf(null);

    expect(rawRecords.map((r) => r.eventId).sort()).toEqual(['e-c1', 'e-c2']);
    expect(rawLeaves).toHaveLength(1);
  });
});
