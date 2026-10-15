/**
 * 身分三查改走 SQL（Hyperdrive），一次往返（#1595 Hyperdrive A）。
 *
 * **為什麼**：pg_stat_statements 量到這三支在 DB 的執行時間平均只有 0.07–0.22ms，但正式站
 * 經 PostgREST 時，Supabase 回報的時間（`x-envoy-upstream-service-time`）是 63–443ms
 * —— 99% 以上花在 PostgREST 那一層。Hyperdrive 直接連 Postgres，把那一層整個繞過；
 * 三支合成一條 statement，是因為 `pg` 同一條連線上的查詢會排隊（平行 3 支＝3 支的總和）。
 *
 * **c12**：只用 `resolveDatabaseUrl` 給的標準連線字串（共用 Better Auth 這個請求的 pg Pool）。
 * 沒有 Hyperdrive binding 時就是 `DATABASE_URL`：本機 `wrangler dev`、自架的 `server.ts` 都走這條。
 *
 * **退路**：任何失敗（拋錯、Hyperdrive 超過免費額度、結果形狀不對）都回 `null`，
 * 呼叫端改走原本的 supabase-js 三查。**絕不用猜的值**：形狀不對時不能當成「沒有角色」
 * （會擋掉該進的人），也不能當成「已停用」（同上），更不能當成放行。
 *
 * 回傳的形狀跟 REST 那條（`middleware/auth.ts` 的 `loadIdentity`）一模一樣，下游的
 * campusScope／studentScope／assignedCampusIds 都從這份列推出來，所以兩條路算出同一份。
 */

export interface IdentityRows {
  roleRows: { role: string; permissions?: unknown }[];
  staffRows: unknown[];
  parentRows: unknown[];
}

