import type { Pool } from 'pg';

/**
 * 班級列表每列的課堂與在籍統計（#2226，#1928 A#5）—— **一支 SQL、在 DB 端數好**。
 *
 * 原本拿到本頁 `classIds` 後發 4 支 PostgREST `.in('class_id', classIds)`，撈回逐堂原始列在 JS 裡數：
 * 班一多（`pageSize=0`）就 414；逐堂列動輒上千，被 max_rows（1000）**靜默截斷**（分頁模式也會），
 * 錯誤又被吞成 0／空。計畫席裁定（#2226）：列表與授權照舊走 PostgREST，`classIds` 是授權過的集合，
 * 這裡只拿它當參數，**不重寫分校條件**，`org_id` 只是防呆。
 *
 * 口徑跟原本 JS 一樣：
 * - 「未來」＝`session_date >= today`（台北日期，呼叫端給）
 * - 班內衝突＝同班同日、時間重疊（`a.start < b.end and b.start < a.end`，同 `isTimeOverlap`）的**堂對**數
 * - 老師衝突＝同老師同日、時間重疊的堂對，**兩邊的班各 +1**；只看這批班裡的課堂（跟原本一樣）
 * - 過去課堂＝`session_date < today` **或** `status = completed`（見 `class-past-sessions.ts` 的 #762）
 * - 在籍＝active 且 today 在生效區間內（同 `countEnrolledOn`，結束當天還算）
 */
export interface ClassListStats {
  readonly hasUpcomingSessions: boolean;
  readonly hasPastSessions: boolean;
  readonly upcomingCancelledCount: number;
  readonly upcomingUnassignedCount: number;
  readonly upcomingClassConflictCount: number;
  readonly upcomingTeacherConflictCount: number;
  readonly enrolledCount: number;
}

const SQL = `
with up as (
  select id, class_id, session_date, start_time, end_time, teacher_id
    from sessions
   where org_id = $2 and class_id = any($1::uuid[]) and session_date >= $3 and status = 'scheduled'
),
up_agg as (
  select class_id, count(*)::int as n, (count(*) filter (where teacher_id is null))::int as unassigned
    from up group by class_id
),
class_conflict as (
  select a.class_id, count(*)::int as n
    from up a join up b
      on b.class_id = a.class_id and b.session_date = a.session_date and b.id > a.id
     and a.start_time < b.end_time and b.start_time < a.end_time
   group by a.class_id
),
teacher_pairs as (
  select a.class_id as ca, b.class_id as cb
    from up a join up b
      on b.teacher_id = a.teacher_id and b.session_date = a.session_date and b.id > a.id
     and a.start_time < b.end_time and b.start_time < a.end_time
),
teacher_conflict as (
  select class_id, count(*)::int as n
    from (select ca as class_id from teacher_pairs union all select cb from teacher_pairs) t
   group by class_id
),
past as (
  select distinct class_id from sessions
   where org_id = $2 and class_id = any($1::uuid[]) and (session_date < $3 or status = 'completed')
),
cancelled as (
  select class_id, count(*)::int as n from sessions
   where org_id = $2 and class_id = any($1::uuid[]) and session_date >= $3 and status = 'cancelled'
   group by class_id
),
enrolled as (
  select class_id, count(*)::int as n from enrollments
   where org_id = $2 and class_id = any($1::uuid[]) and status = 'active'
     and effective_from <= $3 and (effective_to is null or effective_to >= $3)
   group by class_id
)
select ids.class_id,
       coalesce(up_agg.n, 0) > 0 as has_upcoming,
       past.class_id is not null as has_past,
       coalesce(cancelled.n, 0) as cancelled,
       coalesce(up_agg.unassigned, 0) as unassigned,
       coalesce(class_conflict.n, 0) as class_conflict,
       coalesce(teacher_conflict.n, 0) as teacher_conflict,
       coalesce(enrolled.n, 0) as enrolled
  from unnest($1::uuid[]) as ids(class_id)
  left join up_agg using (class_id)
  left join past using (class_id)
  left join cancelled using (class_id)
  left join class_conflict using (class_id)
  left join teacher_conflict using (class_id)
  left join enrolled using (class_id)`;

/** 失敗直接丟出 —— 呼叫端回 500，不把「查不到」說成 0 */
export async function loadClassListStats(
  pool: Pick<Pool, 'query'>,
  orgId: string,
  classIds: readonly string[],
  today: string,
): Promise<Map<string, ClassListStats>> {
  const result = new Map<string, ClassListStats>();
  if (classIds.length === 0) return result;
  const { rows } = await pool.query(SQL, [classIds, orgId, today]);
  for (const r of rows as Array<Record<string, unknown>>) {
    result.set(r['class_id'] as string, {
      hasUpcomingSessions: r['has_upcoming'] === true,
      hasPastSessions: r['has_past'] === true,
      upcomingCancelledCount: Number(r['cancelled']),
      upcomingUnassignedCount: Number(r['unassigned']),
      upcomingClassConflictCount: Number(r['class_conflict']),
      upcomingTeacherConflictCount: Number(r['teacher_conflict']),
      enrolledCount: Number(r['enrolled']),
    });
  }
  return result;
}
