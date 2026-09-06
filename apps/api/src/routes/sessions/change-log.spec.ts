import { describe, expect, it } from 'vitest';

import {
  describeChange,
  SCHEDULE_CHANGE_TYPES,
  SESSION_HISTORY_TYPES,
  type ChangeLogRow,
} from './change-log';

function row(overrides: Partial<ChangeLogRow> = {}): ChangeLogRow {
  return {
    id: 'chg-1',
    session_id: 'sess-1',
    change_type: 'cancellation',
    original_session_date: null,
    original_start_time: null,
    original_end_time: null,
    new_session_date: null,
    new_start_time: null,
    new_end_time: null,
    original_teacher_name: null,
    operation_source: 'single',
    reason: null,
    created_by_name: '王主任',
    created_at: '2026-08-10T03:00:00Z',
    sessions: { session_date: '2026-08-12', classes: { name: '國二數學 A' } },
    staff: null,
    ...overrides,
  };
}

describe('describeChange', () => {
  it('停課', () => {
    expect(describeChange(row({ change_type: 'cancellation' })).summary).toBe('停課');
  });

  it('取消停課', () => {
    expect(describeChange(row({ change_type: 'uncancel' })).summary).toBe('恢復上課');
  });

  it('代課顯示原老師 → 代課老師', () => {
    const result = describeChange(
      row({
        change_type: 'substitute',
        original_teacher_name: '王小明',
        staff: { display_name: '李老師' },
      }),
    );

    expect(result.summary).toBe('代課：王小明 → 李老師');
  });

  it('原老師姓名是快照，即使 staff 關聯已不存在也顯示得出來', () => {
    // original_teacher_name 刻意存快照而非 join —— 老師離職後歷史仍要看得到當時的名字
    const result = describeChange(
      row({
        change_type: 'substitute',
        original_teacher_name: '已離職的張老師',
        staff: { display_name: '李老師' },
      }),
    );

    expect(result.summary).toContain('已離職的張老師');
  });

  it('代課缺代課老師時不顯示「→ null」', () => {
    const result = describeChange(
      row({ change_type: 'substitute', original_teacher_name: '王小明', staff: null }),
    );

    expect(result.summary).toBe('代課：王小明 → 未指定');
  });

  it('調課顯示原日期時間 → 新日期時間', () => {
    const result = describeChange(
      row({
        change_type: 'reschedule',
        original_session_date: '2026-08-12',
        original_start_time: '19:00:00',
        original_end_time: '21:00:00',
        new_session_date: '2026-08-15',
        new_start_time: '19:00:00',
        new_end_time: '21:00:00',
      }),
    );

    expect(result.summary).toBe('調課：08/12 19:00–21:00 → 08/15 19:00–21:00');
  });

  it('改時間只顯示時段變化，不重複日期', () => {
    const result = describeChange(
      row({
        change_type: 'time_change',
        original_start_time: '19:00:00',
        original_end_time: '21:00:00',
        new_start_time: '18:30:00',
        new_end_time: '20:30:00',
      }),
    );

    expect(result.summary).toBe('改時間：19:00–21:00 → 18:30–20:30');
  });

  it('缺原值時退回只顯示新值，不輸出 null', () => {
    const result = describeChange(
      row({
        change_type: 'reschedule',
        original_session_date: null,
        new_session_date: '2026-08-15',
        new_start_time: '19:00:00',
        new_end_time: '21:00:00',
      }),
    );

    expect(result.summary).toBe('調課：改為 08/15 19:00–21:00');
    expect(result.summary).not.toContain('null');
  });

  it('帶出課堂日期、班級、操作者、批次標記', () => {
    const result = describeChange(row({ operation_source: 'batch' }));

    expect(result.sessionDate).toBe('2026-08-12');
    expect(result.className).toBe('國二數學 A');
    expect(result.createdByName).toBe('王主任');
    expect(result.isBatch).toBe(true);
  });

  it('single 不算批次', () => {
    expect(describeChange(row({ operation_source: 'single' })).isBatch).toBe(false);
  });

  it('PostgREST 把關聯回成陣列時也取得到值', () => {
    const result = describeChange(
      row({
        sessions: [{ session_date: '2026-08-12', classes: [{ name: '國三英文' }] }],
        staff: [{ display_name: '陳老師' }],
        change_type: 'substitute',
        original_teacher_name: '王小明',
      }),
    );

    expect(result.className).toBe('國三英文');
    expect(result.summary).toBe('代課：王小明 → 陳老師');
  });
});

describe('SCHEDULE_CHANGE_TYPES 是唯一真相（#605）', () => {
  // 這份清單對齊 DB 的 `schedule_change_type` enum（2026-09-07 查 `pg_enum`）。
  // 釘住它是因為**加一個值以前要記得改六個地方**，而 `time_change` 在其中一份
  // 漏了將近半年、`makeup` 上線當天漏了四份。
  it('含 makeup，且不含合成的 creation', () => {
    expect(SCHEDULE_CHANGE_TYPES).toContain('makeup');
    expect(SCHEDULE_CHANGE_TYPES).not.toContain('creation');
  });

  // `creation` 只存在於歷程回應，不能當查詢條件 —— 兩份清單的差別就是這一個值。
  it('歷程類型 = DB 六種 + creation，正好多一個', () => {
    expect(SESSION_HISTORY_TYPES).toContain('creation');
    expect(SESSION_HISTORY_TYPES).toHaveLength(SCHEDULE_CHANGE_TYPES.length + 1);
  });

  it('每一種 DB 類型都有自己的摘要，不會落到 default 的「異動」', () => {
    for (const changeType of SCHEDULE_CHANGE_TYPES) {
      const summary = describeChange(row({ change_type: changeType })).summary;

      expect(summary, `${changeType} 落到 default 了`).not.toBe('異動');
    }
  });
});
