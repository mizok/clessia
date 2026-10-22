import { describe, expect, it } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { canTeacherWriteAttendance, teacherAttendanceWriteAccess } from './attendance-write-scope';

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
  /** `organizations.attendance_responsible`；預設 'teacher'（老師負責點名，範圍檢查才有意義） */
  responsible?: string | null;
  orgError?: boolean;
  /** 這位使用者的 staff 列所屬機構；預設 org-1（守 staff 查詢一定要帶 org_id） */
  staffOrg?: string;
  /** staff 查詢出錯（照樣回資料，守「出錯就不信資料」） */
  staffError?: boolean;
}): SupabaseClient {
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
          Promise.resolve(
            table === 'organizations'
              ? {
                  data:
                    options.responsible === null
                      ? null
                      : { attendance_responsible: options.responsible ?? 'teacher' },
                  error: options.orgError ? { message: 'boom' } : null,
                }
              : {
                  data:
                    options.ownStaffId === null ||
                    filters['user_id'] !== 'user-1' ||
                    ('org_id' in filters && filters['org_id'] !== (options.staffOrg ?? 'org-1'))
                      ? null
                      : { id: options.ownStaffId ?? 'me' },
                  error: options.staffError ? { message: 'boom' } : null,
                },
          ),
        then: (onfulfilled?: ((value: unknown) => unknown) | null) =>
          Promise.resolve(
            table === 'sessions' && options.sessionsError
              ? {
                  data: [{ teacher_id: 'me', schedules: { teacher_id: 'me' } }],
                  error: { message: 'boom' },
                } // 出錯但照樣回出「是自己的課」—— 守出錯就不信資料
              : {
                  // 別堂（event-2）一定是我的課；依 event_id 篩 —— 守 sessions 查詢一定要帶 event_id
                  data: [
                    {
                      event_id: 'event-1',
                      teacher_id: options.teacherId ?? 'me',
                      schedules: { teacher_id: options.teacherId ?? 'me' },
                    },
                    { event_id: 'event-2', teacher_id: 'me', schedules: { teacher_id: 'me' } },
                  ].filter(
                    (row) => !('event_id' in filters) || row.event_id === filters['event_id'],
                  ),
                  error: null,
                },
          ).then(onfulfilled ?? undefined),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const params = { orgId: 'org-1', userId: 'user-1', roles: ['teacher'], eventId: 'event-1' };

describe('teacherAttendanceWriteAccess', () => {
  it('是自己的課就放行', async () => {
    await expect(teacherAttendanceWriteAccess(supabaseStub({}), params)).resolves.toBe('ok');
  });

  // 突變測試抓到過：把這裡改成放行時，原本整組測試仍然全綠
  it('查課堂失敗時拒絕，不是放行', async () => {
    await expect(
      teacherAttendanceWriteAccess(supabaseStub({ sessionsError: true }), params),
    ).resolves.toBe('not-yours');
  });

  it('查不到自己的 staff 列時拒絕', async () => {
    await expect(
      teacherAttendanceWriteAccess(supabaseStub({ ownStaffId: null }), params),
    ).resolves.toBe('not-yours');
  });

  it('不是自己的課就拒絕', async () => {
    await expect(
      teacherAttendanceWriteAccess(supabaseStub({ teacherId: 'someone-else' }), params),
    ).resolves.toBe('not-yours');
  });

  // #920：行政負責點名的機構，老師端只能看
  it('行政負責點名的機構，自己的課也拒絕（not-responsible）', async () => {
    await expect(
      teacherAttendanceWriteAccess(supabaseStub({ responsible: 'admin' }), params),
    ).resolves.toBe('not-responsible');
  });

  // 讀不到設定時跟前端、補登窗同一個預設（'admin'）—— 往「不能寫」那邊倒
  it('讀不到機構設定時當成行政負責', async () => {
    await expect(
      teacherAttendanceWriteAccess(supabaseStub({ responsible: null }), params),
    ).resolves.toBe('not-responsible');
  });

  it('查機構設定失敗時拒絕', async () => {
    await expect(
      teacherAttendanceWriteAccess(supabaseStub({ orgError: true }), params),
    ).resolves.not.toBe('ok');
  });

  // 管理員不查資料庫就通過 —— 這支每次寫入都會跑，不該為管理員多打查詢
  it('管理員直接放行（行政負責的機構也是）', async () => {
    await expect(
      teacherAttendanceWriteAccess(
        supabaseStub({ teacherId: 'someone-else', responsible: 'admin' }),
        {
          ...params,
          roles: ['admin'],
        },
      ),
    ).resolves.toBe('ok');
  });

  // 同一個人在另一個機構也有 staff 列、而且正是那堂課的老師：staff 查詢不帶 org_id 就會被當成自己的課
  it('別的機構的 staff 列不算自己（staff 查詢一定要以 org_id 過濾）', async () => {
    await expect(
      teacherAttendanceWriteAccess(supabaseStub({ staffOrg: 'org-2' }), params),
    ).resolves.toBe('not-yours');
  });

  it('查 staff 失敗 → 不通過，即使同時回了資料（#1134 讀寫共用查詢後跟讀取側一致）', async () => {
    await expect(
      teacherAttendanceWriteAccess(supabaseStub({ staffError: true }), params),
    ).resolves.toBe('not-yours');
  });

  // 查詢出錯先於責任歸屬：出錯一律 not-yours（跟收成共用查詢之前同一個順序）
  it('sessions 查詢失敗、機構又是行政負責 → not-yours（出錯先判）', async () => {
    await expect(
      teacherAttendanceWriteAccess(
        supabaseStub({ sessionsError: true, responsible: 'admin' }),
        params,
      ),
    ).resolves.toBe('not-yours');
  });

  it('別堂是我的、這堂不是 → not-yours（sessions 查詢一定要以 event_id 過濾）', async () => {
    await expect(
      teacherAttendanceWriteAccess(supabaseStub({ teacherId: 'someone-else' }), params),
    ).resolves.toBe('not-yours');
  });
});
