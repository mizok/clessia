import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { teacherCanReadEvent } from './attendance-read-scope';

/** staff 列：預設這位使用者在 org-1 是 'me'；`staffOrg` 改掉它所屬的機構（守 staff 查詢一定要帶 org_id） */
function stub(options: {
  teacherId?: string;
  staffError?: boolean;
  sessionsError?: boolean;
  staffOrg?: string;
}) {
  const staffRows = [{ id: 'me', user_id: 'user-1', org_id: options.staffOrg ?? 'org-1' }];
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query: Record<string, unknown> = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        maybeSingle: () =>
          Promise.resolve({
            data:
              staffRows.find((row) =>
                Object.entries(filters).every(
                  ([column, value]) => row[column as keyof typeof row] === value,
                ),
              ) ?? null,
            error: options.staffError ? { message: 'boom' } : null,
          }),
        then: (onfulfilled?: ((value: unknown) => unknown) | null) =>
          Promise.resolve(
            table === 'sessions' && options.sessionsError
              ? { data: null, error: { message: 'boom' } }
              : {
                  data: [
                    {
                      teacher_id: options.teacherId ?? 'me',
                      schedules: { teacher_id: options.teacherId ?? 'me' },
                    },
                  ],
                  error: null,
                },
          ).then(onfulfilled ?? undefined),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const params = { orgId: 'org-1', userId: 'user-1', roles: ['teacher'], eventId: 'event-1' };

/** 讀取範圍（#1081）。路由層的四種角色／歸屬組合在 attendance.spec.ts；這裡守查詢出錯時的方向 */
describe('teacherCanReadEvent', () => {
  it('自己的課可讀', async () => {
    await expect(teacherCanReadEvent(stub({}), params)).resolves.toBe(true);
  });

  it('別人的課不可讀', async () => {
    await expect(teacherCanReadEvent(stub({ teacherId: 'other' }), params)).resolves.toBe(false);
  });

  it('查 staff 失敗 → 拒絕，不是放行', async () => {
    await expect(teacherCanReadEvent(stub({ staffError: true }), params)).resolves.toBe(false);
  });

  it('查課堂失敗 → 拒絕，不是放行', async () => {
    await expect(teacherCanReadEvent(stub({ sessionsError: true }), params)).resolves.toBe(false);
  });

  it('家長等其他角色不可讀', async () => {
    await expect(teacherCanReadEvent(stub({}), { ...params, roles: ['parent'] })).resolves.toBe(
      false,
    );
  });

  // 同一個人在另一個機構也有 staff 列、而且正是那堂課的老師：staff 查詢不帶 org_id 就會被當成自己的課
  it('別的機構的 staff 列不算自己（staff 查詢一定要以 org_id 過濾）', async () => {
    await expect(teacherCanReadEvent(stub({ staffOrg: 'org-2' }), params)).resolves.toBe(false);
  });
});
