import type { Queryable } from './identity-sql';

/**
 * `GET /api/students` 改走 SQL（Hyperdrive），一次往返（#1595 P2 ② 刀 1a，計畫席 11-05 裁定）。
 *
 * **為什麼**：builder 是列表＋在籍數＋年級章節＋本頁家長電話，受限管理員／老師／卡片篩選時章節是
 * 每級一支 head count —— 一頁約 17 支 REST，Workers 每請求 6 條連線，切成 3 波以上。
 *
 * **授權不在這裡算**：分校範圍（`campusFilterIds`）與老師任課班（`taughtClassIds`）由呼叫端算好當參數。
 * `null`＝不篩、空陣列＝零筆（fail-closed）。條件照 builder 的 embed：
 * - 分校＝**任一筆報名（不分狀態）**的班在範圍內（enrollment-rules 第 8 節：看得到自家剛退班的）
 * - 老師＝**同一筆**報名在任課班且 active／pending_payment
 * 列表、在籍數、章節共用同一段 where（#815）。根表 `students.org_id = $1`（c1）；報名、卡片、家長、班
 * 經學生的 FK 收，**刻意不另加 org 條件** —— 跟 builder 的 embed 一致，兩條路才逐欄相同。
 * 學制不合的學校照 builder 限本 org（`schools.org_id = $1`）。
 *
 * **搜尋與今日到班**（刀 1b）：都是條件、不是 id 清單 —— 家長姓名／電話、學校名在 SQL 裡 `exists`，
 * 今日到班的 id 以 `= any($17)` 傳（不進 URL，不會 414）。**家長姓名、電話一律限本 org 的家長**
 * （`parents.org_id = $1`）：builder 的家長姓名原本沒有 org 條件（授權面缺口，#1595 P2 ② 裁定 (c)）。
 *
 * **不退回**：任何失敗丟例外 → 500（#2230 (c)）。builder 只留給沒有 pool 的單元測試，
 * 兩份條件由 `contract/student-list-sql.contract.ts` 逐欄比對。
 *
 * `rows` 的形狀跟 builder 的 select 相同（`*`、`schools`、`parent_student_relations→parents`、
 * `enrollments→classes→campuses`、`active_card`），另外在 `parents` 裡多帶 `phone`（`withPhone` 時）。
 */

export interface StudentListParams {
  readonly orgId: string;
  /** `campusFilterIds(scope, campusId)` */
  readonly campusIds: readonly string[] | null;
  /** 老師固定任課的班；管理員 null */
  readonly classIds: readonly string[] | null;
  readonly grade: string | null;
  readonly isActive: boolean | null;
  readonly schoolMismatch: boolean;
  readonly withoutCard: boolean;
  readonly cardIssuedToday: boolean;
  /** 台北今天 00:00 與明天 00:00（`YYYY-MM-DDT00:00:00+08:00`），卡片「今天發的」 */
  readonly cardDayStart: string;
  readonly cardDayEnd: string;
  readonly limit: number;
  readonly offset: number;
  /** 主要家長電話：只有管理員（老師一律不帶） */
  readonly withPhone: boolean;
  /** 搜尋字（沒有就 null）。`*` 跟 PostgREST 的 ilike 一樣當萬用字元 */
  readonly search: string | null;
  /** `searchScope=default`：也比家長姓名、家長電話、學校名；`student_name` 只比學生姓名 */
  readonly searchRelated: boolean;
  /** 3 碼以上純數字：也比家長電話（判準留在 JS，同 builder） */
  readonly searchPhone: boolean;
  /** 今日到班篩選命中的學生（JS 依 `classifyToday` 算好）；沒帶 `today` 時 null */
  readonly todayIds: readonly string[] | null;
}

export interface StudentListResult {
  readonly rows: Record<string, unknown>[];
  readonly total: number;
  readonly activeCount: number;
  /** 年級 → 人數；沒有的年級不在裡面 */
  readonly byGrade: Record<string, number>;
}

