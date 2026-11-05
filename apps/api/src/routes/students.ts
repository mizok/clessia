import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import { attachParentContacts, type ParentRelationRow } from '../lib/student-parents';
import { resolveStudentScope } from './students/teacher-scope';
import { outOfCampusScope, teacherCannotRead } from './students/read-scope';
import { taughtClassIds, taughtStudentIds } from '../lib/teacher-scope';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { DbUuidSchema } from '../lib/validation';
import { campusFilterIds, getCampusScope } from '../lib/campus-scope';
import { fetchAllPages } from '../lib/fetch-all-pages';
import { getAuth } from '../lib/get-auth';
import { isParentWithinScope } from '../lib/parent-campus-scope';
import { withTx } from '../lib/pg-tx';
import { resolveAttendanceMode } from '../lib/attendance-mode';
import { addDaysToDateString, getCurrentTaipeiDateString } from '../lib/taipei-date';
import { loadStudentListViaSql, type StudentListParams } from '../lib/student-list-sql';
import { GRADE_CHAPTERS, loadStudentListViaBuilder } from '../lib/student-list-builder';
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
    /** 列表才有（#2053）：有有效到班卡 */
    hasActiveCard: z.boolean().optional(),
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
    /** 在籍班級的 id 與名稱（列表才有；老師的學生面板用班 id 查「這班」的考試）。範圍同 classNames */
    classes: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
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

