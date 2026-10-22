import type { Queryable } from './identity-sql';

/**
 * `GET /api/courses` 改走 SQL（Hyperdrive），一次往返（#1595 P2，計畫席 10-23 裁定 B）。
 *
 * **為什麼**：原本的 query builder 要依序 4 波、12 支 REST（列表 → 班數 → 科目 → **每一科一支 count**），
 * 正式站每支 REST 的成本幾乎全在 PostgREST 那一層（DB 執行 0.07–0.22ms，`e` 23–443ms），
 * 整個請求不碰 REST 時連那次 TLS 也省掉（同 `/api/me`）。
 *
 * **授權不在這裡算**：分校範圍由呼叫端用 `campusFilterIds` 算好當參數傳進來（`lib/campus-scope.ts`
 * 仍是唯一一份判準）。`null`＝不篩、空陣列＝零筆（fail-closed），SQL 用
 * `($n is null or campus_id = any($n))` 保留這個差別。每張表都帶 `org_id = $1`（c1）。
 *
 * **兩組分校 id**（行為照舊，#1595 裁定 3）：課程列表與章節計數吃「範圍 ∩ 指定分校」，
 * 每門課的班數只吃「範圍」，不吃指定分校。
 *
 * **退路**：任何失敗（拋錯、Hyperdrive 超量、結果形狀不對）都回 `null`，呼叫端改走原本的
 * query builder（`routes/courses.ts`）。兩條路的條件各一份，由 `contract/course-list.contract.ts`
 * 在各種分校範圍與篩選下逐欄比對。**絕不用猜的值**：形狀不對時不回 0。
 *
 * 結果整包在 Postgres 裡組成 JSON：時間欄位的格式跟 PostgREST 回的一樣（`pg` 直接回的是 Date 物件）。
 */

export interface CourseListParams {
  readonly orgId: string;
  /** 課程列表與章節計數的分校條件：`campusFilterIds(scope, query.campusId)` */
  readonly courseCampusIds: readonly string[] | null;
  /** 班數的分校條件：`campusFilterIds(scope, undefined)`（只吃範圍） */
  readonly classCampusIds: readonly string[] | null;
  /** 沒有就 null（空字串也算沒有，同 builder 的 `if (query.search)`） */
  readonly search: string | null;
  readonly isActive: boolean | null;
  readonly subjectId: string | null;
  /** 不分頁時 null */
  readonly limit: number | null;
  readonly offset: number;
  /** 台北今天（`YYYY-MM-DD`），判斷「已結束」的班 */
  readonly today: string;
}

export interface CourseListResult {
  /** 跟 builder 的 `select('*, campuses(name), subjects(name, sort_order)')` 同形狀，`mapCourse` 照用 */
  readonly rows: Record<string, unknown>[];
  readonly total: number;
  readonly classCounts: Record<string, { active: number; ended: number }>;
  readonly bySubject: { subjectId: string; subjectName: string; count: number }[];
}

/**
 * `$1` org、`$2` 課程分校、`$3` search、`$4` isActive、`$5` subjectId、`$6` limit（null＝不分頁）、
 * `$7` offset、`$8` 今天、`$9` 班數分校。
 *
 * - search 照 PostgREST 的 `ilike`：`*` 也是萬用字元（`%`／`_` 一樣沒跳脫，行為不變）
 * - 排序照 builder 的四鍵 `subjects.sort_order, subject_id, name, id`；PostgREST 的 embed 排序是
 *   LEFT JOIN、ASC 預設 nulls last，這裡明寫
 * - 科目清單只看 org、不看分校（章名要列出 0 門的科），計數不吃 subjectId（篩了一科時其他科的章名照樣在）
 */
