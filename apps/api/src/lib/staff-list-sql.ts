import type { Queryable } from './identity-sql';

/**
 * `GET /api/staff` 改走 SQL（Hyperdrive），一次往返（#1595 P2 第二刀，模式同 `course-list-sql.ts`）。
 *
 * **為什麼**：原本的 query builder 最壞要 5 波、16 支 REST：
 * 篩選 4 → 主查詢＋摘要 2 → 關聯 4＋摘要角色 1 → 角色名單分頁 ≥1 → 章節 head count 4。
 *
 * **授權不在這裡算**：分校範圍由呼叫端用 `campusFilterIds` 算好當參數傳進來（`lib/campus-scope.ts`
 * 仍是唯一一份判準）。`null`＝不篩、空陣列＝零筆（fail-closed）。`staff` 都帶 `org_id = $1`（c1）；
 * `user_roles`／`ba_user` 沒有 org 欄，一律經由本 org 的 staff 列才碰得到。
 *
 * **只回原料、不在 SQL 裡算摘要**：列、各關聯、摘要用的列與角色都照 builder 拿到的形狀回，
 * 呼叫端用同一組 `toCampusMap`／`mapStaff`／`buildStaffSummary` 組回應 —— 計數規則只有 TS 一份。
 *
 * **退路**：任何失敗（拋錯、Hyperdrive 超量、結果形狀不對）都回 `null`，呼叫端走原本的 builder。
 * 兩條路的條件各一份，由 `contract/staff-list.contract.ts` 在各種範圍與篩選下逐欄比對。
 */

export interface StaffListParams {
  readonly orgId: string;
  /** `campusFilterIds(scope, query.campusId)` */
  readonly campusIds: readonly string[] | null;
  /** 沒有就 null（空字串也算沒有，同 builder 的 `if (query.search)`） */
  readonly search: string | null;
  readonly role: string | null;
  readonly subjectId: string | null;
  /** 只套在列表，不套在摘要（同 builder） */
  readonly status: string | null;
  /** 不分頁時 null */
  readonly limit: number | null;
  readonly offset: number;
}

export interface StaffListSqlResult {
  /** 分校／角色／科目篩選本身就沒有任何人 —— builder 在這裡提早回（meta 跟一般空結果不同） */
  readonly emptyByFilter: boolean;
  /** 同 builder 的 `select('*')` */
  readonly rows: Record<string, unknown>[];
  readonly total: number;
  readonly campusRows: Array<{ staff_id: string; campus_id: string }>;
  readonly subjectRows: Array<{
    staff_id: string;
    subject_id: string;
    subjects: { name: string } | null;
  }>;
  readonly roleRows: Array<{ user_id: string; role: string; permissions: unknown }>;
  readonly baUserRows: Array<{
    id: string;
    email: string | null;
    phone: string | null;
    emailVerified: boolean | null;
  }>;
  /** 摘要用（不套 status） */
  readonly summaryRows: Array<{ user_id: string; status: string }>;
  readonly summaryRoleRows: Array<{ user_id: string; role: string; permissions: unknown }>;
}

/**
 * `$1` org、`$2` 分校、`$3` search、`$4` role、`$5` subjectId、`$6` status、`$7` limit（null＝不分頁）、`$8` offset。
 *
 * - search 照 PostgREST 的 `ilike`：`*` 也是萬用字元；`ba_user` 比 email／phone（同 builder 的兩段查詢）
 * - 分校篩選照 builder 的 `staff_campuses … campuses!inner`：分校列要存在
 * - 排序 `created_at desc, id`：builder 同步補上 `id` 當末鍵，同時間建立的人才有固定順序
 * - 各關聯照 id／角色排序（builder 同步補上 `.order()`），陣列順序兩條路才一樣
 */
