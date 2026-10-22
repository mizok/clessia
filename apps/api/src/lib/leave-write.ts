import type { Queryable } from './identity-sql';
import { leavesConflict, toLeaveWindow, type LeaveWindow } from './leave-covers-session';

/**
 * 請假單的寫入：**取鎖 → 查重疊 → 寫入**，全在同一條 pg 連線、同一筆交易裡（#1957）。呼叫端用 `withTx` 包。
 *
 * **為什麼**：原本是「先用 supabase-js 查有沒有重疊，沒有才 insert」—— 兩支 REST 各自一個連線一個交易，
 * 兩個請求同時進來都會查到「沒有」，於是同一個學生同一段時間有兩張假（連點、網路重送、批次請假都會踩到）。
 *
 * **為什麼不是 DB 排除約束**（#1957 計畫席裁定 B）：「重疊」的判準是業務規則（`leavesConflict`，
 * #1114 裁定 4）—— 同一天不同堂的兩張綁定假合法、綁定假的外框跟整天假重疊但整天落在空檔也合法，
 * `daterange &&` 表達不了，硬上會擋掉合法的請假。
 *
 * 鎖是 `pg_advisory_xact_lock`，鍵＝org＋學生：同一個學生的請假排隊，別的學生不受影響；交易結束自動放。
 * **只有會讓假變多、變寬的路徑要取鎖**（POST、PATCH 改區間、改綁定）。截短、銷假、退班同步只會讓假變少，
 * 造不出新的重疊。出勤連動、通知、稽核在 COMMIT 之後做（交易裡不做對外 I/O，pg-pool-writes 規則）。
 */

export async function lockStudentLeaves(
  db: Queryable,
  orgId: string,
  studentId: string,
): Promise<void> {
  await db.query(
    "select pg_advisory_xact_lock(hashtextextended('leave:' || $1::text || ':' || $2::text, 0))",
    [orgId, studentId],
  );
}

/**
 * 跟 `routes/leaves.ts` 的 `findConflictingLeave`（REST）**同一組候選、同一支判準**：
 * SQL 只撈「區間有交集」的候選（必要條件），細分交給 `leavesConflict`。
 * 列的形狀照 REST 的 `LEAVE_WINDOW_COLUMNS`，所以 `toLeaveWindow` 兩邊共用。
 */
export async function findConflictingLeaveViaSql(
  db: Queryable,
  orgId: string,
  studentId: string,
  next: LeaveWindow,
  excludeId?: string,
): Promise<{ start_date: string; end_date: string } | null> {
  const { rows } = await db.query(
    `select l.id, l.start_date::text as start_date, l.end_date::text as end_date,
            l.start_time::text as start_time, l.end_time::text as end_time,
            coalesce(
              (select json_agg(json_build_object(
                        'session_id', ls.session_id,
                        'sessions', case when s.id is null then null
                                         else json_build_object('session_date', s.session_date::text) end))
                 from public.leave_request_sessions ls
                 left join public.sessions s on s.id = ls.session_id
                where ls.leave_request_id = l.id),
              '[]'::json) as leave_request_sessions
       from public.leave_requests l
      where l.org_id = $1::uuid and l.student_id = $2::uuid
        and ($3::uuid is null or l.id <> $3::uuid)
        and l.start_date <= $4::date and l.end_date >= $5::date`,
    [orgId, studentId, excludeId ?? null, next.endDate, next.startDate],
  );
  const hit = (rows as Array<Record<string, unknown>>).find((row) =>
    leavesConflict(toLeaveWindow(row), next),
  );
  return hit
    ? { start_date: hit['start_date'] as string, end_date: hit['end_date'] as string }
    : null;
}

/**
 * 回應用的列：照 REST 的 `*, leave_request_sessions(...), students(name), ba_user!submitted_by(name)`
 * （日期時間在 SQL 裡就轉成字串；pg 會把 date 變成 JS `Date`）。綁定堂次是寫入前的快照 —— 同一筆交易裡呼叫端再改綁定的話，用它自己知道的那份
 */