// 搬到 lib/student-list-builder.ts（#1595 P2 ②）；spec 從這裡 import，保留轉出口
export { buildStudentSearchClause } from '../lib/student-list-builder';

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
        /** 學制跟年級不合（#1820 設計稿 §4）：學校的學制跟學生年級的學制不同；未分類的學校不算 */
        schoolMismatch: z.enum(['true']).optional(),
        /**
         * 沒有有效到班卡（#2053）：還在用舊卡（QR＝學生 id）、從沒發過卡、或卡被作廢沒補發。
         * 第一次全校發卡用它找人。條件在 DB 裡（反連接），不把學生 id 撈回來再塞進 URL（#1928）
         */
        withoutCard: z.enum(['true']).optional(),
        /**
         * 今天（台北）發的有效卡（#2267）：發卡交易 COMMIT 後列印視窗被關掉、印失敗時，那批人已經不在
         * 「沒有有效卡」裡，用這個找回來重印。條件同樣在 DB（`active_card` embed 的發卡時間＋非空）
         */
        cardIssuedToday: z.enum(['true']).optional(),
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
      schoolMismatch,
      withoutCard,
      cardIssuedToday,
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
    /** 老師固定任課的班；管理員是 null。今日到班只算這些班的課（#1100 #51） */
    let myClassIds: string[] | null = null;
    if (scope.teacherStaffId) {
      // 這裡原本自己組同一支查詢，而且同樣對 `schedules` 下了 `org_id` ——
      // **那張表沒有這個欄位**（42703）。改成共用 `lib/teacher-scope` 的那一份，
      // 兩處各修一次的話，下一次只會修好一處。
      const classIds = await taughtClassIds(supabase, orgId, scope.teacherStaffId);
      myClassIds = classIds;

      if (classIds.length === 0) {
        taughtStudentIds = [];
      } else {
        // 只在記憶體裡用（今日到班濾掉別人的學生、沒有學生就提早回空）—— 列表本身的老師範圍在 DB 端篩（#1928，
        // 見 `scopeEmbed`），這份清單不進 URL。分頁撈齊，免得 max_rows 1000 靜默截斷
        const { rows: enrolledRows, error: enrolledError } = await fetchAllPages((from, to) =>
          supabase
            .from('enrollments')
            .select('student_id')
            .eq('org_id', orgId)
            .in('class_id', classIds)
            .in('status', ['active', 'pending_payment'])
            .order('id')
            .range(from, to),
        );
        if (enrolledError) {
          return c.json(
            {
              error: '讀取在籍學生失敗',
              message: (enrolledError as { message?: string }).message ?? '',
            },
            500,
          );
        }
        taughtStudentIds = Array.from(new Set(enrolledRows.map((r) => r['student_id'] as string)));
      }
    }

    // 沒指定分校時也要縮到自己管的那幾間 —— `campusFilterIds` 回 null 才是「不限」
    // 這支查詢**不濾 enrollment status**（enrollment-rules 第 8 節）：分校主任要看得到
    // 自家剛退班的學生。改這裡等於改授權可見性，不是改篩選
    const campusIds = campusFilterIds(getCampusScope(c), campusId);
    /**
     * 範圍（#1928）：條件放進 embed 的 `!inner` 在 DB 端篩，**不先撈範圍內學生 id 再 `.in('id', …)`**
     * （兩三百位就 414，整頁 500）。分校＝任一筆報名的班在範圍內（不分狀態）；老師＝在他任課班有
     * 在籍（active／pending_payment）的報名 —— 同一個 alias 上的兩個條件落在同一筆報名，同原本。
     * 列表、在籍數、章節計數**共用同一份**（#815：算兩次就會分岔一次）
     */
    const scopeEmbed =
      (campusIds ? ', scope_campus:enrollments!inner(classes!inner(campus_id))' : '') +
      (myClassIds ? ', scope_taught:enrollments!inner(class_id, status)' : '');

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

    // ── 今日到班（#1314 SL1）──────────────────────────────────
    // 判準在 `lib/today-attendance.ts`，跟作業台同一份。只在帶 `today`、或第一頁（且沒說
    // `withToday=false`）時算 —— 多 4～5 支查詢，翻頁不必重算（計畫席 10-10 裁）。
    type TodayResult = { statuses: Map<string, TodayStatus> | null } | { response: Response };
    const loadToday = async (): Promise<TodayResult> => {
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
        // #1100 #51（使用者 10-23 裁定）：老師只看自己教的班的到班 —— 他的學生今天若只有別班的課，
        // 狀態是「今天沒他的課」（null），不是別班那堂到了沒（看不到的就是看不到）
        if (myClassIds !== null) {
          sessionsQuery = sessionsQuery.in(
            'class_id',
            myClassIds.length > 0 ? myClassIds : ['00000000-0000-0000-0000-000000000000'],
          );
        }
        const { data: sessionRows, error: sessionsError } = await sessionsQuery;
        if (sessionsError) {
          return {
            response: c.json({ error: '讀取學生列表失敗', message: sessionsError.message }, 500),
          };
        }
        // 在籍、打卡、請假走 pg（#1595 P2 ①）；沒有池就回 500，不退回 REST
        const pool = c.get('auth')?.pool;
        if (!pool) {
          return {
            response: c.json({ error: '讀取學生列表失敗', code: 'DB_POOL_UNAVAILABLE' }, 500),
          };
        }
        const daily = await loadDailyAttendance(
          pool,
          orgId,
          date,
          ((sessionRows ?? []) as unknown as Array<Record<string, unknown>>).map(toTodaySession),
          { campusIds, classIds: myClassIds },
        );
        const todayStatuses = classifyToday(daily, date);
        // 老師只數得到自己的學生
        if (taughtStudentIds !== null) {
          const taught = new Set(taughtStudentIds);
          for (const id of todayStatuses.keys()) if (!taught.has(id)) todayStatuses.delete(id);
        }
        return { statuses: todayStatuses };
      } else if (todayFilter !== undefined) {
        // ponytail: 逐堂點名的「到了沒」是每堂出勤紀錄，v1 不支援（計畫席 10-10 記可否決）——
        // 明講不支援，不默默回空（默默回空會看起來像「今天沒人」）
        return {
          response: c.json(
            { error: '逐堂點名模式不支援今日到班篩選', code: 'TODAY_UNSUPPORTED_MODE' },
            400,
          ),
        };
      }
      return { statuses: null };
    };
    // 帶 `today` 篩選時列表要用它的結果，只能先算；沒帶時（開頁預設）跟下面的列表同時跑，
    // 不再排在列表前面多等 3–4 個往返（#1595 P3b-A）
    const todayPromise: Promise<TodayResult> =
      todayFilter !== undefined || (page === 1 && withToday !== 'false')
        ? loadToday()
        : Promise.resolve({ statuses: null });
    // 列表先失敗、提早 return 時，這支的結果沒人等 —— 別讓它變成 unhandled rejection
    todayPromise.catch(() => undefined);
    let todayStatuses: Map<string, TodayStatus> | null = null;
    if (todayFilter !== undefined) {
      const today = await todayPromise;
      if ('response' in today) return today.response;
      todayStatuses = today.statuses;
    }
    const todayIds =
      todayFilter !== undefined && todayStatuses
        ? [...todayStatuses]
            .filter(([, status]) => todayFilter === 'any' || status.state === todayFilter)
            .map(([id]) => id)
        : null;

    // 有 pool 就走 SQL（Hyperdrive，一次往返，#1595 P2 ② 刀 1a）；失敗 → 500，不退回 builder（#2230 (c)）。
    // 帶 search／today 的請求這刀還走 builder（刀 1b 收）。沒有 pool 才走 builder（單元測試）——
    // 兩條路吃**同一份參數**，條件由 contract/student-list-sql.contract.ts 逐欄比對
    const pool = c.get('auth')?.pool;
    const cardDay = getCurrentTaipeiDateString();
    const listParams: StudentListParams = {
      orgId,
      campusIds,
      classIds: myClassIds,
      grade: grade ?? null,
      isActive: isActive ?? null,
      schoolMismatch: !!schoolMismatch,
      withoutCard: !!withoutCard,
      cardIssuedToday: !!cardIssuedToday,
      cardDayStart: `${cardDay}T00:00:00+08:00`,
      cardDayEnd: `${addDaysToDateString(cardDay, 1)}T00:00:00+08:00`,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      withPhone: scope.teacherStaffId === null,
      search: search || null,
      searchRelated: searchScope === 'default',
      searchPhone: /^\d{3,}$/.test(search ?? ''),
      todayIds,
    };
    const {
      rows,
      total,
      activeCount,
      byGrade: countByGrade,
    } = pool && !search && todayFilter === undefined
      ? await loadStudentListViaSql(pool, listParams)
      : await loadStudentListViaBuilder(supabase, listParams);
    if (todayFilter === undefined) {
      const today = await todayPromise;
      if ('response' in today) return today.response;
      todayStatuses = today.statuses;
    }
    const byGrade = GRADE_CHAPTERS.map((level) => ({
      grade: level,
      count: countByGrade[level] ?? 0,
    }));

    type Relation = {
      is_primary: boolean;
      relation: string | null;
      parents: { id: string; name: string; user_id: string | null; phone?: string | null } | null;
    };
    const relationsOf = (row: Record<string, unknown>) =>
      ((row['parent_student_relations'] as Relation[]) ?? [])
        .filter((r) => r.parents?.name)
        .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0));

    const students = rows.map((row) => {
      const relations = relationsOf(row);
      const parentNames = relations.map((r) => r.parents!.name);
      // 主要家長電話：兩條路都只在管理員時帶進 `parents.phone`（計畫席裁 #1138 Q-b A）
      const primaryParentPhone = relations[0]?.parents?.phone || null;
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
      // 老師只看得到自己教的班的報名：班名、班、分校名都從這份算。他的學生也上別人的班，
      // 那些班與它們的分校不是他看得到的東西（計畫席 10-30、審核席 #2084 二讀；
      // contract/students-class-names-scope 守）。管理員 myClassIds 是 null，照舊用全部
      const visibleRows =
        myClassIds === null
          ? enrollmentRows
          : enrollmentRows.filter((e) => !!e.classes && myClassIds.includes(e.classes.id));
      // **刻意不濾 status**（跟下面的 classNames 相反，不是漏了）——分校歸屬看的是
      // 「這個分校收過他」，退班學生對分校主任是現在進行式的工作對象（退費、回流招生、
      // 家長投訴回查）。而且這條關聯同時是 campusScope 授權走的路，濾掉不是顯示調整
      // 是可見性收縮。理由與已知取捨見 kb/wiki/rules/enrollment-rules.md 第 8 節（#438）
      const campusNames = Array.from(
        new Set(visibleRows.map((e) => e.classes?.campuses?.name).filter((n): n is string => !!n)),
      );
      // 只算在籍的班 —— 退班的班名不該出現在老師的分組裡
      const inFlight = visibleRows.filter(
        (e) => !e.status || ['active', 'pending_payment'].includes(e.status),
      );
      const classes = [
        ...new Map(
          inFlight
            .map((e) => e.classes)
            .filter((k): k is NonNullable<typeof k> => !!k)
            .map((k) => [k.id, { id: k.id, name: k.name }] as const),
        ).values(),
      ];
      const classNames = Array.from(new Set(classes.map((k) => k.name)));

      return {
        ...toStudentResponse(row, parentNames, campusNames, hasEnrollments, classNames),
        classes,
        primaryParentPhone,
        /** 有有效到班卡（#2053）。沒有＝要發卡（舊卡、從沒發過、作廢沒補發） */
        hasActiveCard: ((row['active_card'] as unknown[] | null) ?? []).length > 0,
        // 跟 campusNames 一樣不依分校濾（enrollment-rules 第 8 節），但老師只算自己教的班：
        // 別人班的待繳費不是他的事，也不該讓他知道（計畫席 10-30）
        enrollmentState: deriveEnrollmentState(visibleRows.map((e) => e.status)),
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
      403: { description: '家長不在你的分校範圍內' },
      404: { description: '家長不存在（或不屬於本機構）' },
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

    // 帶 parentId（家長頁「新增孩子」）：#1845 —— 家長要屬於本 org（別 org／不存在一律 404，
    // 不透露存在）、受限管理員還要在範圍內（403）。都在寫入之前擋。
    // 判準同家長列表：還沒有孩子的家長，受限管理員看不到也掛不上（#821 接受的限制）
    if (body.parentId) {
      const { data: parent } = await supabase
        .from('parents')
        .select('id')
        .eq('id', body.parentId)
        .eq('org_id', orgId)
        .maybeSingle();
      if (!parent) return c.json({ error: '找不到這位家長', code: 'PARENT_NOT_FOUND' }, 404);
      if (!(await isParentWithinScope(supabase, getCampusScope(c), body.parentId)))
        return c.json({ error: '這位家長不在你的分校範圍內', code: 'PARENT_OUT_OF_SCOPE' }, 403);
    }

    let studentId: string;
    if (body.parentId) {
      // 學生與關聯一個交易：原本關聯插入失敗時錯誤被吞掉，回 201 但學生沒有家長
      const pool = getAuth(c).pool;
      if (!pool) return c.json({ error: '建立學生失敗', message: 'DB_POOL_UNAVAILABLE' }, 500);
      const parentId = body.parentId;
      // 欄位名來自上面寫死的 insertPayload，值一律參數化
      const cols = Object.keys(insertPayload);
      try {
        studentId = await withTx(pool, async (db) => {
          const { rows } = await db.query<{ id: string }>(
            `INSERT INTO students (${cols.join(', ')})
             VALUES (${cols.map((_, n) => `$${n + 1}`).join(', ')}) RETURNING id`,
            cols.map((k) => insertPayload[k]),
          );
          await db.query(
            `INSERT INTO parent_student_relations (parent_id, student_id, is_primary, relation)
             VALUES ($1, $2, true, NULL)`,
            [parentId, rows[0]!.id],
          );
          return rows[0]!.id;
        });
      } catch (err) {
        return c.json({ error: '建立學生失敗', message: (err as Error).message ?? '' }, 500);
      }
    } else {
      const { data: inserted, error } = await supabase
        .from('students')
        .insert(insertPayload)
        .select('id')
        .single();
      if (error || !inserted) {
        return c.json({ error: '建立學生失敗', message: error?.message ?? '' }, 500);
      }
      studentId = (inserted as { id: string }).id;
    }

    const { data, error } = await supabase
      .from('students')
      .select('*, schools(id, name, short_name)')
      .eq('id', studentId)
      .eq('org_id', orgId)
      .single();
    if (error || !data) {
      return c.json({ error: '建立學生失敗', message: error?.message ?? '' }, 500);
    }

    const student = StudentSchema.parse(toStudentResponse(data as Record<string, unknown>));

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
      500: { description: '讀取家長聯絡方式失敗' },
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
    const relations = (row['parent_student_relations'] as ParentRelationRow[]) ?? [];
    // #1625：ba_user 讀不到原本被吞成「沒有留電話」，跟真的沒留分不出來 —— 改成 500
    const { parents, error: contactsError } = await attachParentContacts(supabase, relations);
    if (contactsError) {
      return c.json({ error: '讀取家長聯絡方式失敗', code: 'SERVER_ERROR' }, 500);
    }

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
      409: { description: '學生已有報名、帳單或成績紀錄，無法刪除' },
      404: { description: '學生不存在' },
      500: { description: '查詢或刪除失敗' },
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

    if (error) {
      // 23503 = FK 違反：帳單、成績（invoices／academy／school exam scores 都是 RESTRICT）擋住刪除。
      // 不能折成 404「學生不存在」—— 學生明明就在畫面上（#1651）
      if (error.code === '23503') {
        return c.json({ error: '學生已有帳單或成績紀錄，無法刪除', code: 'IN_USE' }, 409);
      }
      if (error.code !== 'PGRST116') {
        return c.json({ error: '刪除學生失敗', code: 'DB_ERROR' }, 500);
      }
    }
    if (!data) {
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
