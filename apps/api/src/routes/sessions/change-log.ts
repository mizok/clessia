/**
 * 課務異動紀錄：把 `schedule_changes` 的原值/新值組成人看得懂的一句話。
 *
 * 五種異動類型的顯示邏輯不同 —— 停課只需要類型本身，代課要人名對照，調課要日期與時段，
 * 改時間只要時段（重複顯示日期是噪音）。這裡集中處理，前端只負責排版。
 */

export type ChangeType =
  'reschedule' | 'substitute' | 'cancellation' | 'uncancel' | 'time_change' | 'creation';

export interface ChangeLogRow {
  readonly id: string;
  readonly session_id: string;
  readonly change_type: ChangeType;
  readonly original_session_date: string | null;
  readonly original_start_time: string | null;
  readonly original_end_time: string | null;
  readonly new_session_date: string | null;
  readonly new_start_time: string | null;
  readonly new_end_time: string | null;
  readonly original_teacher_name: string | null;
  readonly operation_source: string;
  readonly reason: string | null;
  readonly created_by_name: string | null;
  readonly created_at: string;
  readonly sessions: unknown;
  readonly staff: unknown;
}

export interface ChangeLogEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly changeType: ChangeType;
  readonly summary: string;
  readonly sessionDate: string | null;
  readonly className: string | null;
  readonly reason: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly isBatch: boolean;
}

function firstRelation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return null;
}

/** 'HH:mm:ss' → 'HH:mm' */
function hhmm(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

/** 'YYYY-MM-DD' → 'MM/DD'（同一畫面內年份多半相同，省略以減少噪音） */
function md(value: string | null): string | null {
  return value ? value.slice(5).replace('-', '/') : null;
}

/** 把日期與時段組成 '08/12 19:00–21:00'；缺任一段就只回傳有的部分。 */
function moment(date: string | null, start: string | null, end: string | null): string | null {
  const time = start && end ? `${hhmm(start)}–${hhmm(end)}` : (hhmm(start) ?? null);
  const day = md(date);
  if (day && time) return `${day} ${time}`;
  return day ?? time;
}

function summarise(row: ChangeLogRow): string {
  const substitute = firstRelation(row.staff);

  switch (row.change_type) {
    case 'cancellation':
      return '停課';
    case 'uncancel':
      return '恢復上課';
    case 'creation':
      return '建立課堂';
    case 'substitute': {
      const from = row.original_teacher_name ?? '未指定';
      const to = (substitute?.['display_name'] as string | undefined) ?? '未指定';
      return `代課：${from} → ${to}`;
    }
    case 'reschedule': {
      const before = moment(
        row.original_session_date,
        row.original_start_time,
        row.original_end_time,
      );
      const after = moment(row.new_session_date, row.new_start_time, row.new_end_time);
      // 缺原值時只顯示新值 —— 輸出 'null → 08/15' 比資訊不全更糟
      if (!before) return after ? `調課：改為 ${after}` : '調課';
      return after ? `調課：${before} → ${after}` : `調課：原 ${before}`;
    }
    case 'time_change': {
      // 改時間不動日期，重複顯示日期是噪音
      const before = moment(null, row.original_start_time, row.original_end_time);
      const after = moment(null, row.new_start_time, row.new_end_time);
      if (!before) return after ? `改時間：改為 ${after}` : '改時間';
      return after ? `改時間：${before} → ${after}` : `改時間：原 ${before}`;
    }
    default:
      return '異動';
  }
}

export function describeChange(row: ChangeLogRow): ChangeLogEntry {
  const session = firstRelation(row.sessions);
  const classRow = session ? firstRelation(session['classes']) : null;

  return {
    id: row.id,
    sessionId: row.session_id,
    changeType: row.change_type,
    summary: summarise(row),
    sessionDate: (session?.['session_date'] as string | null) ?? null,
    className: (classRow?.['name'] as string | null) ?? null,
    reason: row.reason,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    isBatch: row.operation_source === 'batch',
  };
}
