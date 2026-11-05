import type { SupabaseClient } from '@supabase/supabase-js';

import { schoolMismatchClause, type SchoolLevel } from './grade-promotion';
import type { StudentListParams, StudentListResult } from './student-list-sql';

/**
 * `GET /api/students` 的 query builder 版本（#1595 P2 ②）：**參數與回傳跟 `loadStudentListViaSql` 同一份介面**。
 *
 * 只給兩個地方用：沒有 pool 的單元測試，以及 `test-utils/rest-backed-summary-pool.ts` 把 `STUDENT_LIST_SQL`
 * 翻回這條 REST 鏈（既有 spec 的斷言照樣有意義）。正式環境有 pool，一律走 SQL、失敗 500 不退回這裡（#2230 (c)）。
 * 兩份條件由 `contract/student-list-sql.contract.ts` 對真 DB 逐欄比對。
 *
 * 內容是原本寫在 route 裡的那一份，搬過來而已；查詢失敗一律丟例外（→ 500），不吞成 0。
 */

/** 章節順序＝列表順序：高年級在前（A6 名冊，計畫席 10-10 裁） */
export const GRADE_CHAPTERS = [
  'S3',
  'S2',
  'S1',
  'J3',
  'J2',
  'J1',
  'P6',
  'P5',
  'P4',
  'P3',
  'P2',
  'P1',
] as const;

/** 有效到班卡的 embed（#2053）：搭配 `.is('active_card.revoked_at', null)` 只留沒作廢的 */
const ACTIVE_CARD_EMBED = 'active_card:checkin_cards(id)';

/** 列表與年級章節計數共用篩選會用到的 builder 方法（泛型不加約束，同 courses／staff，避 TS2589） */
interface StudentFilterable {
  eq(column: string, value: unknown): StudentFilterable;
  in(column: string, values: string[]): StudentFilterable;
  or(filters: string): StudentFilterable;
  is(column: string, value: unknown): StudentFilterable;
  gte(column: string, value: unknown): StudentFilterable;
  lt(column: string, value: unknown): StudentFilterable;
  not(column: string, op: string, value: unknown): StudentFilterable;
}

const fail = (what: string, error: { message?: string }) => {
  throw new Error(`[students-builder] ${what}失敗：${error.message ?? ''}`);
};

export function buildStudentSearchClause(
  search: string,
  matchedStudentIds: string[],
  searchScope: 'default' | 'student_name' = 'default',
  /** 名稱符合的學校（#1314 SL4）—— 只在 default 範圍併進來 */
  schoolIds: string[] = [],
): string {
  if (searchScope === 'student_name') {
    return `name.ilike.%${search}%`;
  }

  return [
    `name.ilike.%${search}%`,
    ...(matchedStudentIds.length > 0 ? [`id.in.(${matchedStudentIds.join(',')})`] : []),
    ...(schoolIds.length > 0 ? [`school_id.in.(${schoolIds.join(',')})`] : []),
  ].join(',');
}

async function searchClauseOf(
  supabase: SupabaseClient,
  p: StudentListParams,
  search: string,
): Promise<string> {
  if (!p.searchRelated) return buildStudentSearchClause(search, [], 'student_name');

  const { data: relationRows, error: relationError } = await supabase
    .from('parent_student_relations')
    .select('student_id, parents!inner(name)')
    .ilike('parents.name', `%${search}%`);
  if (relationError) fail('家長姓名搜尋', relationError);

  let phoneRows: Array<{ student_id: string | null }> = [];
  // 家長電話（#1138 全站搜尋）：3 碼以上純數字才比。電話住在 `ba_user.phone`
  // （20260317000003 把 parents.phone 移走了），寫法照 /api/parents 的搜尋。
  // ponytail: 照輸入的字串連續比對；電話若存成帶 `-` 的格式，跨 `-` 的片段比不到 —— 真有這種資料再正規化
  if (p.searchPhone) {
    const { data: users, error: userError } = await supabase
      .from('ba_user')
      .select('id')
      .ilike('phone', `%${search}%`);
    if (userError) fail('家長電話搜尋', userError);
    const userIds = (users ?? []).map((u: { id: string }) => u.id);
    if (userIds.length > 0) {
      // ba_user 不分機構，所以這裡一定要限本機構的家長
      const { data, error: phoneError } = await supabase
        .from('parent_student_relations')
        .select('student_id, parents!inner(user_id, org_id)')
        .eq('parents.org_id', p.orgId)
        .in('parents.user_id', userIds);
      if (phoneError) fail('家長電話搜尋', phoneError);
      phoneRows = (data ?? []) as Array<{ student_id: string | null }>;
    }
  }

  // 學校名（#1314 SL4）：本 org 的學校，全名或簡稱
  const { data: schoolRows, error: schoolError } = await supabase
    .from('schools')
    .select('id')
    .eq('org_id', p.orgId)
    .or(`name.ilike.%${search}%,short_name.ilike.%${search}%`);
  if (schoolError) fail('學校名搜尋', schoolError);

  const matched = Array.from(
    new Set(
      [...((relationRows ?? []) as Array<{ student_id: string | null }>), ...phoneRows]
        .map((row) => row.student_id)
        .filter((id): id is string => !!id),
    ),
  );
  return buildStudentSearchClause(
    search,
    matched,
    'default',
    ((schoolRows ?? []) as Array<{ id: string }>).map((row) => row.id),
  );
}

