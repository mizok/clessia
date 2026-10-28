import { describe, it, expect } from 'vitest';
import {
  canReadOn,
  loadTeachingScope,
  loadTenure,
  resolveTeachingScope,
  taughtClassIds,
  tenureOn,
  tenureOrFilter,
} from './teacher-scope';

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

/**
 * #2049（計畫席 10-28 裁定 R2）：任課判定看日期。
 * 現任或將任＝整班全期（跟看日期以前一樣，現任什麼都不少）；前任＝只限任期內的日期、沒日期的看不到。
 */
describe('任期（#2049 R2）', () => {
  const TODAY = '2026-10-28';
  const schedules = (
    rows: Array<{ class_id: string; effective_from: string; effective_to: string | null }>,
  ) => {
    const query = {
      select: () => query,
      eq: () => query,
      then: (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f),
    };
    return { from: () => query } as never;
  };

  it('分類：有一列今天有效或將生效＝現任；只剩已結束的列＝前任（任期是每一段）', async () => {
    const t = await loadTenure(
      schedules([
        { class_id: 'now', effective_from: '2026-01-01', effective_to: null },
        { class_id: 'soon', effective_from: '2026-12-01', effective_to: null },
        // split 換掉之後：舊段結束、同班另一段還有效 → 仍是現任
        { class_id: 'both', effective_from: '2026-01-01', effective_to: '2026-09-30' },
        { class_id: 'both', effective_from: '2026-10-01', effective_to: null },
        { class_id: 'gone', effective_from: '2026-01-01', effective_to: '2026-03-31' },
        { class_id: 'gone', effective_from: '2026-06-01', effective_to: '2026-09-30' },
        { class_id: 'endsToday', effective_from: '2026-01-01', effective_to: TODAY },
      ]),
      'org-1',
      'staff-1',
      TODAY,
    );
    expect([...t.current].sort()).toEqual(['both', 'endsToday', 'now', 'soon']);
    expect([...t.past]).toEqual([
      [
        'gone',
        [
          { from: '2026-01-01', to: '2026-03-31' },
          { from: '2026-06-01', to: '2026-09-30' },
        ],
      ],
    ]);
    // 沒有日期的 taughtClassIds 只回現任
    expect(
      await taughtClassIds(
        schedules([{ class_id: 'gone', effective_from: '2026-01-01', effective_to: '2026-03-31' }]),
        'org-1',
        'staff-1',
      ),
    ).toEqual([]);
  });

  const t = {
    current: ['now'],
    past: new Map([['gone', [{ from: '2026-01-01', to: '2026-03-31' }]]]),
  };

  it('現任：任何日期、沒有日期都算', () => {
    for (const date of ['2020-01-01', '2026-02-01', TODAY, null]) {
      expect(tenureOn(t, 'now', date)).toBe('current');
    }
  });

  it('前任：只有任期內（兩端都含）；任期外、沒有日期都看不到', () => {
    expect(tenureOn(t, 'gone', '2026-01-01')).toBe('past');
    expect(tenureOn(t, 'gone', '2026-03-31')).toBe('past');
    expect(tenureOn(t, 'gone', '2026-04-01')).toBe('none');
    expect(tenureOn(t, 'gone', '2025-12-31')).toBe('none');
    expect(canReadOn(t, 'gone', null)).toBe(false);
    expect(canReadOn(t, 'never', '2026-02-01')).toBe(false);
  });

  it('PostgREST 條件：現任一個 in、前任每段一個 and；什麼都沒有回 null', () => {
    expect(tenureOrFilter('class_id', 'log_date', t.current, t.past)).toBe(
      'class_id.in.(now),and(class_id.eq.gone,log_date.gte.2026-01-01,log_date.lte.2026-03-31)',
    );
    expect(tenureOrFilter('class_id', 'log_date', [], new Map())).toBeNull();
  });
});