/** 給 `pg` 用的最小介面（Better Auth 的 Pool、測試替身都符合） */
export interface Queryable {
  query(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * `$1` = user id（text，= ba_user.id），`$2` = org id（session 的 ba_user.orgId）。
 * - `staff`／`parents` 過濾 `org_id`（c1；唯一鍵是 (user_id, org_id)，#1603）。
 * - `user_roles` **沒有 org_id 欄位**：它的 org 由 ba_user.orgId 決定，一個 user 只屬於一個 org。
 * - 欄位與巢狀形狀照 REST 那三支的 select（`status, display_name, birthday, staff_campuses(campus_id)`、
 *   `status, name, parent_student_relations(student_id)`、`role, permissions`）。
 */
export const IDENTITY_SQL = `
select
  coalesce((
    select json_agg(json_build_object('role', r.role, 'permissions', r.permissions))
    from public.user_roles r
    where r.user_id = $1
  ), '[]'::json) as roles,
  coalesce((
    select json_agg(json_build_object(
      'status', s.status, 'display_name', s.display_name, 'birthday', s.birthday,
      'staff_campuses', coalesce((
        select json_agg(json_build_object('campus_id', sc.campus_id))
        from public.staff_campuses sc where sc.staff_id = s.id
      ), '[]'::json)))
    from public.staff s
    where s.user_id = $1 and s.org_id = $2::uuid
  ), '[]'::json) as staff,
  coalesce((
    select json_agg(json_build_object(
      'status', p.status, 'name', p.name,
      'parent_student_relations', coalesce((
        select json_agg(json_build_object('student_id', psr.student_id))
        from public.parent_student_relations psr where psr.parent_id = p.id
      ), '[]'::json)))
    from public.parents p
    where p.user_id = $1 and p.org_id = $2::uuid
  ), '[]'::json) as parents
`;

/** 驗形狀時會讀到的鍵（值一律 unknown，逐一檢查） */
type Loose = Partial<
  Record<
    | 'roles'
    | 'staff'
    | 'parents'
    | 'role'
    | 'permissions'
    | 'status'
    | 'display_name'
    | 'birthday'
    | 'staff_campuses'
    | 'name'
    | 'parent_student_relations'
    | 'campus_id'
    | 'student_id',
    unknown
  >
>;

const isObj = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';
const listOf = (v: unknown, item: (x: unknown) => boolean) => Array.isArray(v) && v.every(item);

/** SQL 回來的那一列 → IdentityRows；**任何一處形狀不對就回 null**（走 REST，不猜） */
export function parseIdentityRow(rows: unknown[]): IdentityRows | null {
  if (rows.length !== 1 || !isObj(rows[0])) return null;
  const { roles, staff, parents } = rows[0];

  const roleOk = (r: unknown) =>
    isObj(r) &&
    typeof r.role === 'string' &&
    (r.permissions === null || Array.isArray(r.permissions));
  const staffOk = (s: unknown) =>
    isObj(s) &&
    typeof s.status === 'string' &&
    isStrOrNull(s.display_name) &&
    isStrOrNull(s.birthday) &&
    listOf(s.staff_campuses, (x) => isObj(x) && typeof x.campus_id === 'string');
  const parentOk = (p: unknown) =>
    isObj(p) &&
    typeof p.status === 'string' &&
    isStrOrNull(p.name) &&
    listOf(p.parent_student_relations, (x) => isObj(x) && typeof x.student_id === 'string');

  if (!listOf(roles, roleOk) || !listOf(staff, staffOk) || !listOf(parents, parentOk)) return null;
  return {
    roleRows: roles as IdentityRows['roleRows'],
    staffRows: staff as unknown[],
    parentRows: parents as unknown[],
  };
}

/** 一次往返查完身分；失敗或形狀不對回 null（呼叫端走 REST）。log 只印原因，不印參數 */
export async function loadIdentityViaSql(
  db: Queryable,
  userId: string,
  orgId: string,
): Promise<IdentityRows | null> {
  try {
    const parsed = parseIdentityRow((await db.query(IDENTITY_SQL, [userId, orgId])).rows);
    if (!parsed) console.error('[identity-sql] 結果形狀不對，改走 REST');
    return parsed;
  } catch (err) {
    // 只印錯誤碼：pg 的錯誤訊息有時會帶出參數值（例如 uuid 格式錯誤時印出那個值）
    console.error(
      `[identity-sql] 查詢失敗，改走 REST：${(err as { code?: string })?.code ?? 'unknown'}`,
    );
    return null;
  }
}

/** `/api/me` 另外要的兩張表：`profiles` 的顯示名稱（舊來源，見 lib/display-name.ts）、`ba_user` 的聯絡資料 */
export interface MeExtras {
  profile: { display_name: string | null } | null;
  baUser: { name: string | null; email: string | null; phone: string | null } | null;
}

/**
 * `ba_user` 只讀不寫（c2）。`$1` user id、`$2` org id。
 * `profiles` **只用 id 查、不過濾 org_id**：它的 org_id 是 Supabase Auth 時代的舊欄位，只有 seed 會寫、
 * 刻意不被信任（`org-source.spec.ts` 守）；`profiles.id` 就是 `ba_user.id`，一個 user 只屬於一個 org。
 * `$2` 沒用到但保留，讓兩支 SQL 的參數形狀一致。
 */
export const ME_EXTRAS_SQL = `
select
  (select pr.display_name from public.profiles pr where pr.id = $1) as profile_display_name,
  (select count(*) from public.profiles pr where pr.id = $1)::int as profile_rows,
  u.name, u.email, u.phone
from public.ba_user u
where u.id = $1 and $2::text is not null
`;

/** 一次往返；失敗或形狀不對回 null（呼叫端走 REST） */
export async function loadMeExtrasViaSql(
  db: Queryable,
  userId: string,
  orgId: string,
): Promise<MeExtras | null> {
  try {
    const { rows } = await db.query(ME_EXTRAS_SQL, [userId, orgId]);
    const row = rows[0] as Record<string, unknown> | undefined;
    const ok =
      rows.length === 1 &&
      row !== undefined &&
      ['profile_display_name', 'name', 'email', 'phone'].every(
        (k) => row[k] === null || typeof row[k] === 'string',
      ) &&
      (row['profile_rows'] === 0 || row['profile_rows'] === 1);
    if (!ok) {
      console.error('[identity-sql] /api/me 結果形狀不對，改走 REST');
      return null;
    }
    return {
      profile:
        row['profile_rows'] === 1
          ? { display_name: row['profile_display_name'] as string | null }
          : null,
      baUser: {
        name: row['name'] as string | null,
        email: row['email'] as string | null,
        phone: row['phone'] as string | null,
      },
    };
  } catch (err) {
    console.error(
      `[identity-sql] /api/me 查詢失敗，改走 REST：${(err as { code?: string })?.code ?? 'unknown'}`,
    );
    return null;
  }
}