export async function loadStudentListViaBuilder(
  supabase: SupabaseClient,
  p: StudentListParams,
): Promise<StudentListResult> {
  const { orgId, campusIds, classIds } = p;
  /**
   * 範圍（#1928）：條件放進 embed 的 `!inner` 在 DB 端篩，**不先撈範圍內學生 id 再 `.in('id', …)`**
   * （兩三百位就 414，整頁 500）。分校＝任一筆報名的班在範圍內（不分狀態）；老師＝在他任課班有
   * 在籍（active／pending_payment）的報名 —— 同一個 alias 上的兩個條件落在同一筆報名，同原本。
   * 列表、在籍數、章節計數**共用同一份**（#815：算兩次就會分岔一次）
   */
  const scopeEmbed =
    (campusIds ? ', scope_campus:enrollments!inner(classes!inner(campus_id))' : '') +
    (classIds ? ', scope_taught:enrollments!inner(class_id, status)' : '');

  const searchClause = p.search ? await searchClauseOf(supabase, p, p.search) : null;

  // 學制跟年級不合（#1820）：`null` 子句＝這個機構沒有任何組合會不合 → 空結果，不是不篩
  let mismatchClause: string | null = null;
  if (p.schoolMismatch) {
    const { data: schoolRows, error: schoolError } = await supabase
      .from('schools')
      .select('id, level')
      .eq('org_id', orgId);
    if (schoolError) fail('學制不合', schoolError);
    mismatchClause = schoolMismatchClause(
      (schoolRows ?? []) as Array<{ id: string; level: SchoolLevel | null }>,
    );
  }

  // 列表與年級章節計數共用（#1314 SL3）—— 兩邊各寫一份就會對同一份名單給出兩個數字。
  // grade 不在裡面：章節要列出其他年級。兩個 `in('id')` 在 PostgREST 是 AND（交集）
  const withChapterFilters = <Q>(q: Q): Q => {
    let next = q as unknown as StudentFilterable;
    if (classIds) {
      next = next
        .in('scope_taught.class_id', [...classIds])
        .in('scope_taught.status', ['active', 'pending_payment']);
    }
    if (searchClause) next = next.or(searchClause);
    if (campusIds) next = next.in('scope_campus.classes.campus_id', [...campusIds]);
    if (p.isActive !== null) next = next.eq('is_active', p.isActive);
    if (p.todayIds) next = next.in('id', [...p.todayIds]);
    if (p.schoolMismatch) {
      // 兩個 `or` 在 PostgREST 是 AND（同上面兩個 `in('id')`），不會吃掉搜尋子句
      next = mismatchClause
        ? next.or(mismatchClause)
        : next.in('id', ['00000000-0000-0000-0000-000000000000']);
    }
    return next as unknown as Q;
  };
  /**
   * 卡片條件（#2053、#2267），列表與年級章節的 HEAD count **共用這一份**。`active_card` embed 已經只留
   * 沒作廢的卡；「今天發的」再把 embed 限在台北今天發的、並要求 embed 非空（不是 `!inner`：每列的
   * `hasActiveCard` 也靠這個 embed，其餘篩選下不能把沒卡的人濾掉）
   */
  const withCardFilter = <Q>(q: Q): Q => {
    let next = q as unknown as StudentFilterable;
    if (p.withoutCard) next = next.is('active_card', null);
    if (p.cardIssuedToday) {
      next = next
        .gte('active_card.issued_at', p.cardDayStart)
        .lt('active_card.issued_at', p.cardDayEnd)
        .not('active_card', 'is', null);
    }
    return next as unknown as Q;
  };

  let query = supabase
    .from('students')
    .select(
      `*, schools(id, name, short_name), parent_student_relations(is_primary, relation, parents(id, name, user_id)), enrollments(id, status, classes(id, name, campus_id, campuses(name))), ${ACTIVE_CARD_EMBED}${scopeEmbed}`,
      { count: 'exact' },
    )
    .eq('org_id', orgId)
    // embed 只留有效卡 —— 每列的 `hasActiveCard` 與「沒有有效卡」的反連接都靠它
    .is('active_card.revoked_at', null)
    // 依年級分章：`grade` 是 enum `grade_level`，Postgres 依列舉序排（P1…S3）。**高年級在前**（desc，照 A6）。
    // 章內依姓名，末鍵 id 讓同名翻頁穩定。`grade` 是 NOT NULL，所以不寫 nulls 位置
    .order('grade', { ascending: false })
    .order('name')
    .order('id');
  if (p.grade) query = query.eq('grade', p.grade);
  query = withCardFilter(withChapterFilters(query)).range(p.offset, p.offset + p.limit - 1);

  // 在籍數：**「全量」只指「不受 `isActive` filter 影響」** —— 範圍照樣要套（#815）
  let activeCountQuery = supabase
    .from('students')
    .select(`id${scopeEmbed}`, { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('is_active', true);
  if (classIds) {
    activeCountQuery = activeCountQuery
      .in('scope_taught.class_id', [...classIds])
      .in('scope_taught.status', ['active', 'pending_payment']);
  }
  if (campusIds) {
    activeCountQuery = activeCountQuery.in('scope_campus.classes.campus_id', [...campusIds]);
  }

  // 章節計數：PostgREST 聚合（#1595 P3b-B）；聚合不吃 embed 的過濾（卡片）、範圍在 embed 上時
  // 會連 embed 一起 group by —— 這兩種改成每級一支 head count（預算由 students-subrequest-budget.spec 守）
  const gradeCountQuery =
    p.withoutCard || p.cardIssuedToday || scopeEmbed
      ? Promise.all(
          GRADE_CHAPTERS.map((level) => {
            const head = supabase
              .from('students')
              .select(`id, ${ACTIVE_CARD_EMBED}${scopeEmbed}`, { count: 'exact', head: true })
              .eq('org_id', orgId)
              .eq('grade', level)
              .is('active_card.revoked_at', null);
            return withCardFilter(withChapterFilters(head));
          }),
        ).then((results) => ({
          error: results.find((r) => r.error)?.error ?? null,
          data: results.map((r, i) => ({ grade: GRADE_CHAPTERS[i]!, count: r.count ?? 0 })),
        }))
      : withChapterFilters(supabase.from('students').select('grade, count()').eq('org_id', orgId));

  const [list, active, gradeCounts] = await Promise.all([query, activeCountQuery, gradeCountQuery]);
  if (list.error) fail('學生列表', list.error);
  if (active.error) fail('在籍數', active.error);
  // 數不出來就不回 0
  if (gradeCounts.error) fail('年級章節計數', gradeCounts.error);

  const rows = (list.data ?? []) as unknown as Array<Record<string, unknown>>;

  // 家長電話（只有管理員，計畫席裁 #1138 Q-b A）：查本頁每位學生的**主要**家長（is_primary 優先，同 route 的 relationsOf），
  // 跟 SQL 一樣帶在 `parents.phone`。回新物件，不改查回來的列。ba_user 唯讀（c2 只禁寫）
  type Rel = {
    is_primary: boolean;
    parents: { name?: string; user_id: string | null } | null;
  };
  const relsOf = (row: Record<string, unknown>) =>
    (row['parent_student_relations'] as Rel[] | null) ?? [];
  const phoneByUser = new Map<string, string | null>();
  if (p.withPhone) {
    const userIds = [
      ...new Set(
        rows
          .map(
            (row) =>
              relsOf(row)
                .filter((r) => r.parents?.name)
                .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))[0]?.parents
                ?.user_id,
          )
          .filter((id): id is string => !!id),
      ),
    ];
    if (userIds.length > 0) {
      const { data: users, error } = await supabase
        .from('ba_user')
        .select('id, phone')
        .in('id', userIds);
      if (error) fail('家長電話', error);
      for (const u of users ?? []) phoneByUser.set(u.id as string, (u.phone as string) ?? null);
    }
  }
  const withPhones = p.withPhone
    ? rows.map((row) => ({
        ...row,
        parent_student_relations: relsOf(row).map((r) => ({
          ...r,
          parents: r.parents && {
            ...r.parents,
            phone: (r.parents.user_id && phoneByUser.get(r.parents.user_id)) || null,
          },
        })),
      }))
    : rows;

  return {
    rows: withPhones,
    total: list.count ?? 0,
    activeCount: active.count ?? 0,
    byGrade: Object.fromEntries(
      ((gradeCounts.data ?? []) as Array<{ grade: string | null; count: number }>)
        .filter((r) => r.grade)
        .map((r) => [r.grade, r.count ?? 0]),
    ),
  };
}