export const STAFF_LIST_SQL = `
with base as (
  select s.* from public.staff s
  where s.org_id = $1::uuid
    and ($2::uuid[] is null or s.id in (
      select sc.staff_id from public.staff_campuses sc
      join public.campuses cp on cp.id = sc.campus_id
      where sc.campus_id = any($2::uuid[])))
    and ($4::text is null or s.user_id in (select ur.user_id from public.user_roles ur where ur.role::text = $4::text))
    and ($5::uuid is null or s.id in (select ss.staff_id from public.staff_subjects ss where ss.subject_id = $5::uuid))
    and ($3::text is null
      or s.display_name ilike '%' || replace($3::text, '*', '%') || '%'
      or s.user_id in (
        select u.id from public.ba_user u
        where u.email ilike '%' || replace($3::text, '*', '%') || '%'
           or u.phone ilike '%' || replace($3::text, '*', '%') || '%'))
),
listed as (
  select b.* from base b where $6::text is null or b.status::text = $6::text
),
page as (
  select l.* from listed l
  order by l.created_at desc, l.id
  limit $7::int offset $8::int
)
select json_build_object(
  'emptyByFilter',
    ($2::uuid[] is not null and not exists (
      select 1 from public.staff_campuses sc join public.campuses cp on cp.id = sc.campus_id
      where sc.campus_id = any($2::uuid[])))
    or ($4::text is not null and not exists (
      select 1 from public.user_roles ur where ur.role::text = $4::text))
    or ($5::uuid is not null and not exists (
      select 1 from public.staff_subjects ss where ss.subject_id = $5::uuid)),
  'rows', coalesce((
    select json_agg(to_jsonb(p) order by p.created_at desc, p.id) from page p
  ), '[]'::json),
  'total', (select count(*) from listed),
  'campusRows', coalesce((
    select json_agg(json_build_object('staff_id', sc.staff_id, 'campus_id', sc.campus_id)
      order by sc.staff_id, sc.campus_id)
    from public.staff_campuses sc join public.campuses cp on cp.id = sc.campus_id
    where sc.staff_id in (select id from page)
  ), '[]'::json),
  'subjectRows', coalesce((
    select json_agg(json_build_object(
      'staff_id', ss.staff_id, 'subject_id', ss.subject_id,
      'subjects', case when sj.id is null then null else json_build_object('name', sj.name) end
    ) order by ss.staff_id, ss.subject_id)
    from public.staff_subjects ss left join public.subjects sj on sj.id = ss.subject_id
    where ss.staff_id in (select id from page)
  ), '[]'::json),
  'roleRows', coalesce((
    select json_agg(json_build_object('user_id', ur.user_id, 'role', ur.role, 'permissions', ur.permissions)
      order by ur.user_id, ur.role)
    from public.user_roles ur where ur.user_id in (select user_id from page)
  ), '[]'::json),
  'baUserRows', coalesce((
    select json_agg(json_build_object('id', u.id, 'email', u.email, 'phone', u.phone,
      'emailVerified', u."emailVerified") order by u.id)
    from public.ba_user u where u.id in (select user_id from page)
  ), '[]'::json),
  'summaryRows', coalesce((
    select json_agg(json_build_object('user_id', b.user_id, 'status', b.status)) from base b
  ), '[]'::json),
  'summaryRoleRows', coalesce((
    select json_agg(json_build_object('user_id', ur.user_id, 'role', ur.role, 'permissions', ur.permissions)
      order by ur.user_id, ur.role)
    from public.user_roles ur where ur.user_id in (select user_id from base)
  ), '[]'::json)
) as result
`;

const isCount = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isArrayOf = (v: unknown, key: string) =>
  Array.isArray(v) &&
  v.every((r) => typeof (r as Record<string, unknown> | null)?.[key] === 'string');

/** 一次往返拿完。失敗或形狀不對回 `null`（呼叫端走 builder），**絕不用猜的值** */
export async function loadStaffListViaSql(
  db: Queryable,
  p: StaffListParams,
): Promise<StaffListSqlResult | null> {
  try {
    const { rows } = await db.query(STAFF_LIST_SQL, [
      p.orgId,
      p.campusIds,
      p.search,
      p.role,
      p.subjectId,
      p.status,
      p.limit,
      p.offset,
    ]);
    const r = (rows[0] as { result?: unknown } | undefined)?.result as
      Record<string, unknown> | undefined;
    const ok =
      rows.length === 1 &&
      r !== undefined &&
      typeof r['emptyByFilter'] === 'boolean' &&
      isArrayOf(r['rows'], 'id') &&
      isCount(r['total']) &&
      isArrayOf(r['campusRows'], 'staff_id') &&
      isArrayOf(r['subjectRows'], 'staff_id') &&
      isArrayOf(r['roleRows'], 'user_id') &&
      isArrayOf(r['baUserRows'], 'id') &&
      isArrayOf(r['summaryRows'], 'user_id') &&
      isArrayOf(r['summaryRoleRows'], 'user_id');
    if (!ok) {
      console.error('[staff-sql] /api/staff 結果形狀不對，改走 REST');
      return null;
    }
    return r as unknown as StaffListSqlResult;
  } catch (err) {
    console.error(
      `[staff-sql] /api/staff 查詢失敗，改走 REST：${(err as { code?: string })?.code ?? 'unknown'}`,
    );
    return null;
  }
}
