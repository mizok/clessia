import type { Queryable } from './identity-sql';

/**
 * `GET /api/sessions` 主查詢之後的三支補充讀取，改走 pg（#1928）。
 *
 * 課表月檢視一次撈 500 堂（前端 `FETCH_LIMIT`），原本把這 500 個 session／event id 塞進 `.in()`：
 * - 網址太長 → 414：異動那支整頁回 400；出勤那支錯誤沒檢查 → 出勤數靜默 0
 * - 就算沒 414，500 堂 × 每堂二十幾筆出勤遠超過 1000 列 → 被 `max_rows` 截斷 → 出勤數算錯
 *
 * pg 的陣列參數走 bind（沒有網址長度），也沒有列數上限。**出勤在 SQL 裡 `count … group by`**，
 * 不把出勤列撈回來數（計畫席 10-23）。
 *
 * **範圍條件不在這裡**：三支都只吃主查詢已經套過分校範圍的 id，外加 `org_id`（c1）。
 * 「某天在不在籍」的規則只有 `lib/session-roster.ts` 的 `isEnrolledOn` 一份，所以在籍這支只撈區間、
 * 照舊在 TS 數，不在 SQL 重寫一份。
 *
 * 結果一律在 Postgres 組成 JSON：`pg` 會把 date／timestamptz 轉成 JS Date，格式跟 PostgREST 回的字串不同。
 * 失敗一律丟例外（呼叫端回 500）。
 */

/** 每堂最新一筆異動，欄位跟原本 REST 那支 select 相同 */
export async function latestChangesViaSql(
  db: Queryable,
  orgId: string,
  sessionIds: readonly string[],
): Promise<Record<string, unknown>[]> {
  if (sessionIds.length === 0) return [];
  const { rows } = await db.query(
    `select coalesce(json_agg(json_build_object(
        'session_id', x.session_id, 'change_type', x.change_type, 'reason', x.reason,
        'original_teacher_name', x.original_teacher_name,
        'original_session_date', x.original_session_date,
        'original_start_time', x.original_start_time, 'original_end_time', x.original_end_time,
        'created_at', x.created_at)), '[]'::json) as result
       from (
         select distinct on (sc.session_id) sc.*
           from public.schedule_changes sc
          where sc.org_id = $1::uuid
            and sc.session_id = any($2::uuid[])
          order by sc.session_id, sc.created_at desc
       ) x`,
    [orgId, sessionIds],
  );
  return expectArray(rows, '異動');
}

/** 每個 event × 出勤狀態有幾筆（在 SQL 裡數，不撈列回來） */
export async function attendanceCountsViaSql(
  db: Queryable,
  orgId: string,
  eventIds: readonly string[],
): Promise<Array<{ eventId: string; status: string; count: number }>> {
  if (eventIds.length === 0) return [];
  const { rows } = await db.query(
    `select coalesce(json_agg(json_build_object(
        'eventId', t.event_id, 'status', t.status, 'count', t.n)), '[]'::json) as result
       from (
         select ar.event_id, ar.status, count(*) as n
           from public.attendance_records ar
          where ar.org_id = $1::uuid
            and ar.event_id = any($2::uuid[])
          group by ar.event_id, ar.status
       ) t`,
    [orgId, eventIds],
  );
  return expectArray(rows, '出勤') as Array<{ eventId: string; status: string; count: number }>;
}

/** 這些班的 active 報名生效區間（在籍人數由 `countEnrolledOn` 照舊在 TS 數） */
export async function enrollmentRangesViaSql(
  db: Queryable,
  orgId: string,
  classIds: readonly string[],
): Promise<Record<string, unknown>[]> {
  if (classIds.length === 0) return [];
  const { rows } = await db.query(
    `select coalesce(json_agg(json_build_object(
        'class_id', e.class_id, 'effective_from', e.effective_from,
        'effective_to', e.effective_to)), '[]'::json) as result
       from public.enrollments e
      where e.org_id = $1::uuid
        and e.status = 'active'
        and e.class_id = any($2::uuid[])`,
    [orgId, classIds],
  );
  return expectArray(rows, '在籍區間');
}

function expectArray(rows: unknown[], what: string): Record<string, unknown>[] {
  const result = (rows[0] as { result?: unknown } | undefined)?.result;
  if (rows.length !== 1 || !Array.isArray(result)) {
    throw new Error(`[sessions-sql] ${what}的結果形狀不對`);
  }
  return result as Record<string, unknown>[];
}