/**
 * `$1` org、`$2` 分校、`$3` 任課班、`$4` grade、`$5` isActive、`$6` 學制不合、`$7` 沒有有效卡、
 * `$8` 今天發的卡、`$9`／`$10` 卡片日界、`$11` limit、`$12` offset、`$13` 帶電話、`$14` 搜尋字、
 * `$15` 搜尋也比家長／學校、`$16` 搜尋也比家長電話、`$17` 今日到班 id。
 *
 * - 學制不合照 `schoolMismatchClause`：本 org 的學校、學制非 null 且跟年級推出的學制不同
 * - 卡片照 builder：`active_card` 只留沒作廢的（今天發的再限發卡時間）；沒有有效卡＝反連接
 * - 排序照 builder 的 `grade desc, name, id`（grade 是 enum，依列舉序）
 * - embed 陣列不排序，同 PostgREST
 */
export const STUDENT_LIST_SQL = `
with base as (
  select s.* from public.students s
  where s.org_id = $1::uuid
    and ($2::uuid[] is null or exists (
      select 1 from public.enrollments e
      join public.classes cl on cl.id = e.class_id
      where e.student_id = s.id and cl.campus_id = any($2::uuid[])
    ))
    and ($3::uuid[] is null or exists (
      select 1 from public.enrollments e
      where e.student_id = s.id and e.class_id = any($3::uuid[])
        and e.status in ('active', 'pending_payment')
    ))
),
chapter as (
  select b.* from base b
  where ($5::boolean is null or b.is_active = $5::boolean)
    and ($17::uuid[] is null or b.id = any($17::uuid[]))
    and ($14::text is null or b.name ilike '%' || replace($14::text, '*', '%') || '%' or ($15::boolean and (
      exists (
        select 1 from public.parent_student_relations r
        join public.parents pa on pa.id = r.parent_id
        where r.student_id = b.id and pa.org_id = $1::uuid
          and (pa.name ilike '%' || replace($14::text, '*', '%') || '%'
            or ($16::boolean and exists (
              select 1 from public.ba_user u
              where u.id = pa.user_id and u.phone ilike '%' || $14::text || '%'
            )))
      )
      or exists (
        select 1 from public.schools sc
        where sc.id = b.school_id and sc.org_id = $1::uuid
          and (sc.name ilike '%' || replace($14::text, '*', '%') || '%'
            or sc.short_name ilike '%' || replace($14::text, '*', '%') || '%')
      )
    )))
    and (not $6::boolean or exists (
      select 1 from public.schools sc
      where sc.id = b.school_id and sc.org_id = $1::uuid and sc.level is not null
        and sc.level::text <> case left(b.grade::text, 1)
          when 'P' then 'elementary' when 'J' then 'junior' else 'senior' end
    ))
    and (not ($7::boolean or $8::boolean) or (
      -- 有效卡（今天發的那條再限發卡時間）：沒有有效卡＝不存在、今天發的＝存在；兩個都開＝零筆，同 builder
      with card as (
        select exists (
          select 1 from public.checkin_cards k
          where k.student_id = b.id and k.revoked_at is null
            and (not $8::boolean or (k.issued_at >= $9::timestamptz and k.issued_at < $10::timestamptz))
        ) as has
      )
      select (not $7::boolean or not card.has) and (not $8::boolean or card.has) from card
    ))
),
page as (
  select c.*, row_number() over (order by c.grade desc, c.name, c.id) as rn
  from chapter c
  where $4::text is null or c.grade::text = $4::text
  order by rn
  limit $11::int offset $12::int
)
select json_build_object(
  'rows', coalesce((
    select jsonb_agg((to_jsonb(p) - 'rn') || jsonb_build_object(
      'schools', (
        select jsonb_build_object('id', sc.id, 'name', sc.name, 'short_name', sc.short_name)
        from public.schools sc where sc.id = p.school_id
      ),
      'parent_student_relations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'is_primary', r.is_primary, 'relation', r.relation,
          'parents', (
            select jsonb_build_object('id', pa.id, 'name', pa.name, 'user_id', pa.user_id)
              || case when $13::boolean then jsonb_build_object(
                'phone', (select u.phone from public.ba_user u where u.id = pa.user_id)
              ) else '{}'::jsonb end
            from public.parents pa where pa.id = r.parent_id
          )
        ))
        from public.parent_student_relations r where r.student_id = p.id
      ), '[]'::jsonb),
      'enrollments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'status', e.status,
          'classes', (
            select jsonb_build_object(
              'id', cl.id, 'name', cl.name, 'campus_id', cl.campus_id,
              'campuses', (select jsonb_build_object('name', cp.name) from public.campuses cp where cp.id = cl.campus_id)
            )
            from public.classes cl where cl.id = e.class_id
          )
        ))
        from public.enrollments e where e.student_id = p.id
      ), '[]'::jsonb),
      'active_card', coalesce((
        select jsonb_agg(jsonb_build_object('id', k.id))
        from public.checkin_cards k
        where k.student_id = p.id and k.revoked_at is null
          and (not $8::boolean or (k.issued_at >= $9::timestamptz and k.issued_at < $10::timestamptz))
      ), '[]'::jsonb)
    ) order by p.rn)
    from page p
  ), '[]'::jsonb),
  'total', (select count(*) from chapter c where $4::text is null or c.grade::text = $4::text),
  'activeCount', (select count(*) from base b where b.is_active),
  'byGrade', coalesce((
    select json_object_agg(g.grade, g.n)
    from (select c.grade::text as grade, count(*) as n from chapter c group by c.grade) g
  ), '{}'::json)
) as result
`;

