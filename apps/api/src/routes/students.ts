import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import { resolveStudentScope } from './students/teacher-scope';
import { outOfCampusScope, teacherCannotRead } from './students/read-scope';
import { taughtClassIds, taughtStudentIds } from '../lib/teacher-scope';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { DbUuidSchema } from '../lib/validation';
import { campusFilterIds, getCampusScope } from '../lib/campus-scope';
import { resolveAttendanceMode } from '../lib/attendance-mode';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import {
  TODAY_SESSION_SELECT,
  classifyToday,
  loadDailyAttendance,
  toTodaySession,
  type TodayStatus,
} from '../lib/today-attendance';
import attendanceDaysRoute from './students/attendance-days';

// ============================================================
// Schemas
// ============================================================

const GradeLevelSchema = z
  .enum(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J2', 'J3', 'S1', 'S2', 'S3'])
  .openapi('GradeLevel');

const StudentGenderSchema = z
  .enum(['male', 'female', 'prefer_not_to_say'])
  .openapi('StudentGender');

const StudentSchoolSchema = z
  .object({
    id: DbUuidSchema,
    name: z.string(),
    shortName: z.string().nullable(),
  })
  .openapi('StudentSchool');

const StudentSchema = z
  .object({
    id: DbUuidSchema,
    orgId: DbUuidSchema,
    name: z.string(),
    grade: GradeLevelSchema,
    school: StudentSchoolSchema.nullable(),
    birthday: z.string().nullable(),
    gender: StudentGenderSchema.nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    emergencyContactName: z.string().nullable(),
    emergencyContactPhone: z.string().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),
    parentNames: z.array(z.string()),
    /**
     * 主要家長（`parentNames[0]` 那位）的電話，全站搜尋結果的第二行用（#1138）。
     * **只有列表回這欄、只有管理員有值**；老師一律 null —— 家長電話不進老師的學生名單。
     */
    primaryParentPhone: z.string().nullable().optional(),
    /** 列表才有（#1314 SL2）：見 `deriveEnrollmentState` */
    enrollmentState: z
      .enum(['pending_payment', 'active', 'suspended', 'withdrawal'])
      .nullable()
      .optional(),
    /**
     * 今日到班（#1314 SL1）：**只有列表、而且有算的時候才有這欄**（帶 `today` 或第一頁）。
     * null = 今天沒有他的課。判準見 `lib/today-attendance.ts`
     */
    todayStatus: z
      .object({
        state: z.enum(['arrived', 'on_leave', 'missing', 'not_yet']),
        dueAt: z.string().nullable(),
        arrivedAt: z.string().nullable(),
      })
      .nullable()
      .optional(),
    campusNames: z.array(z.string()),
    /** 在籍班級（老師端用來分組；管理端目前不顯示） */
    classNames: z.array(z.string()),
    hasEnrollments: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Student');

const StudentDetailParentSchema = z
  .object({
    id: DbUuidSchema,
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    relation: z.string().nullable(),
    isPrimary: z.boolean(),
  })
  .openapi('StudentDetailParent');

const StudentDetailSchema = StudentSchema.extend({
  parents: z.array(StudentDetailParentSchema),
}).openapi('StudentDetail');

const StudentListResponseSchema = z
  .object({
    data: z.array(StudentSchema),
    summary: z.object({
      total: z.number(),
      activeCount: z.number(),
      /**
       * 依年級分章的章節計數（#1314 SL3）：**高年級在前**（S3→P1，同列表排序，照 A6）、每級都有（0 也回）。
       * 吃列表同一組篩選（search／分校／老師範圍／isActive），**不吃 grade** —— 篩了一級時其他章名照樣在
       */
      byGrade: z.array(z.object({ grade: GradeLevelSchema, count: z.number() })),
      /**
       * 今日到班各狀態人數（#1314 SL1）：只套分校範圍（與老師範圍），不套其他篩選 ——
       * A6 篩選鈕上的數字是「今天全體」。沒算（非第一頁且沒帶 today、或 `withToday=false`）
       * 或逐堂點名模式（v1 不支援）→ null
       */
      today: z
        .object({
          any: z.number(),
          arrived: z.number(),
          not_yet: z.number(),
          missing: z.number(),
          on_leave: z.number(),
        })
        .nullable()
        .optional(),
    }),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('StudentListResponse');

const UpdateStudentSchema = z
  .object({
    name: z.string().min(1).optional(),
    grade: GradeLevelSchema.optional(),
    schoolId: DbUuidSchema.nullable().optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD')
      .nullable()
      .optional(),
    gender: StudentGenderSchema.nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    address: z.string().nullable().optional(),
    emergencyContactName: z.string().nullable().optional(),
    emergencyContactPhone: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .openapi('UpdateStudent');

const CreateStudentSchema = z
  .object({
    name: z.string().min(1),
    grade: GradeLevelSchema,
    schoolId: DbUuidSchema.nullable().optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD')
      .nullable()
      .optional(),
    gender: StudentGenderSchema.nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    address: z.string().nullable().optional(),
    emergencyContactName: z.string().nullable().optional(),
    emergencyContactPhone: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    parentId: z.string().uuid().optional(),
  })
  .openapi('CreateStudent');

// ============================================================
// Helpers (exported for unit testing)
// ============================================================

export function buildStudentSummary(
  rows: Array<{ is_active: boolean }>,
  total: number,
): { total: number; activeCount: number } {
  return {
    total,
    activeCount: rows.filter((r) => r.is_active).length,
  };
}

export function toStudentResponse(
  row: Record<string, unknown>,
  parentNames: string[] = [],
  campusNames: string[] = [],
  hasEnrollments: boolean = false,
  classNames: string[] = [],
) {
  const school = row['schools'] as
    { id: string; name: string; short_name: string | null } | null | undefined;

  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    name: row['name'] as string,
    grade: row['grade'] as string,
    school: school
      ? {
          id: school.id,
          name: school.name,
          shortName: school.short_name,
        }
      : null,
    birthday: (row['birthday'] as string | null) ?? null,
    gender: (row['gender'] as string | null) ?? null,
    phone: (row['phone'] as string | null) ?? null,
    email: (row['email'] as string | null) ?? null,
    address: (row['address'] as string | null) ?? null,
    emergencyContactName: (row['emergency_contact_name'] as string | null) ?? null,
    emergencyContactPhone: (row['emergency_contact_phone'] as string | null) ?? null,
    notes: (row['notes'] as string | null) ?? null,
    isActive: row['is_active'] as boolean,
    parentNames,
    campusNames,
    classNames,
    hasEnrollments,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

/**
 * 名冊上的報名狀態旗標（#1314 SL2），照 A6 `students.html` 的 `stateOf`：
 * 任一待繳費 → 待繳費；否則有在籍 → 在籍；否則有暫停 → 暫停；否則（只剩退班）→ 退班。
 * `void`（作廢的報名）不算數；一筆都沒有 → null。
 */
export function deriveEnrollmentState(
  statuses: readonly (string | undefined)[],
): 'pending_payment' | 'active' | 'suspended' | 'withdrawal' | null {
  const counted = statuses.filter((status) => status && status !== 'void');
  if (counted.length === 0) return null;
  for (const state of ['pending_payment', 'active', 'suspended'] as const) {
    if (counted.includes(state)) return state;
  }
  return 'withdrawal';
}

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

/** 列表與年級章節計數共用篩選會用到的 builder 方法（泛型不加約束，同 courses／staff，避 TS2589） */
interface StudentFilterable {
  eq(column: string, value: unknown): StudentFilterable;
  in(column: string, values: string[]): StudentFilterable;
  or(filters: string): StudentFilterable;
}

const GRADE_LEVELS = GradeLevelSchema.options;
/** 章節順序＝列表順序：高年級在前（A6 名冊，計畫席 10-10 裁） */
const GRADE_CHAPTERS = [...GRADE_LEVELS].reverse();

function countToday(statuses: Map<string, TodayStatus>) {
  const counts = { any: statuses.size, arrived: 0, not_yet: 0, missing: 0, on_leave: 0 };
  for (const { state } of statuses.values()) counts[state] += 1;
  return counts;
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/students
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Students'],
    summary: '取得學生列表',
    request: {
      query: z.object({
        search: z.string().optional(),
        searchScope: z.enum(['default', 'student_name']).default('default').optional(),
        grade: GradeLevelSchema.optional(),
        campusId: DbUuidSchema.optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
        isActive: z.coerce.boolean().optional(),
        // 意圖提示而已：老師的範圍由角色決定（見 students/teacher-scope.ts）
        taughtByMe: z.coerce.boolean().optional(),
        /** 今日到班篩選（#1314 SL1）。逐堂點名模式的分校 → 400 `TODAY_UNSUPPORTED_MODE` */
        today: z.enum(['any', 'arrived', 'not_yet', 'missing', 'on_leave']).optional(),
        /** `false` = 不算今日到班（儀表板只要總數的呼叫用）。預設第一頁才算 */
        withToday: z.enum(['true', 'false']).optional(),
      }),
    },
    responses: {
      200: {
        description: '學生列表',
        content: { 'application/json': { schema: StudentListResponseSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const {
      search,
      searchScope = 'default',
      grade,
      campusId,
      page = 1,
      pageSize = 20,
      isActive,
      taughtByMe = false,
      today: todayFilter,
      withToday,
    } = c.req.valid('query');

    const roles = c.get('roles') ?? [];

    // 管理員不受限，所以不必查 staff
    let ownStaffId: string | null = null;
    if (!roles.includes('admin')) {
      const { data: ownStaff } = await supabase
        .from('staff')
        .select('id')
        .eq('user_id', c.get('userId'))
        .eq('org_id', orgId)
        .maybeSingle();
      ownStaffId = (ownStaff?.id as string | undefined) ?? null;
    }

    const scope = resolveStudentScope({ roles, taughtByMe, ownStaffId });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    // 老師只看得到自己固定任課的班（schedules，不是 sessions —— 代課不算「我的學生」）
    let taughtStudentIds: string[] | null = null;
    if (scope.teacherStaffId) {
      // 這裡原本自己組同一支查詢，而且同樣對 `schedules` 下了 `org_id` ——
      // **那張表沒有這個欄位**（42703）。改成共用 `lib/teacher-scope` 的那一份，
      // 兩處各修一次的話，下一次只會修好一處。
      const classIds = await taughtClassIds(supabase, orgId, scope.teacherStaffId);

      if (classIds.length === 0) {
        taughtStudentIds = [];
      } else {
        const { data: enrolledRows, error: enrolledError } = await supabase
          .from('enrollments')
          .select('student_id')
          .eq('org_id', orgId)
          .in('class_id', classIds)
          .in('status', ['active', 'pending_payment']);
        if (enrolledError) {
          return c.json({ error: '讀取在籍學生失敗', message: enrolledError.message }, 500);
        }
        taughtStudentIds = Array.from(
          new Set((enrolledRows ?? []).map((r) => r['student_id'] as string)),
        );
      }
    }

    let query = supabase
      .from('students')
      .select(
        `*, schools(id, name, short_name), parent_student_relations(is_primary, relation, parents(id, name, user_id)), enrollments(id, status, classes(id, name, campus_id, campuses(name)))`,
        { count: 'exact' },
      )
      .eq('org_id', orgId)
      // 依年級分章（#1314 名冊換形前置）：`grade` 是 enum `grade_level`，Postgres 依列舉序排（P1…S3），
      // 不必 RPC 或 generated column。**高年級在前**（desc，照 A6；同 byGrade 的 GRADE_CHAPTERS）。
      // 章內依姓名，末鍵 id 讓同名翻頁穩定。`grade` 是 NOT NULL，所以不寫 nulls 位置（寫了也觀察不到）
      .order('grade', { ascending: false })
      .order('name')
      .order('id');

    if (taughtStudentIds !== null) {
      // 空陣列代表這位老師沒有任何任課班 —— 結果必須是空的，不是「不篩」
      if (taughtStudentIds.length === 0) {
        return c.json(
          {
            data: [],
            summary: {
              total: 0,
              activeCount: 0,
              byGrade: GRADE_CHAPTERS.map((level) => ({ grade: level, count: 0 })),
              today: null,
            },
            meta: { total: 0, page, pageSize, totalPages: 0 },
          },
          200,
        );
      }
    }

    let searchClause: string | null = null;
    if (search) {
      let matchedStudentIds: string[] = [];
      let schoolIds: string[] = [];

      if (searchScope === 'default') {
        const { data: relationRows, error: relationError } = await supabase
          .from('parent_student_relations')
          .select('student_id, parents!inner(name)')
          .ilike('parents.name', `%${search}%`);

        if (relationError) {
          return c.json({ error: '讀取學生列表失敗', message: relationError.message }, 500);
        }

        let phoneRows: Array<{ student_id: string | null }> = [];
        // 家長電話（#1138 全站搜尋）：3 碼以上純數字才比。電話住在 `ba_user.phone`
        // （20260317000003 把 parents.phone 移走了），寫法照 /api/parents 的搜尋。
        // ponytail: 照輸入的字串連續比對；電話若存成帶 `-` 的格式，跨 `-` 的片段比不到 —— 真有這種資料再正規化
        if (/^\d{3,}$/.test(search)) {
          const { data: users, error: userError } = await supabase
            .from('ba_user')
            .select('id')
            .ilike('phone', `%${search}%`);
          if (userError) {
            return c.json({ error: '讀取學生列表失敗', message: userError.message }, 500);
          }
          const userIds = (users ?? []).map((u: { id: string }) => u.id);
          if (userIds.length > 0) {
            // ba_user 不分機構，所以這裡一定要限本機構的家長
            const { data, error: phoneError } = await supabase
              .from('parent_student_relations')
              .select('student_id, parents!inner(user_id, org_id)')
              .eq('parents.org_id', orgId)
              .in('parents.user_id', userIds);
            if (phoneError) {
              return c.json({ error: '讀取學生列表失敗', message: phoneError.message }, 500);
            }
            phoneRows = (data ?? []) as Array<{ student_id: string | null }>;
          }
        }

        // 學校名（#1314 SL4）：本 org 的學校，全名或簡稱
        const { data: schoolRows, error: schoolError } = await supabase
          .from('schools')
          .select('id')
          .eq('org_id', orgId)
          .or(`name.ilike.%${search}%,short_name.ilike.%${search}%`);
        if (schoolError) {
          return c.json({ error: '讀取學生列表失敗', message: schoolError.message }, 500);
        }
        schoolIds = ((schoolRows ?? []) as Array<{ id: string }>).map((row) => row.id);

        matchedStudentIds = Array.from(
          new Set(
            [...((relationRows ?? []) as Array<{ student_id: string | null }>), ...phoneRows]
              .map((row) => row.student_id)
              .filter((studentId): studentId is string => !!studentId),
          ),
        );
      }

      searchClause = buildStudentSearchClause(search, matchedStudentIds, searchScope, schoolIds);
    }
    if (grade) {
      query = query.eq('grade', grade);
    }
    // 沒指定分校時也要縮到自己管的那幾間 —— `campusFilterIds` 回 null 才是「不限」
    // 這支查詢**不濾 enrollment status**（enrollment-rules 第 8 節）：分校主任要看得到
    // 自家剛退班的學生。改這裡等於改授權可見性，不是改篩選
    const campusIds = campusFilterIds(getCampusScope(c), campusId);
    /**
     * 這個人看得到哪些學生 id。`null` = 不受分校限制。
     *
     * **下面的 `activeCount` 要用同一個集合**（#815 第 2 節）——
     * 它原本只濾 `org_id`，於是只被指派一個分校的管理員在儀表板看到
     * 「在籍學生 69」而他自己的學生頁說 0。
     * 讓第二處自己再算一次就是同一個 bug 的第二個實例：**算兩次就會分岔一次。**
     */
    let scopedStudentIds: string[] | null = null;
    if (campusIds) {
      const { data: enrollmentRows } = await supabase
        .from('enrollments')
        .select('student_id, classes!inner(campus_id)')
        .in('classes.campus_id', [...campusIds]);

      const campusStudentIds = Array.from(
        new Set(
          ((enrollmentRows ?? []) as Array<{ student_id: string | null }>)
            .map((row) => row.student_id)
            .filter((id): id is string => !!id),
        ),
      );

      // 該分校無學生時用一個不存在的 id 表示空集合 —— `.in('id', [])` 也是零筆，
      // 但保留既有寫法，不趁機改語意
      scopedStudentIds =
        campusStudentIds.length > 0 ? campusStudentIds : ['00000000-0000-0000-0000-000000000000'];
    }

    // ── 今日到班（#1314 SL1）──────────────────────────────────
    // 判準在 `lib/today-attendance.ts`，跟作業台同一份。只在帶 `today`、或第一頁（且沒說
    // `withToday=false`）時算 —— 多 4～5 支查詢，翻頁不必重算（計畫席 10-10 裁）。
    let todayStatuses: Map<string, TodayStatus> | null = null;
    if (todayFilter !== undefined || (page === 1 && withToday !== 'false')) {
      const date = getCurrentTaipeiDateString();
      // 模式解析同作業台：單一分校用分校設定、多校用機構預設（同一個 ponytail 上限）
      const singleCampus = campusId ?? (campusIds?.length === 1 ? campusIds[0] : null);
      const { mode } = await resolveAttendanceMode(supabase, orgId, singleCampus);
      if ((mode ?? 'per_session') === 'daily_checkin') {
        let sessionsQuery = supabase
          .from('sessions')
          .select(TODAY_SESSION_SELECT)
          .eq('org_id', orgId)
          .eq('session_date', date);
        if (campusIds) sessionsQuery = sessionsQuery.in('classes.campus_id', [...campusIds]);
        const { data: sessionRows, error: sessionsError } = await sessionsQuery;
        if (sessionsError) {
          return c.json({ error: '讀取學生列表失敗', message: sessionsError.message }, 500);
        }
        const daily = await loadDailyAttendance(
          supabase,
          orgId,
          date,
          ((sessionRows ?? []) as unknown as Array<Record<string, unknown>>).map(toTodaySession),
        );
        todayStatuses = classifyToday(daily, date);
        // 老師只數得到自己的學生
        if (taughtStudentIds !== null) {
          const taught = new Set(taughtStudentIds);
          for (const id of todayStatuses.keys()) if (!taught.has(id)) todayStatuses.delete(id);
        }
      } else if (todayFilter !== undefined) {
        // ponytail: 逐堂點名的「到了沒」是每堂出勤紀錄，v1 不支援（計畫席 10-10 記可否決）——
        // 明講不支援，不默默回空（默默回空會看起來像「今天沒人」）
        return c.json(
          { error: '逐堂點名模式不支援今日到班篩選', code: 'TODAY_UNSUPPORTED_MODE' },
          400,
        );
      }
    }
    const todayIds =
      todayFilter !== undefined && todayStatuses
        ? [...todayStatuses]
            .filter(([, status]) => todayFilter === 'any' || status.state === todayFilter)
            .map(([id]) => id)
        : null;

    // 列表與年級章節計數共用（#1314 SL3）—— 兩邊各寫一份就會對同一份名單給出兩個數字。
    // grade 不在裡面：章節要列出其他年級。兩個 `in('id')` 在 PostgREST 是 AND（交集）
    const withChapterFilters = <Q>(q: Q): Q => {
      let next = q as unknown as StudentFilterable;
      if (taughtStudentIds !== null) next = next.in('id', taughtStudentIds);
      if (searchClause) next = next.or(searchClause);
      if (scopedStudentIds) next = next.in('id', scopedStudentIds);
      if (isActive !== undefined) next = next.eq('is_active', isActive);
      if (todayIds) next = next.in('id', todayIds);
      return next as unknown as Q;
    };
    query = withChapterFilters(query);

    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    // 獨立 query 取得全量 activeCount。
    // **「全量」只指「不受 `isActive` filter 影響」** —— 分校範圍照樣要套（#815）：
    // 不套的話儀表板的「在籍學生」卡片會對只管一個分校的人報全機構的數字，
    // 而他自己的學生頁說 0。用主清單算好的 `scopedStudentIds`，不另外再算一次。
    let activeCountQuery = supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_active', true);
    if (scopedStudentIds) activeCountQuery = activeCountQuery.in('id', scopedStudentIds);

    // #949：計數只用 `scopedStudentIds`（列表之前就算好了），不用列表的結果 —— 同一輪發出去
    // 每級一支 head count 讓 DB 數 —— 撈列回來數會被 max_rows（1000）靜默截斷（同 courses bySubject）
    const gradeCountQueries = GRADE_CHAPTERS.map((level) =>
      withChapterFilters(
        supabase
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('grade', level),
      ),
    );

    const [{ data, error, count }, { count: activeCount }, ...gradeCounts] = await Promise.all([
      query,
      activeCountQuery,
      ...gradeCountQueries,
    ]);

    if (error) {
      return c.json({ error: '讀取學生列表失敗', message: error.message }, 500);
    }
    // 數不出來就不回 0
    const gradeCountError = gradeCounts.find((r) => r.error)?.error;
    if (gradeCountError) {
      return c.json({ error: '讀取學生列表失敗', message: gradeCountError.message }, 500);
    }
    const byGrade = GRADE_CHAPTERS.map((level, i) => ({
      grade: level,
      count: gradeCounts[i]?.count ?? 0,
    }));

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const total = count ?? 0;

    type Relation = {
      is_primary: boolean;
      relation: string | null;
      parents: { id: string; name: string; user_id: string | null } | null;
    };
    const relationsOf = (row: Record<string, unknown>) =>
      ((row['parent_student_relations'] as Relation[]) ?? [])
        .filter((r) => r.parents?.name)
        .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));

    // 主要家長電話：只有管理員查（計畫席裁 #1138 Q-b A）。電話住在 ba_user（唯讀，c2 只禁寫）
    const phoneByUser = new Map<string, string | null>();
    if (scope.teacherStaffId === null) {
      const userIds = [
        ...new Set(
          rows
            .map((row) => relationsOf(row)[0]?.parents?.user_id)
            .filter((id): id is string => !!id),
        ),
      ];
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('ba_user')
          .select('id, phone')
          .in('id', userIds);
        for (const u of users ?? []) phoneByUser.set(u.id as string, (u.phone as string) ?? null);
      }
    }

    const students = rows.map((row) => {
      const relations = relationsOf(row);
      const parentNames = relations.map((r) => r.parents!.name);
      const primaryUserId = relations[0]?.parents?.user_id;
      const primaryParentPhone = (primaryUserId && phoneByUser.get(primaryUserId)) || null;
      const enrollmentRows =
        (row['enrollments'] as Array<{
          id: string;
          status?: string;
          classes: {
            id: string;
            name: string;
            campus_id: string | null;
            campuses: { name: string } | null;
          } | null;
        }>) ?? [];
      // 刪除守門用，**不濾 status**：退班的報名也是引用，濾掉會放行一次破壞歷史的刪除
      const hasEnrollments = enrollmentRows.length > 0;
      // **刻意不濾 status**（跟下面的 classNames 相反，不是漏了）——分校歸屬看的是
      // 「這個分校收過他」，退班學生對分校主任是現在進行式的工作對象（退費、回流招生、
      // 家長投訴回查）。而且這條關聯同時是 campusScope 授權走的路，濾掉不是顯示調整
      // 是可見性收縮。理由與已知取捨見 kb/wiki/rules/enrollment-rules.md 第 8 節（#438）
      const campusNames = Array.from(
        new Set(
          enrollmentRows.map((e) => e.classes?.campuses?.name).filter((n): n is string => !!n),
        ),
      );
      // 只算在籍的班 —— 退班的班名不該出現在老師的分組裡
      const classNames = Array.from(
        new Set(
          enrollmentRows
            .filter((e) => !e.status || ['active', 'pending_payment'].includes(e.status))
            .map((e) => e.classes?.name)
            .filter((n): n is string => !!n),
        ),
      );

      return {
        ...toStudentResponse(row, parentNames, campusNames, hasEnrollments, classNames),
        primaryParentPhone,
        // 跟 campusNames 一樣不依分校濾（enrollment-rules 第 8 節）
        enrollmentState: deriveEnrollmentState(enrollmentRows.map((e) => e.status)),
        ...(todayStatuses ? { todayStatus: todayStatuses.get(row['id'] as string) ?? null } : {}),
      };
    });

    return c.json(
      {
        data: students,
        summary: {
          total,
          activeCount: activeCount ?? 0,
          byGrade,
          today: todayStatuses ? countToday(todayStatuses) : null,
        },
        meta: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      },
      200,
    );
  },
);

// GET /api/students/:id
// POST /api/students
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Students'],
    summary: '建立學生',
    request: {
      body: { content: { 'application/json': { schema: CreateStudentSchema } } },
    },
    responses: {
      201: {
        description: '建立成功',
        content: { 'application/json': { schema: z.object({ data: StudentSchema }) } },
      },
      500: {
        description: '建立失敗',
        content: {
          'application/json': {
            schema: z.object({ error: z.string(), message: z.string() }),
          },
        },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    const insertPayload: Record<string, unknown> = {
      org_id: orgId,
      name: body.name,
      grade: body.grade,
      school_id: body.schoolId ?? null,
    };
    if (body.birthday !== undefined) insertPayload['birthday'] = body.birthday;
    if (body.gender !== undefined) insertPayload['gender'] = body.gender;
    if (body.phone !== undefined) insertPayload['phone'] = body.phone;
    if (body.email !== undefined) insertPayload['email'] = body.email;
    if (body.address !== undefined) insertPayload['address'] = body.address;
    if (body.emergencyContactName !== undefined)
      insertPayload['emergency_contact_name'] = body.emergencyContactName;
    if (body.emergencyContactPhone !== undefined)
      insertPayload['emergency_contact_phone'] = body.emergencyContactPhone;
    if (body.notes !== undefined) insertPayload['notes'] = body.notes;

    const { data, error } = await supabase
      .from('students')
      .insert(insertPayload)
      .select('*, schools(id, name, short_name)')
      .single();

    if (error || !data) {
      return c.json({ error: '建立學生失敗', message: error?.message ?? '' }, 500);
    }

    const student = StudentSchema.parse(toStudentResponse(data as Record<string, unknown>));

    // 建立家長關聯（若有提供 parentId）
    if (body.parentId) {
      await supabase.from('parent_student_relations').insert({
        parent_id: body.parentId,
        student_id: student.id,
        is_primary: true,
        relation: null,
      });
    }

    return c.json({ data: student }, 201);
  },
);

// GET /api/students/:id
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Students'],
    summary: '取得學生詳情',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '學生詳情',
        content: { 'application/json': { schema: z.object({ data: StudentDetailSchema }) } },
      },
      404: { description: '學生不存在' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { data, error } = await supabase
      .from('students')
      .select(
        `*, schools(id, name, short_name), parent_student_relations(
          id, is_primary, relation,
          parents(id, name, user_id)
        )`,
      )
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (error || !data || (await outOfCampusScope(supabase, orgId, id, getCampusScope(c)))) {
      return c.json({ error: '學生不存在' }, 404);
    }

    // #1098：老師只讀得到自己固定任課班的學生。別 org 的 id 在上面已是 404；同 org 但不是他的學生 → 403
    if (await teacherCannotRead(supabase, orgId, c.get('userId'), c.get('roles') ?? [], id)) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    const row = data as Record<string, unknown>;
    const relations =
      (row['parent_student_relations'] as Array<{
        id: string;
        is_primary: boolean;
        relation: string | null;
        parents: { id: string; name: string; user_id: string } | null;
      }>) ?? [];

    const validRelations = relations.filter((r) => r.parents);
    const userIds = validRelations.map((r) => r.parents!.user_id).filter(Boolean);

    const baUserMap = new Map<string, { email: string | null; phone: string | null }>();
    if (userIds.length > 0) {
      const { data: baUsers } = await supabase
        .from('ba_user')
        .select('id, email, phone')
        .in('id', userIds);
      for (const u of baUsers ?? []) {
        baUserMap.set(u.id as string, {
          email: (u.email as string | null) ?? null,
          phone: (u.phone as string | null) ?? null,
        });
      }
    }

    const parents = validRelations.map((r) => {
      const baUser = baUserMap.get(r.parents!.user_id) ?? { email: null, phone: null };
      return {
        id: r.parents!.id,
        name: r.parents!.name,
        phone: baUser.phone,
        email: baUser.email,
        relation: r.relation,
        isPrimary: r.is_primary,
      };
    });

    const parentNames = parents
      .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))
      .map((p) => p.name);

    return c.json({ data: { ...toStudentResponse(row, parentNames), parents } }, 200);
  },
);

// PUT /api/students/:id
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Students'],
    summary: '更新學生資料',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: UpdateStudentSchema } } },
    },
    responses: {
      200: {
        description: '更新成功',
        content: { 'application/json': { schema: z.object({ data: StudentSchema }) } },
      },
      404: { description: '學生不存在' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const updatePayload: Record<string, unknown> = {};
    if (body.name !== undefined) updatePayload['name'] = body.name;
    if (body.grade !== undefined) updatePayload['grade'] = body.grade;
    if (body.schoolId !== undefined) updatePayload['school_id'] = body.schoolId;
    if (body.birthday !== undefined) updatePayload['birthday'] = body.birthday;
    if (body.gender !== undefined) updatePayload['gender'] = body.gender;
    if (body.phone !== undefined) updatePayload['phone'] = body.phone;
    if (body.email !== undefined) updatePayload['email'] = body.email;
    if (body.address !== undefined) updatePayload['address'] = body.address;
    if (body.emergencyContactName !== undefined)
      updatePayload['emergency_contact_name'] = body.emergencyContactName;
    if (body.emergencyContactPhone !== undefined)
      updatePayload['emergency_contact_phone'] = body.emergencyContactPhone;
    if (body.notes !== undefined) updatePayload['notes'] = body.notes;
    if (body.isActive !== undefined) updatePayload['is_active'] = body.isActive;

    if (Object.keys(updatePayload).length === 0) {
      return c.json({ error: '未提供任何更新欄位' }, 400);
    }
    if (await outOfCampusScope(supabase, orgId, id, getCampusScope(c))) {
      return c.json({ error: '學生不存在或更新失敗' }, 404);
    }

    const { data, error } = await supabase
      .from('students')
      .update(updatePayload)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*, schools(id, name, short_name)')
      .single();

    if (error || !data) {
      return c.json({ error: '學生不存在或更新失敗' }, 404);
    }

    const updated = toStudentResponse(data as Record<string, unknown>);

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'student',
        resourceId: id,
        action: 'update',
        details: { newValue: updated },
      },
      waitUntilFrom(c),
    );

    return c.json({ data: updated }, 200);
  },
);

// DELETE /api/students/:id
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Students'],
    summary: '刪除學生',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: { description: '刪除成功' },
      409: { description: '學生已有報名紀錄，無法刪除' },
      404: { description: '學生不存在' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    if (await outOfCampusScope(supabase, orgId, id, getCampusScope(c))) {
      return c.json({ error: '學生不存在' }, 404);
    }

    const { count: enrollmentCount, error: enrollmentCountError } = await supabase
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', id);

    if (enrollmentCountError) {
      return c.json({ error: '查詢學生報名紀錄失敗', message: enrollmentCountError.message }, 500);
    }

    if ((enrollmentCount ?? 0) > 0) {
      return c.json({ error: '學生已有報名紀錄，無法刪除' }, 409);
    }

    const { data, error } = await supabase
      .from('students')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id')
      .single();

    if (error || !data) {
      return c.json({ error: '學生不存在' }, 404);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'student',
        resourceId: id,
        action: 'delete',
      },
      waitUntilFrom(c),
    );

    return c.json({ success: true }, 200);
  },
);

// GET /api/students/:id/attendance-days（#1314 SD2）
app.route('/', attendanceDaysRoute);

export default app;
