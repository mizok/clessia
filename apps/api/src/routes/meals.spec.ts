import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import mealsRoute, { studentsOnLeave } from './meals';

/**
 * **#901：餐費批次登錄零稽核。** `meals.ts` 全檔 `logAudit` 0 次，
 * 而它有一支寫入端點 —— 而且那支寫的是**金額鄰近**的資料（`unit_price`、`chargeable`）。
 *
 * 這兩條釘的是「**`audit_logs` 有沒有多一列**」，不是端點回不回 200 ——
 * 這個缺口的形狀就是「端點一直是 200、畫面一直正常，而稽核那張表從來沒有它」。
 * （#877 那條：測試釘的是有沒有寫那一列，不是端點回 200。）
 */
describe('POST /api/meals/batch —— 稽核（#901）', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  const STUDENT_A = '00000000-0000-0000-0000-00000000000a';
  const STUDENT_B = '00000000-0000-0000-0000-00000000000b';

  /**
   * 按表回 fixture，並記下所有 `insert`。
   *
   * ⚠️ `logAudit` 走的是 `profiles.maybeSingle` → `audit_logs.insert`
   * （`utils/audit.ts:101-116`）。**少了 `maybeSingle` 那一段，稽核會在
   * `logAudit` 自己的 try/catch 裡靜默失敗**（只印 `[audit] log failed`）——
   * 測試看不到、CI 也不會紅。
   */
  function fakeSupabase(inserts: Array<{ table: string; rows: unknown }>, settled: string[] = []) {
    return {
      from(table: string) {
        const builder: Record<string, unknown> = {};
        const chain = () => builder as never;
        Object.assign(builder, {
          select: () => chain(),
          eq: () => chain(),
          in: () => chain(),
          not: () => chain(),
          gte: () => chain(),
          lte: () => chain(),
          order: () => chain(),
          range: () => chain(),
          upsert: (rows: unknown) => {
            inserts.push({ table: `${table}#upsert`, rows });
            return Promise.resolve({ error: null });
          },
          insert: (rows: unknown) => {
            inserts.push({ table, rows });
            return Promise.resolve({ error: null });
          },
          maybeSingle: () =>
            Promise.resolve({
              data: table === 'organizations' ? { meal_default_price: 80 } : null,
              error: null,
            }),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            resolve({
              data:
                table === 'meal_records'
                  ? settled.map((id) => ({ student_id: id }))
                  : // #966 B4：寫入前驗學生屬於本 org —— 兩個學生都在
                    table === 'students'
                    ? [{ id: STUDENT_A }, { id: STUDENT_B }]
                    : [],
              error: null,
            }),
        });

        return builder;
      },
    };
  }

  function appWith(supabase: unknown) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', ORG);
      set('userId', 'u1');
      set('roles', ['admin']);
      // 全分校管理員（分校範圍另由 contract/meals-scope.contract.ts 對真的 PostgREST 守，#2138）
      set('campusScope', null);
      await next();
    });
    app.route('/', mealsRoute as unknown as Hono);
    return app;
  }

  async function batch(
    inserts: Array<{ table: string; rows: unknown }>,
    body: unknown,
    settled: string[] = [],
  ) {
    const res = await appWith(fakeSupabase(inserts, settled)).request('/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    // `logAudit` 是 fire-and-forget（`waitUntil` 在測試環境是 undefined），
    // 而它到 `audit_logs.insert` 之間隔著兩個 await —— 不排空 microtask 佇列的話
    // 斷言會跑在寫入之前。**那個方向是安全的（會紅不會假綠），但會 flaky。**
    await new Promise((r) => setTimeout(r, 0));
    return res;
  }

  const auditRowsIn = (inserts: Array<{ table: string; rows: unknown }>) =>
    inserts.filter((i) => i.table === 'audit_logs').map((i) => i.rows);

  it('批次寫入之後 audit_logs 多一列，記得住是哪一天、幾筆', async () => {
    const inserts: Array<{ table: string; rows: unknown }> = [];

    await batch(inserts, {
      date: '2026-09-30',
      rows: [
        { studentId: STUDENT_A, ordered: true },
        { studentId: STUDENT_B, ordered: false },
      ],
    });

    expect(auditRowsIn(inserts)).toEqual([
      expect.objectContaining({
        org_id: ORG,
        resource_type: 'meal_record',
        action: 'meal_record.batch_upsert',
        details: expect.objectContaining({ date: '2026-09-30', updated: 2 }),
      }),
    ]);
  });

  /**
   * 已結算的列不參與寫入（`meals.ts:357` 的 `writable`）。
   * **那種情況下沒有任何東西被改，就不該留下一筆說「改了」的稽核** ——
   * 稽核要對得上實際發生的事，不是對得上「有人按了按鈕」。
   */
  it('全部已結算、零筆寫入時不留稽核', async () => {
    const inserts: Array<{ table: string; rows: unknown }> = [];

    await batch(inserts, { date: '2026-09-30', rows: [{ studentId: STUDENT_A, ordered: true }] }, [
      STUDENT_A,
    ]);

    expect(auditRowsIn(inserts)).toEqual([]);
  });
});

/**
 * ME1（#1314）：餐費單日名單的「今天有請假」。**按日判斷**（計畫席 11-02）：當天只要有任何一張假蓋到就算，
 * 半天假、只綁一堂的假都算 —— 同日到班（`today-attendance.ts`），`leaveCoversSession` 拿整天去比。
 * 這只是提示，勾選不會自動改（A6「請假只提示行政別訂，不自動改」）。
 */
describe('studentsOnLeave（ME1）', () => {
  const DAY = '2026-09-01';
  const leave = (studentId: string, over: Record<string, unknown> = {}) => ({
    student_id: studentId,
    start_date: DAY,
    end_date: DAY,
    start_time: null,
    end_time: null,
    leave_request_sessions: [],
    ...over,
  });

  it('整天、半天、跨日涵蓋當天、綁定當天某一堂的都算', () => {
    const rows = [
      leave('whole'),
      leave('half', { start_time: '14:00', end_time: '15:00' }),
      leave('span', { start_date: '2026-08-30', end_date: '2026-09-03' }),
      leave('bound', {
        start_date: '2026-08-30',
        end_date: '2026-09-03',
        leave_request_sessions: [{ session_id: 's1', sessions: { session_date: DAY } }],
      }),
    ];
    expect([...studentsOnLeave(rows, DAY)].sort()).toEqual(['bound', 'half', 'span', 'whole']);
  });

  it('只綁別天的堂、或日期不含當天的不算', () => {
    const rows = [
      leave('other-bound', {
        start_date: '2026-08-30',
        end_date: '2026-09-03',
        leave_request_sessions: [{ session_id: 's2', sessions: { session_date: '2026-09-02' } }],
      }),
      leave('yesterday', { start_date: '2026-08-31', end_date: '2026-08-31' }),
    ];
    expect(studentsOnLeave(rows, DAY).size).toBe(0);
  });
});
