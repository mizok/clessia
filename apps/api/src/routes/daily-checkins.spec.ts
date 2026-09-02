import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import dailyCheckinsApp from './daily-checkins';

/**
 * 掃碼是**自動寫入**：機器讀到一張卡，就替該學生當天所有課程記一筆 `present`。
 *
 * **它不得覆蓋人工改過的紀錄。** 老師把某個學生改成缺席、學生事後補掃了碼，
 * 原本的 upsert（`ignoreDuplicates: false`）會把它改回 present，而且不留痕跡 ——
 * 老師的判斷被一張卡推翻，沒有人會知道。
 *
 * 這裡守的是 upsert 的**選項**，不是結果：兩種寫法在假 supabase 的回傳上看不出差別，
 * 差別只存在於「送給 PostgREST 的是哪一組參數」。
 */
function createCheckinApp() {
  const upsertCalls: Array<{ table: string; rows: unknown; options: unknown }> = [];

  const supabase = {
    from(table: string) {
      const query = {
        upsert(rows: unknown, options: unknown) {
          upsertCalls.push({ table, rows, options });
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: '00000000-0000-4000-8000-000000000001',
                    org_id: '00000000-0000-4000-8000-0000000000a1',
                    student_id: '00000000-0000-4000-8000-0000000000b1',
                    campus_id: null,
                    checkin_date: '2026-04-01',
                    checked_in_at: '2026-04-01T00:00:00Z',
                    created_at: '2026-04-01T00:00:00Z',
                  },
                  error: null,
                }),
            }),
            then: (onfulfilled?: ((value: { error: null }) => unknown) | null) =>
              Promise.resolve({ error: null }).then(onfulfilled ?? undefined),
          };
        },
        select: () => query,
        eq: () => query,
        then: (onfulfilled?: ((value: { data: unknown[] }) => unknown) | null) =>
          Promise.resolve({ data: [{ id: 'event-1' }, { id: 'event-2' }] }).then(
            onfulfilled ?? undefined,
          ),
      };
      return query;
    },
  };

  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const context = c as unknown as { set: (key: string, value: unknown) => void };
    context.set('supabase', supabase);
    context.set('orgId', '00000000-0000-4000-8000-0000000000a1');
    context.set('userId', 'user-1');
    context.set('roles', ['admin']);
    await next();
  });
  app.route('/api/daily-checkins', dailyCheckinsApp);

  return { app, upsertCalls };
}

describe('POST /api/daily-checkins', () => {
  it('never overwrites an existing attendance record', async () => {
    const { app, upsertCalls } = createCheckinApp();

    const response = await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-01',
      }),
    });

    expect(response.status).toBe(201);

    const attendanceUpsert = upsertCalls.find((call) => call.table === 'attendance_records');
    expect(attendanceUpsert).toBeDefined();
    // 已經有紀錄的就跳過 —— 那筆可能是老師手動改的
    expect(attendanceUpsert?.options).toMatchObject({ ignoreDuplicates: true });
  });

  it('records the scan as an automatic write', async () => {
    const { app, upsertCalls } = createCheckinApp();

    await app.request('/api/daily-checkins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        studentId: '00000000-0000-4000-8000-0000000000b1',
        checkinDate: '2026-04-01',
      }),
    });

    const rows = upsertCalls.find((call) => call.table === 'attendance_records')?.rows as Array<
      Record<string, unknown>
    >;

    // 掃碼是機器寫的，不是人 —— 這一欄之後要用來分辨「能不能覆蓋」
    expect(rows.every((row) => row['recorded_by_role'] === 'system')).toBe(true);
    expect(rows.every((row) => row['status'] === 'present')).toBe(true);
  });
});