const LEAVE_ROW_JSON = `to_jsonb(l)
  || jsonb_build_object(
       'students', (select jsonb_build_object('name', st.name) from public.students st where st.id = l.student_id),
       'ba_user', (select jsonb_build_object('name', u.name) from public.ba_user u where u.id = l.submitted_by),
       'leave_request_sessions', coalesce(
         (select jsonb_agg(jsonb_build_object(
                   'session_id', ls.session_id,
                   'sessions', jsonb_build_object('session_date', s.session_date::text)))
            from public.leave_request_sessions ls
            left join public.sessions s on s.id = ls.session_id
           where ls.leave_request_id = l.id),
         '[]'::jsonb))`;

export interface NewLeave {
  readonly orgId: string;
  readonly studentId: string;
  readonly window: LeaveWindow;
  readonly reason: string | null;
  readonly userId: string;
}

/** 新增一張假（含綁定堂次）。回傳 REST 形狀的列 */
export async function insertLeave(db: Queryable, p: NewLeave): Promise<Record<string, unknown>> {
  const { rows } = await db.query(
    `with l as (
       insert into public.leave_requests
         (org_id, student_id, start_date, end_date, start_time, end_time, reason, submitted_by, submitted_by_role)
       values ($1::uuid, $2::uuid, $3::date, $4::date, $5::time, $6::time, $7, $8, 'admin')
       returning *)
     select ${LEAVE_ROW_JSON} as row from l`,
    [
      p.orgId,
      p.studentId,
      p.window.startDate,
      p.window.endDate,
      p.window.startTime,
      p.window.endTime,
      p.reason,
      p.userId,
    ],
  );
  const row = (rows[0] as { row: Record<string, unknown> }).row;
  await bindSessions(
    db,
    p.orgId,
    row['id'] as string,
    p.window.boundSessions.map((b) => b.sessionId),
  );
  return row;
}

export async function bindSessions(
  db: Queryable,
  orgId: string,
  leaveId: string,
  sessionIds: readonly string[],
): Promise<void> {
  if (sessionIds.length === 0) return;
  await db.query(
    `insert into public.leave_request_sessions (leave_request_id, session_id, org_id)
     select $1::uuid, s, $2::uuid from unnest($3::uuid[]) s`,
    [leaveId, orgId, [...sessionIds]],
  );
}

export async function unbindSessions(
  db: Queryable,
  orgId: string,
  leaveId: string,
  sessionIds: readonly string[],
): Promise<void> {
  if (sessionIds.length === 0) return;
  await db.query(
    `delete from public.leave_request_sessions
      where org_id = $1::uuid and leave_request_id = $2::uuid and session_id = any($3::uuid[])`,
    [orgId, leaveId, [...sessionIds]],
  );
}

/** PATCH 可以改的欄位（白名單：SQL 欄名不吃外部字串） */
const UPDATABLE = ['start_date', 'end_date', 'start_time', 'end_time', 'reason'] as const;
const CAST: Record<(typeof UPDATABLE)[number], string> = {
  start_date: '::date',
  end_date: '::date',
  start_time: '::time',
  end_time: '::time',
  reason: '',
};

/** 改一張假；找不到（別的請求先刪了）回 null。回傳 REST 形狀的列，含綁定堂次 */
export async function updateLeave(
  db: Queryable,
  orgId: string,
  leaveId: string,
  updates: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown> | null> {
  const cols = UPDATABLE.filter((col) => col in updates);
  const values: unknown[] = [orgId, leaveId];
  const sets = cols.map((col) => {
    values.push(updates[col] ?? null);
    return `${col} = $${values.length}${CAST[col]}`;
  });
  // updated_at 由既有的 leave_requests_updated_at trigger 寫
  if (sets.length === 0) throw new Error('updateLeave：沒有要改的欄位');
  const { rows } = await db.query(
    `with l as (
       update public.leave_requests set ${sets.join(', ')}
        where org_id = $1::uuid and id = $2::uuid
       returning *)
     select ${LEAVE_ROW_JSON} as row from l`,
    values,
  );
  return (rows[0] as { row: Record<string, unknown> } | undefined)?.row ?? null;
}