/** `STUDENT_LIST_SQL` 的參數陣列（順序見上面的註解） */
export const studentListArgs = (p: StudentListParams): unknown[] => [
  p.orgId,
  p.campusIds,
  p.classIds,
  p.grade,
  p.isActive,
  p.schoolMismatch,
  p.withoutCard,
  p.cardIssuedToday,
  p.cardDayStart,
  p.cardDayEnd,
  p.limit,
  p.offset,
  p.withPhone,
  p.search,
  p.searchRelated,
  p.searchPhone,
  p.todayIds,
];

/** 反過來：測試替身把 `STUDENT_LIST_SQL` 的參數交給 builder 版用 */
export const studentListParamsFromArgs = (v: readonly unknown[]): StudentListParams => ({
  orgId: v[0] as string,
  campusIds: v[1] as string[] | null,
  classIds: v[2] as string[] | null,
  grade: v[3] as string | null,
  isActive: v[4] as boolean | null,
  schoolMismatch: v[5] as boolean,
  withoutCard: v[6] as boolean,
  cardIssuedToday: v[7] as boolean,
  cardDayStart: v[8] as string,
  cardDayEnd: v[9] as string,
  limit: v[10] as number,
  offset: v[11] as number,
  withPhone: v[12] as boolean,
  search: v[13] as string | null,
  searchRelated: v[14] as boolean,
  searchPhone: v[15] as boolean,
  todayIds: v[16] as string[] | null,
});

const isCount = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 一次往返拿完列表、總數、在籍數、章節計數、本頁主要家長電話。失敗或形狀不對**丟例外**（→ 500） */
export async function loadStudentListViaSql(
  db: Queryable,
  p: StudentListParams,
): Promise<StudentListResult> {
  try {
    const { rows } = await db.query(STUDENT_LIST_SQL, studentListArgs(p));
    const result = (rows[0] as { result?: unknown } | undefined)?.result as
      Record<string, unknown> | undefined;
    const byGrade = result?.['byGrade'] as Record<string, unknown> | undefined;
    const ok =
      rows.length === 1 &&
      result !== undefined &&
      Array.isArray(result['rows']) &&
      (result['rows'] as unknown[]).every(
        (r) => typeof (r as Record<string, unknown>)?.['id'] === 'string',
      ) &&
      isCount(result['total']) &&
      isCount(result['activeCount']) &&
      byGrade !== null &&
      typeof byGrade === 'object' &&
      Object.values(byGrade).every(isCount);
    if (!ok) throw new Error('[students-sql] /api/students 結果形狀不對');
    return result as unknown as StudentListResult;
  } catch (err) {
    console.error(
      `[students-sql] /api/students 查詢失敗：${(err as { code?: string })?.code ?? 'unknown'}`,
    );
    throw err;
  }
}
