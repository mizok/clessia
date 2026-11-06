import type { Queryable } from './identity-sql';

/**
 * 學生名冊的老師範圍前置：本人 staff → 任課時段 → 在籍報名，三波 REST 併成一支 pg（#1595 P2 ② 刀 2）。
 *
 * **只回原料**（#1928 乙′）：現任／前任的判準仍是 `tenureFromSchedules` 那一份（`lib/teacher-scope.ts`），
 * 這裡不判日期。報名只先篩狀態（active／pending_payment，同 builder），班是不是現任由呼叫端濾。
 * `schedules` 沒有 `org_id`，經 `classes.org_id = $1` 收；staff 與報名都帶 `org_id = $1`（c1）。
 * 失敗丟例外 → 500，不退回 REST（#2230 (c)）。
 */
export const TEACHER_ROSTER_SQL = `
with me as (
  select st.id from public.staff st where st.user_id = $2 and st.org_id = $1::uuid
),
sch as (
  select sc.class_id, sc.effective_from, sc.effective_to
  from public.schedules sc
  join public.classes cl on cl.id = sc.class_id and cl.org_id = $1::uuid
  where sc.teacher_id = (select id from me)
)
select json_build_object(
  'staffId', (select id from me),
  'schedules', coalesce((select json_agg(row_to_json(sch)) from sch), '[]'::json),
  'enrollments', coalesce((
    select json_agg(json_build_object('student_id', e.student_id, 'class_id', e.class_id))
    from public.enrollments e
    where e.org_id = $1::uuid
      and e.class_id in (select class_id from sch)
      and e.status in ('active', 'pending_payment')
  ), '[]'::json)
) as result
`;

export interface TeacherRoster {
  readonly staffId: string | null;
  /** `tenureFromSchedules` 吃的形狀 */
  readonly schedules: Record<string, unknown>[];
  readonly enrollments: { student_id: string; class_id: string }[];
}

export async function loadTeacherRosterViaSql(
  db: Queryable,
  p: { orgId: string; userId: string },
): Promise<TeacherRoster> {
  try {
    const { rows } = await db.query(TEACHER_ROSTER_SQL, [p.orgId, p.userId]);
    const r = (rows[0] as { result?: Record<string, unknown> } | undefined)?.result;
    const ok =
      rows.length === 1 &&
      r !== undefined &&
      (r['staffId'] === null || typeof r['staffId'] === 'string') &&
      Array.isArray(r['schedules']) &&
      Array.isArray(r['enrollments']);
    if (!ok) throw new Error('[students-sql] 老師範圍結果形狀不對');
    return r as unknown as TeacherRoster;
  } catch (err) {
    console.error(
      `[students-sql] 老師範圍查詢失敗：${(err as { code?: string })?.code ?? 'unknown'}`,
    );
    throw err;
  }
}
