import { describe, it, expect } from 'vitest';
import { loadTeachingScope, resolveTeachingScope, taughtClassIds } from './teacher-scope';

/**
 * 聯絡簿與教務日誌共用這條規則：管理員不受限，老師只能碰自己固定任課的班。
 *
 * 跟 `routes/students/teacher-scope.ts`、`routes/attendance/teacher-scope.ts` 同一個模式 ——
 * **範圍限制放在伺服器，而且不看請求怎麼說**。前端隱藏不構成授權（c1）。
 */
describe('resolveTeachingScope', () => {
  it('管理員不受限', () => {
    expect(resolveTeachingScope({ roles: ['admin'], ownStaffId: null })).toEqual({
      teacherStaffId: null,
    });
  });

  it('管理員即使同時是老師也不受限 —— 權限取聯集', () => {
    expect(resolveTeachingScope({ roles: ['teacher', 'admin'], ownStaffId: 'staff-1' })).toEqual({
      teacherStaffId: null,
    });
  });

  it('老師縮限到自己的 staff id', () => {
    expect(resolveTeachingScope({ roles: ['teacher'], ownStaffId: 'staff-1' })).toEqual({
      teacherStaffId: 'staff-1',
    });
  });

  /** 沒有 staff 列就無法安全地縮限，放行等於把全校的紀錄交出去 */
  it('老師但查不到 staff 列 → 拒絕，不是放行', () => {
    expect(resolveTeachingScope({ roles: ['teacher'], ownStaffId: null })).toEqual({
      forbidden: true,
    });
  });

  it('家長碰不到這兩個資源', () => {
    expect(resolveTeachingScope({ roles: ['parent'], ownStaffId: null })).toEqual({
      forbidden: true,
    });
  });

  it('沒有角色 → 拒絕', () => {
    expect(resolveTeachingScope({ roles: [], ownStaffId: null })).toEqual({ forbidden: true });
  });
});

/**
 * `taughtClassIds` 曾經對 `schedules` 下 `.eq('org_id', ...)`，而**那張表沒有這個欄位**
 * —— PostgREST 回 42703，`data ?? []` 把它變成「這位老師沒有任何班」。老師端的聯絡簿、
 * 教務日誌、成績、校內考、段考全部回空，而且看起來就像「本來就沒有資料」。
 *
 * 所以這裡守兩件事：**org 的界線走 `classes`**、以及**查詢失敗會冒出來**。
 */
describe('taughtClassIds', () => {
  function createSupabase(result: { data: unknown[] | null; error: { message: string } | null }) {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: (columns: string) => {
        filters.push(['select', columns]);
        return query;
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      then: (onfulfilled?: ((value: typeof result) => unknown) | null) =>
        Promise.resolve(result).then(onfulfilled ?? undefined),
    };
    return { supabase: { from: () => query }, filters };
  }

  it('org 的界線下在 classes 上，不是下在 schedules 上', async () => {
    const { supabase, filters } = createSupabase({
      data: [{ class_id: 'class-1' }, { class_id: 'class-1' }, { class_id: 'class-2' }],
      error: null,
    });

    await expect(taughtClassIds(supabase as never, 'org-1', 'staff-1')).resolves.toEqual([
      'class-1',
      'class-2',
    ]);

    // schedules 沒有 org_id 欄位 —— 下在它身上就是 42703
    expect(filters).not.toContainEqual(['org_id', 'org-1']);
    expect(filters).toContainEqual(['classes.org_id', 'org-1']);
    expect(filters).toContainEqual(['teacher_id', 'staff-1']);
  });

  it('查詢失敗要冒出來，不是安靜地變成「他沒有任何班」', async () => {
    const { supabase } = createSupabase({
      data: null,
      error: { message: 'column schedules.org_id does not exist' },
    });

    await expect(taughtClassIds(supabase as never, 'org-1', 'staff-1')).rejects.toThrow(
      '查詢任課班級失敗',
    );
  });
});

describe('loadTeachingScope', () => {
  it('查 staff 失敗要冒出來，不是被當成「他不是老師」', async () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    };

    await expect(
      loadTeachingScope({ from: () => query } as never, {
        orgId: 'org-1',
        userId: 'user-1',
        roles: ['teacher'],
      }),
    ).rejects.toThrow('查詢教職員身分失敗');
  });
});
