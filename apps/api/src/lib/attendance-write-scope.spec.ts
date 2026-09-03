import { describe, expect, it } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  assertTeacherCanWriteAttendance,
  canTeacherWriteAttendance,
} from './attendance-write-scope';

const base = {
  roles: ['teacher'],
  ownStaffId: 'me',
  sessionTeacherIds: ['someone-else'],
  scheduledTeacherIds: ['someone-else'],
};

describe('canTeacherWriteAttendance', () => {
  it('管理員不受限', () => {
    expect(canTeacherWriteAttendance({ ...base, roles: ['admin'] })).toBe(true);
  });

  it('固定任課的老師可以點名', () => {
    expect(canTeacherWriteAttendance({ ...base, scheduledTeacherIds: ['me'] })).toBe(true);
  });

  // 這一條是讀與寫刻意不同的地方：讀用固定任課，寫含代課。
  // 用固定任課擋代課老師，等於讓代課功能失效 —— 他當天就是要點那堂課的名。
  it('代課老師可以點名（sessions.teacher_id）', () => {
    expect(canTeacherWriteAttendance({ ...base, sessionTeacherIds: ['me'] })).toBe(true);
  });

  // 洞 4 本體：清單本來就回傳 eventId，換一個值就打得到別班
  it('不是自己的課就不能寫', () => {
    expect(canTeacherWriteAttendance(base)).toBe(false);
  });

  it('沒有 staff 列時拒絕，而不是放行', () => {
    expect(
      canTeacherWriteAttendance({ ...base, ownStaffId: null, sessionTeacherIds: [null] }),
    ).toBe(false);
  });

  it('家長之類的其他角色一律拒絕', () => {
    expect(
      canTeacherWriteAttendance({ ...base, roles: ['parent'], scheduledTeacherIds: ['me'] }),
    ).toBe(false);
  });

  // 查不到 session（event 沒有對應課堂）時不能變成通行證
  it('查不到任何課堂時拒絕', () => {
    expect(
      canTeacherWriteAttendance({ ...base, sessionTeacherIds: [], scheduledTeacherIds: [] }),
    ).toBe(false);
  });

  // null === null 不能算命中
  it('老師沒有 staff 列、課堂也沒有老師，不能互相配對成功', () => {
    expect(
      canTeacherWriteAttendance({
        ...base,
        ownStaffId: null,
        sessionTeacherIds: [null],
        scheduledTeacherIds: [null],
      }),
    ).toBe(false);
  });
});

/**
 * 這一組守的是**查詢出錯時的方向**。純函式測不到它 —— 錯誤處理在 async 那一層，
 * 而「查不到就放行」正是授權的洞最常見的長法（`enrollments/validation.ts` 的註解
 * 記著同一個坑：舊版把錯誤吞掉、用 `count ?? 0` 當 0，守門從來沒有生效過）。
 */
function supabaseStub(options: {
  sessionsError?: boolean;
  ownStaffId?: string | null;
  teacherId?: string | null;
}): SupabaseClient {
  return {
    from(table: string) {
      const query: Record<string, unknown> = {
        select: () => query,
        eq: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: options.ownStaffId === null ? null : { id: options.ownStaffId ?? 'me' },
            error: null,
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

describe('assertTeacherCanWriteAttendance', () => {
  it('是自己的課就放行', async () => {
    await expect(assertTeacherCanWriteAttendance(supabaseStub({}), params)).resolves.toBe(true);
  });

  // 突變測試抓到過：把這裡改成 `return true` 時，原本整組測試仍然全綠
  it('查課堂失敗時拒絕，不是放行', async () => {
    await expect(
      assertTeacherCanWriteAttendance(supabaseStub({ sessionsError: true }), params),
    ).resolves.toBe(false);
  });

  it('查不到自己的 staff 列時拒絕', async () => {
    await expect(
      assertTeacherCanWriteAttendance(supabaseStub({ ownStaffId: null }), params),
    ).resolves.toBe(false);
  });

  it('不是自己的課就拒絕', async () => {
    await expect(
      assertTeacherCanWriteAttendance(supabaseStub({ teacherId: 'someone-else' }), params),
    ).resolves.toBe(false);
  });

  // 管理員不查資料庫就通過 —— 這支每次寫入都會跑，不該為管理員多打兩支查詢
  it('管理員直接放行', async () => {
    await expect(
      assertTeacherCanWriteAttendance(supabaseStub({ teacherId: 'someone-else' }), {
        ...params,
        roles: ['admin'],
      }),
    ).resolves.toBe(true);
  });
});
