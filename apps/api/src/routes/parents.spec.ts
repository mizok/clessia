import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

// **靜態 import，不要在 test body 裡動態 import。**
// 原本兩個測試各寫 `await import('./parents')`，於是**模組轉譯的時間被算進
// 5 秒的 test timeout**。這支路由檔很大，轉譯本身就要好幾秒 —— 本機連跑三次
// 分別是 2.5s 過、3.0s 過、5.0s **失敗**。
// 隨機紅在跟改動無關的地方，比慢更貴：它會讓所有人開始不信任 CI。
import parentsRoute, { toParentResponse } from './parents';

describe('toParentResponse', () => {
  it('maps snake_case DB row to camelCase, email 優先作為 loginAccount', () => {
    const row = {
      id: 'parent-uuid',
      user_id: 'ba-user-id',
      org_id: 'org-uuid',
      name: '林志明',
      phone: '0912345678',
      email: 'lin@example.com',
      status: 'active',
      notes: null,
      created_at: '2026-03-17T00:00:00Z',
      updated_at: '2026-03-17T00:00:00Z',
    };

    const result = toParentResponse(row, 2);
    expect(result).toMatchObject({
      id: 'parent-uuid',
      userId: 'ba-user-id',
      orgId: 'org-uuid',
      name: '林志明',
      phone: '0912345678',
      email: 'lin@example.com',
      loginAccount: 'lin@example.com',
      status: 'active',
      studentCount: 2,
    });
  });

  it('無 email 時 loginAccount 使用 phone', () => {
    const row = {
      id: 'parent-uuid',
      user_id: 'ba-user-id',
      org_id: 'org-uuid',
      name: '陳淑芬',
      phone: '0987654321',
      email: null,
      status: 'inactive',
      notes: null,
      created_at: '2026-03-17T00:00:00Z',
      updated_at: '2026-03-17T00:00:00Z',
    };

    const result = toParentResponse(row, 0);
    expect(result.loginAccount).toBe('0987654321');
  });
});

/**
 * **#816：`parents.ts` 原本完全沒有 campus-scope**（`grep -n campus` 回空）——
 * 只被指派一間分校的管理員看得到全機構家長的姓名與 email。
 *
 * 家長身上沒有 `campus_id`，所以範圍要走三跳：
 * `enrollments`（分校）→ `student_id` → `parent_student_relations` → `parent_id`，
 * 形狀照 `students.ts` 既有的做法（先撈 id 集合再 `.in('id', …)`）。
 *
 * 斷言的是**送出去的查詢長什麼樣**，不是回傳值 —— 替身回固定 fixture，
 * 「有下條件」與「沒下條件」在回傳值上完全一樣。
 */
describe('GET /api/parents —— 分校範圍（#816）', () => {
  interface QueryRecord {
    readonly table: string;
    columns: string;
    readonly ins: Array<{ column: string; values: string[] }>;
  }

  function fakeSupabase(queries: QueryRecord[]) {
    return {
      from(table: string) {
        const record: QueryRecord = { table, columns: '', ins: [] };
        queries.push(record);

        const builder: Record<string, unknown> = {};
        const chain = () => builder as never;
        Object.assign(builder, {
          select: (columns?: string) => {
            record.columns = columns ?? '';
            return chain();
          },
          eq: () => chain(),
          or: () => chain(),
          order: () => chain(),
          range: () => chain(),
          ilike: () => chain(),
          in: (column: string, values: readonly string[]) => {
            record.ins.push({ column, values: [...values] });
            return chain();
          },
          then: (resolve: (value: { data: unknown[]; count: number; error: null }) => unknown) => {
            // 每張表回剛好夠讓下一跳有輸入的最小 fixture
            const data =
              table === 'parents'
                ? [{ id: 'parent-1', user_id: 'user-1', org_id: 'org-1', name: '家長一' }]
                : table === 'enrollments'
                  ? [{ student_id: 'student-1' }]
                  : table === 'parent_student_relations'
                    ? [{ parent_id: 'parent-1', students: { id: 'student-1', name: '學生一' } }]
                    : [];
            return resolve({ data, count: data.length, error: null });
          },
        });

        return builder;
      },
    };
  }

  async function listParents(campusScope: readonly string[] | null) {
    const queries: QueryRecord[] = [];
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', fakeSupabase(queries));
      set('orgId', 'org-1');
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('campusScope', campusScope);
      await next();
    });
    app.route('/', parentsRoute as unknown as Hono);

    // **第三個參數是 env** —— handler 會讀 `c.env.PLACEHOLDER_EMAIL_DOMAIN`
    // 來判斷 email 是不是佔位信箱，裸 Hono 的 `c.env` 沒有值，不給就是 500
    const res = await app.request('/', {}, { PLACEHOLDER_EMAIL_DOMAIN: 'placeholder.invalid' });
    expect(res.status).toBe(200);

    return queries;
  }

  it('受限管理員：分校條件下到 enrollments，家長 id 條件下到 parents', async () => {
    const queries = await listParents(['campus-1']);

    // 第一跳：用他管的分校撈報名。**`classes.campus_id` 是巢狀欄位** ——
    // select 必須是無條件的 `classes!inner`，否則就是 #815 那個洞
    const enrollmentQuery = queries.find((q) => q.table === 'enrollments');
    expect(enrollmentQuery?.ins).toContainEqual({
      column: 'classes.campus_id',
      values: ['campus-1'],
    });
    expect(enrollmentQuery?.columns).toContain('classes!inner');

    // 最後一跳：家長清單真的被那組 id 縮限
    const listQuery = queries.find((q) => q.table === 'parents' && q.columns === '*');
    expect(listQuery?.ins.some((call) => call.column === 'id')).toBe(true);
  });

  it('不受分校限制時三跳都不做（確認上一條不是無腦通過）', async () => {
    const queries = await listParents(null);

    expect(queries.some((q) => q.table === 'enrollments')).toBe(false);
    const listQuery = queries.find((q) => q.table === 'parents' && q.columns === '*');
    expect(listQuery?.ins.some((call) => call.column === 'id')).toBe(false);
  });
});
