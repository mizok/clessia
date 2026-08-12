/**
 * 「被代課」查詢：某位老師原本排到、但後來被換掉的課堂。
 *
 * 為什麼需要這個：代課發生時 `sessions.teacher_id` 會被改寫成代課老師（sessions.ts 的
 * substitute handler），所以原老師從 `sessions` 查不到這幾堂。但他的排課被拿掉這件事必須
 * 留痕 —— 否則他自己對不上帳，也無從發現異常的代課頻率。
 * 原老師是誰保存在 `schedule_changes.original_teacher_id`。
 *
 * 這些課堂**不計入原老師的時數**（時數歸實際上課的人），只是列出來讓紀錄完整。
 */

export interface SubstitutedAwayRow {
  readonly id: string;
  readonly session_id: string;
  readonly created_at: string;
  readonly original_teacher_id: string | null;
  readonly sessions: unknown;
  readonly staff: unknown;
}

export interface SubstitutedAwayEntry {
  readonly changeId: string;
  readonly sessionId: string;
  readonly sessionDate: string | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly className: string | null;
  readonly substituteTeacherName: string | null;
  readonly reason: string | null;
  readonly changedAt: string;
}

/** PostgREST 的關聯欄位可能是物件或陣列，取第一筆。 */
function firstRelation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return null;
}

/** 'HH:mm:ss' → 'HH:mm'；null 保持 null。 */
function toHHmm(value: unknown): string | null {
  return typeof value === 'string' ? value.slice(0, 5) : null;
}

/**
 * 把 schedule_changes 的查詢結果組成「被代課」條目，依課堂日期由新到舊排序。
 *
 * 排序用**課堂日期**而不是異動建立時間：使用者想看的是「哪幾堂課被換掉了」，
 * 不是「異動是什麼時候登記的」。同一天多筆時才用開始時間排。
 */
export function buildSubstitutedAwayEntries(
  rows: readonly SubstitutedAwayRow[],
): SubstitutedAwayEntry[] {
  const entries = rows.map((row) => {
    const session = firstRelation(row.sessions);
    const substitute = firstRelation(row.staff);
    const classRow = session ? firstRelation(session['classes']) : null;

    return {
      changeId: row.id,
      sessionId: row.session_id,
      sessionDate: (session?.['session_date'] as string | null) ?? null,
      startTime: toHHmm(session?.['start_time']),
      endTime: toHHmm(session?.['end_time']),
      className: (classRow?.['name'] as string | null) ?? null,
      substituteTeacherName: (substitute?.['display_name'] as string | null) ?? null,
      reason: (row as { reason?: string | null }).reason ?? null,
      changedAt: row.created_at,
    };
  });

  return entries.sort((a, b) => {
    if (a.sessionDate !== b.sessionDate) {
      // null 排最後：沒有課堂日期的資料異常，不該擠在最前面
      if (!a.sessionDate) return 1;
      if (!b.sessionDate) return -1;
      return b.sessionDate.localeCompare(a.sessionDate);
    }
    return (b.startTime ?? '').localeCompare(a.startTime ?? '');
  });
}
