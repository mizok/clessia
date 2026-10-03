import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { teacherCanReadEvent } from './attendance-read-scope';

function stub(options: { teacherId?: string; staffError?: boolean; sessionsError?: boolean }) {
  return {
    from(table: string) {
      const query: Record<string, unknown> = {
        select: () => query,
        eq: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: { id: 'me' },
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
});