export const COURSE_LIST_SQL = `
with filtered as (
  select c.*, s.sort_order as s_sort, s.id as s_id, s.name as s_name, cp.id as cp_id, cp.name as cp_name
  from public.courses c
  left join public.subjects s on s.id = c.subject_id
  left join public.campuses cp on cp.id = c.campus_id
  where c.org_id = $1::uuid
    and ($2::uuid[] is null or c.campus_id = any($2::uuid[]))
    and ($3::text is null or c.name ilike '%' || replace($3::text, '*', '%') || '%')
    and ($4::boolean is null or c.is_active = $4::boolean)
),
page as (
  select f.*, row_number() over (
    order by f.s_sort asc nulls last, f.subject_id asc nulls last, f.name asc, f.id asc
  ) as rn
  from filtered f
  where $5::uuid is null or f.subject_id = $5::uuid
  order by rn
  limit $6::int offset $7::int
)
select json_build_object(
  'rows', coalesce((
    select json_agg(json_build_object(
      'id', p.id, 'org_id', p.org_id, 'campus_id', p.campus_id, 'name', p.name,
      'description', p.description, 'is_active', p.is_active, 'grade_levels', p.grade_levels,
      'created_at', p.created_at, 'updated_at', p.updated_at, 'subject_id', p.subject_id,
      'campuses', case when p.cp_id is null then null else json_build_object('name', p.cp_name) end,
      'subjects', case when p.s_id is null then null
        else json_build_object('name', p.s_name, 'sort_order', p.s_sort) end
    ) order by p.rn)
    from page p
  ), '[]'::json),
  'total', (
    select count(*) from filtered f where $5::uuid is null or f.subject_id = $5::uuid
  ),
  'classCounts', coalesce((
    select json_object_agg(k.course_id, json_build_object('active', k.active, 'ended', k.ended))
    from (
      select cl.course_id,
        count(*) filter (where cl.end_date is not null and cl.end_date < $8::date) as ended,
        count(*) filter (
          where not (cl.end_date is not null and cl.end_date < $8::date) and cl.is_active
        ) as active
      from public.classes cl
      where cl.org_id = $1::uuid
        and cl.course_id in (select id from page)
        and ($9::uuid[] is null or cl.campus_id = any($9::uuid[]))
      group by cl.course_id
    ) k
  ), '{}'::json),
  'bySubject', coalesce((
    select json_agg(json_build_object(
      'subjectId', sj.id, 'subjectName', sj.name,
      'count', (select count(*) from filtered f where f.subject_id = sj.id)
    ) order by sj.sort_order, sj.id)
    from public.subjects sj
    where sj.org_id = $1::uuid
  ), '[]'::json)
) as result
`;

const isCount = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 一次往返拿完列表、總數、班數、章節計數。失敗或形狀不對回 `null`（呼叫端走 builder） */
export async function loadCourseListViaSql(
  db: Queryable,
  p: CourseListParams,
): Promise<CourseListResult | null> {
  try {
    const { rows } = await db.query(COURSE_LIST_SQL, [
      p.orgId,
      p.courseCampusIds,
      p.search,
      p.isActive,
      p.subjectId,
      p.limit,
      p.offset,
      p.today,
      p.classCampusIds,
    ]);
    const result = (rows[0] as { result?: unknown } | undefined)?.result as
      Record<string, unknown> | undefined;
    const classCounts = result?.['classCounts'] as Record<string, unknown> | undefined;
    const ok =
      rows.length === 1 &&
      result !== undefined &&
      Array.isArray(result['rows']) &&
      (result['rows'] as unknown[]).every(
        (r) => typeof (r as Record<string, unknown>)?.['id'] === 'string',
      ) &&
      isCount(result['total']) &&
      classCounts !== null &&
      typeof classCounts === 'object' &&
      Object.values(classCounts).every((v) => {
        const n = v as Record<string, unknown> | null;
        return n !== null && isCount(n['active']) && isCount(n['ended']);
      }) &&
      Array.isArray(result['bySubject']) &&
      (result['bySubject'] as unknown[]).every((s) => {
        const n = s as Record<string, unknown> | null;
        return n !== null && typeof n['subjectId'] === 'string' && isCount(n['count']);
      });
    if (!ok) {
      console.error('[courses-sql] /api/courses 結果形狀不對，改走 REST');
      return null;
    }
    return result as unknown as CourseListResult;
  } catch (err) {
    console.error(
      `[courses-sql] /api/courses 查詢失敗，改走 REST：${(err as { code?: string })?.code ?? 'unknown'}`,
    );
    return null;
  }
}
