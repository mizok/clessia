import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { loadDisplayName } from '../lib/display-name';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import { formatAuditClassResourceName, logAudit } from '../utils/audit';
import { DbUuidSchema } from '../lib/validation';
import { findInOrg, inOrg, missingInOrg } from '../lib/org-scope';
import { checkTeacherEligibility } from '../lib/teacher-eligibility';
import {
  isScheduleCurrentOrUpcoming,
  isScheduleEffectiveOn,
  scheduleOverlaps,
  scheduleRangeOf,
} from '../lib/schedule-effective';
import { buildSessionGenerationPlan } from '../domain/session-assignment/session-generation-planner';
import { deriveAssignmentStatus } from '../domain/session-assignment/session-assignment.rules';
import { applyCampusFilter, getCampusScope } from '../lib/campus-scope';
import { classWriteScope, resourceCampusAllowed } from '../lib/campus-write-guard';
import { deleteClasses, type ClassDeleteOutcome } from '../lib/class-delete';
import { getAuth } from '../lib/get-auth';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import { countEnrolledOn, type EnrollmentRange } from '../lib/session-roster';
import { checkClassesPastSessions } from '../lib/class-past-sessions';
import type {
  BatchAssignMode,
  BatchAssignPlanOutput,
  BatchAssignConflict,
} from '../domain/session-assignment/session-assignment.types';
import { waitUntilFrom } from '../lib/wait-until';
import { queueScheduleChangeNotice } from '../lib/notify-schedule';
import { hasPermission } from '../lib/permissions';
import { loadLatestExams, type LatestExam } from '../lib/class-latest-exam';
import {
  normalizeTime,
  toMinutes,
  isTimeOverlap,
  toWeekdayFromString,
} from '../domain/session-assignment/time-utils';

// ============================================================
// Schemas
// ============================================================

const ScheduleSchema = z
  .object({
    id: DbUuidSchema,
    classId: DbUuidSchema,
    weekday: z.number().int().min(1).max(7),
    startTime: z.string(),
    endTime: z.string(),
    teacherId: DbUuidSchema.nullable(),
    teacherName: z.string().optional(),
    effectiveTo: z.string().nullable(),
    /** 指定的教室（#1796）；null = 不指定。教室刪掉時 DB 會把它設回 null */
    classroomId: DbUuidSchema.nullable(),
    classroomName: z.string().nullable(),
  })
  .openapi('Schedule');

const ClassSchema = z
  .object({
    id: DbUuidSchema,
    orgId: DbUuidSchema,
    campusId: DbUuidSchema,
    courseId: DbUuidSchema,
    courseName: z.string().optional(),
    subjectId: z.string().uuid().nullable().optional(),
    subjectName: z.string().nullable().optional(),
    campusName: z.string().optional(),
    name: z.string(),
    maxStudents: z.number(),
    gradeLevels: z.array(z.string()),
    nextClassId: DbUuidSchema.nullable(),
    isActive: z.boolean(),
    /** 國小／國中模式的開關（kb/wiki/rules/contact-book-rules.md 規則 2）。
     *  開 = 用個人聯絡簿；關 = 走 class_logs 教務日誌 */
    usesContactBook: z.boolean(),
    /** 目錄參考價的範本（#1175）。只回 id —— 金額要 `manage_finance` 才讀得到（`/api/fee-templates`） */
    defaultFeeTemplateId: DbUuidSchema.nullable(),
    /** 家長端「推薦加選」的人工標記（#1118） */
    isRecommended: z.boolean(),
    /** 出現在匿名的公開報名／試聽表單（#1665 Q5）；家長端不受影響 */
    isPublicEnrollment: z.boolean(),
    scheduleCount: z.number().optional(),
    scheduleTeacherIds: z.array(z.string()).optional(),
    hasUpcomingSessions: z.boolean().optional(),
    // TODO: 待老師點名功能完成後，改為依據 status='completed' 判斷
    hasPastSessions: z.boolean().optional(),
    upcomingCancelledCount: z.number().optional(),
    upcomingUnassignedCount: z.number().optional(),
    upcomingClassConflictCount: z.number().optional(),
    upcomingTeacherConflictCount: z.number().optional(),
    /** 列表才有：今天在籍的人數（`countEnrolledOn`，跟點名／課堂名單同一份規則）；A6「17／24 人」 */
    enrolledCount: z.number().int().optional(),
    /** 列表才有：最近一場有成績的校內考（#1314 G6，`lib/class-latest-exam.ts`）；沒考過＝null，查詢失敗＝不回 */
    latestExam: z
      .object({
        examId: z.string(),
        name: z.string(),
        examDate: z.string(),
        totalScore: z.number(),
        avgScore: z.number().nullable(),
        failCount: z.number().int(),
        absentCount: z.number().int(),
      })
      .nullable()
      .optional(),
    schedules: z.array(ScheduleSchema).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string().nullable().optional(),
    updatedByName: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(), // 'yyyy-MM-dd' or null
    endDate: z.string().nullable().optional(),
  })
  .openapi('Class');

const ClassListResponseSchema = z
  .object({
    data: z.array(ClassSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('ClassListResponse');

const CreateClassSchema = z
  .object({
    courseId: DbUuidSchema,
    name: z.string().min(1).max(50),
    maxStudents: z.number().int().min(1).max(200).optional(),
    nextClassId: DbUuidSchema.nullable().optional(),
    /** #1175：要 `manage_finance`；沒有時**不要帶這個 key**（帶了整筆 403） */
    defaultFeeTemplateId: DbUuidSchema.nullable().optional(),
    isRecommended: z.boolean().optional(),
    isPublicEnrollment: z.boolean().optional(),
    // 不給就用 DB 的 default false（現況全是紙本）
    usesContactBook: z.boolean().optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .openapi('CreateClass');

const UpdateClassSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    maxStudents: z.number().int().min(1).max(200).optional(),
    nextClassId: DbUuidSchema.nullable().optional(),
    /** #1175：要 `manage_finance`；沒有時**不要帶這個 key**（帶了整筆 403） */
    defaultFeeTemplateId: DbUuidSchema.nullable().optional(),
    isRecommended: z.boolean().optional(),
    isPublicEnrollment: z.boolean().optional(),
    isActive: z.boolean().optional(),
    usesContactBook: z.boolean().optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .openapi('UpdateClass');

const CreateScheduleSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    teacherId: DbUuidSchema.nullable().optional(),
    effectiveTo: z.string().nullable().optional(),
    /** 要跟班級同一個分校（#1796）；null = 不指定 */
    classroomId: DbUuidSchema.nullable().optional(),
  })
  .openapi('CreateSchedule');

const SessionPreviewSchema = z
  .object({
    sessionDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    teacherId: DbUuidSchema.nullable(),
    teacherName: z.string().optional(),
    weekday: z.number(),
    exists: z.boolean(),
    canCreate: z.boolean(),
    willBeUnassigned: z.boolean(),
    skipReason: z.enum(['exists', 'no_teacher']).nullable(),
  })
  .openapi('SessionPreview');

const BatchAssignTimeRangeSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});

const BatchAssignBodySchema = z.object({
  from: z.string(),
  to: z.string(),
  weekday: z.array(z.number().int().min(1).max(7)).optional(),
  timeRanges: z.array(BatchAssignTimeRangeSchema).optional(),
  toTeacherId: DbUuidSchema,
  mode: z.enum(['skip-conflicts', 'strict', 'force']).default('skip-conflicts'),
  includeAssigned: z.boolean().default(false),
  dryRun: z.boolean().optional(),
});

const BatchAssignConflictSchema = z.object({
  sessionId: DbUuidSchema,
  sessionDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  conflictWithSessionId: DbUuidSchema,
});

const BatchSessionTargetSchema = z.object({
  sessionIds: z.array(DbUuidSchema).min(1).max(1000),
  dryRun: z.boolean().optional(),
});

const BatchUpdateSessionTimeBodySchema = BatchSessionTargetSchema.extend({
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});

const BatchCancelSessionsBodySchema = BatchSessionTargetSchema;

const BatchSessionConflictSchema = z.object({
  sessionId: DbUuidSchema,
  sessionDate: z.string(),
  reason: z.enum([
    'status_not_editable',
    'status_not_cancellable',
    'status_not_reopenable',
    'class_conflict',
    'teacher_conflict',
    'makeup_target_already_covered',
  ]),
  detail: z.string(),
  conflictingSessionId: DbUuidSchema.optional(),
});

const BatchSessionActionResponseSchema = z.object({
  updated: z.number(),
  skipped: z.number(),
  processableIds: z.array(DbUuidSchema),
  conflicts: z.array(BatchSessionConflictSchema),
  dryRun: z.boolean(),
});

const GenerateSessionsResponseSchema = z.object({
  createdAssigned: z.number(),
  createdUnassigned: z.number(),
  skippedExisting: z.number(),
  skippedNoTeacher: z.number(),
  totalPlanned: z.number(),
});

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi('Error');

const CheckConflictsRequestSchema = z
  .object({
    schedules: z.array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        startTime: z.string(),
        endTime: z.string(),
        teacherId: DbUuidSchema.nullable(),
        /** 生效起始日（#1100 #22）；沒帶＝不限起點 */
        effectiveFrom: z.string().nullable().optional(),
        effectiveTo: z.string().nullable().optional(),
      }),
    ),
    excludeClassId: DbUuidSchema.optional(),
  })
  .openapi('CheckConflictsRequest');

const ScheduleConflictItemSchema = z
  .object({
    scheduleIndex: z.number().int(),
    teacherName: z.string(),
    conflictingClassId: DbUuidSchema,
    conflictingClassName: z.string(),
    conflictingCourseName: z.string(),
    conflictingWeekday: z.number().int(),
    conflictingStartTime: z.string(),
    conflictingEndTime: z.string(),
  })
  .openapi('ScheduleConflictItem');

const QueryParamsSchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
  campusId: DbUuidSchema.optional(),
  courseId: DbUuidSchema.optional(),
  isActive: z.string().optional(),
  includeHistorical: z.string().optional(), // 'true' | undefined
  historicalFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  historicalTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

// ============================================================
// Helpers
// ============================================================

function mapSchedule(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    classId: row['class_id'] as string,
    weekday: row['weekday'] as number,
    startTime: row['start_time'] as string,
    endTime: row['end_time'] as string,
    teacherId: (row['teacher_id'] as string | null) ?? null,
    teacherName: (row['staff'] as { display_name: string } | null)?.display_name,
    effectiveTo: (row['effective_to'] as string | null) ?? null,
    classroomId: (row['classroom_id'] as string | null) ?? null,
    classroomName: (row['classrooms'] as { name: string } | null)?.name ?? null,
  };
}

/**
 * 時段指定的教室要屬於本 org、**而且跟班級同一個分校**（#1796）。
 * FK 只保證教室存在，擋不住別 org、別分校的教室（#1765 migration 註解：由 API 驗）。
 * 不在本 org（或不存在）→ 404；在本 org 但別分校 → 409。查詢失敗丟（500），不折成「通過」。
 */
async function classroomProblem(
  supabase: AppEnv['Variables']['supabase'],
  orgId: string,
  classCampusId: string | null,
  classroomId: string,
): Promise<{ status: 404 | 409; error: string; code: string } | null> {
  const room = await findInOrg(supabase, 'classrooms', orgId, classroomId, 'campus_id');
  if (!room) return { status: 404, error: '教室不存在', code: 'CLASSROOM_NOT_FOUND' };
  if (room['campus_id'] !== classCampusId) {
    return { status: 409, error: '教室不在這個班級的分校', code: 'CLASSROOM_CAMPUS_MISMATCH' };
  }
  return null;
}

interface ClassExtras {
  schedules?: unknown[];
  scheduleCount?: number;
  scheduleTeacherIds?: string[];
  hasUpcomingSessions?: boolean;
  // TODO: 待老師點名功能完成後，改為依據 status='completed' 判斷
  hasPastSessions?: boolean;
  upcomingCancelledCount?: number;
  upcomingUnassignedCount?: number;
  upcomingClassConflictCount?: number;
  upcomingTeacherConflictCount?: number;
  enrolledCount?: number;
  latestExam?: LatestExam | null;
  updatedByName?: string | null;
}

/**
 * #1175：班級的目錄參考價。改它等於改家長在目錄上看到的價錢，所以門檻跟價目表同一個
 * （`/api/fee-templates` 是 `all: 'manage_finance'`），不是班級本身的 `manage_courses`。
 * 範本要屬於本 org（c1）且仍在使用 —— 停用的價目表不再對外報價（同報名挑範本只看 active）。
 * `undefined`（沒帶 key）＝不動，回 null 放行。
 */
async function rejectDefaultFeeTemplate(
  c: Context<AppEnv>,
  templateId: string | null | undefined,
): Promise<
  | { status: 403; body: { error: string; code: 'FEE_TEMPLATE_FORBIDDEN' } }
  | { status: 400; body: { error: string; code: 'INVALID_FEE_TEMPLATE' } }
  | null
> {
  if (templateId === undefined) return null;
  if (!hasPermission(c.get('permissions') ?? [], 'manage_finance')) {
    return {
      status: 403,
      body: { error: '需要「財務管理」才能設定目錄參考價', code: 'FEE_TEMPLATE_FORBIDDEN' },
    };
  }
  if (templateId === null) return null;
  const { data } = await c
    .get('supabase')
    .from('fee_templates')
    .select('id')
    .eq('id', templateId)
    .eq('org_id', c.get('orgId'))
    .eq('is_active', true)
    .maybeSingle();
  return data
    ? null
    : { status: 400, body: { error: '價目範本不存在或已停用', code: 'INVALID_FEE_TEMPLATE' } };
}

export function mapClass(row: Record<string, unknown>, extras?: ClassExtras) {
  const course = row['courses'] as {
    name: string;
    grade_levels: string[];
    subjects?: { id: string; name: string | null } | null;
  } | null;

  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    campusId: row['campus_id'] as string,
    courseId: row['course_id'] as string,
    courseName: course?.name,
    subjectId: course?.subjects?.id ?? null,
    subjectName: course?.subjects?.name ?? null,
    campusName: (row['campuses'] as { name: string } | null)?.name,
    name: row['name'] as string,
    maxStudents: row['max_students'] as number,
    gradeLevels: course?.grade_levels ?? [],
    nextClassId: (row['next_class_id'] as string | null) ?? null,
    isActive: row['is_active'] as boolean,
    // 欄位是 NOT NULL DEFAULT false，但舊的 select 可能沒撈到 —— 退回 false 而不是
    // undefined，前端拿 undefined 去畫開關會變成不確定狀態
    usesContactBook: (row['uses_contact_book'] as boolean | undefined) ?? false,
    defaultFeeTemplateId: (row['default_fee_template_id'] as string | null | undefined) ?? null,
    isRecommended: (row['is_recommended'] as boolean | undefined) ?? false,
    // DB 是 NOT NULL DEFAULT true（Q5′）；沒撈到就照 DB 預設
    isPublicEnrollment: (row['is_public_enrollment'] as boolean | undefined) ?? true,
    scheduleCount: extras?.scheduleCount,
    scheduleTeacherIds: extras?.scheduleTeacherIds,
    hasUpcomingSessions: extras?.hasUpcomingSessions,
    hasPastSessions: extras?.hasPastSessions,
    upcomingCancelledCount: extras?.upcomingCancelledCount,
    upcomingUnassignedCount: extras?.upcomingUnassignedCount,
    upcomingClassConflictCount: extras?.upcomingClassConflictCount,
    upcomingTeacherConflictCount: extras?.upcomingTeacherConflictCount,
    enrolledCount: extras?.enrolledCount,
    latestExam: extras?.latestExam,
    schedules: extras?.schedules?.map((s) => mapSchedule(s as Record<string, unknown>)),
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    updatedBy: (row['updated_by'] as string | null) ?? null,
    updatedByName:
      extras?.updatedByName || (row['ba_user'] as { name: string } | null)?.name || null,
    startDate: (row['start_date'] as string | null) ?? null,
    endDate: (row['end_date'] as string | null) ?? null,
  };
}

function classAuditResourceName(row: Record<string, unknown> | null | undefined): string | null {
  return formatAuditClassResourceName({
    className: row?.['name'] as string | null | undefined,
    courseName: (row?.['courses'] as { name?: string } | null | undefined)?.name ?? null,
    campusName: (row?.['campuses'] as { name?: string } | null | undefined)?.name ?? null,
  });
}

export function applyClassDetailScheduleScope<
  T extends { eq: (column: string, value: unknown) => T },
>(query: T, classId: string): T {
  return query.eq('class_id', classId);
}

/**
 * 決策 5.5 的 uncancel 守衛（#499）：**哪些「要復課的補課」的目標已經被別人補走了。**
 *
 * 停課的補課要復課時，如果它補的那一堂**已經另外有一堂有效的補課**，復課會撞上
 * 部分唯一索引（`sessions_makeup_for_unique`）而變成 update 時的 500。
 * 這一道把它變成一筆看得懂的 `conflicts`。
 *
 * **排除條件跟索引述詞逐字一致** —— `WHERE makeup_for_session_id IS NOT NULL
 * AND status <> 'cancelled'`：**停掉的補課不佔位子**（索引也不擋），
 * 所以這裡擋了就是誤擋。
 *
 * 回傳 `要復課的 session id → 佔住目標的那堂 session id`，
 * 後者要放進 `conflictingSessionId` 讓使用者知道去解除哪一個連結。
 */
export function findCoveredMakeupTargets(
  targets: ReadonlyArray<{ id: string; makeup_for_session_id: string | null }>,
  siblings: ReadonlyArray<{ id: string; makeup_for_session_id: string | null; status: string }>,
): Map<string, string> {
  const covered = new Map<string, string>();

  for (const target of targets) {
    if (!target.makeup_for_session_id) continue;

    const holder = siblings.find(
      (sibling) =>
        sibling.makeup_for_session_id === target.makeup_for_session_id &&
        sibling.id !== target.id &&
        sibling.status !== 'cancelled',
    );

    if (holder) covered.set(target.id, holder.id);
  }

  return covered;
}

type BatchSessionConflictReason =
  | 'status_not_editable'
  | 'status_not_cancellable'
  | 'status_not_reopenable'
  | 'class_conflict'
  | 'teacher_conflict'
  | 'makeup_target_already_covered';

interface BatchSessionConflictItem {
  readonly sessionId: string;
  readonly sessionDate: string;
  readonly reason: BatchSessionConflictReason;
  readonly detail: string;
  readonly conflictingSessionId?: string;
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

/**
 * **寫入面的分校範圍（#1797）**：路徑帶班級 id 的寫入（改班、停用、刪除、時段 CRUD、產生／批次改課堂…）
 * 一律先比班級的分校 —— 只管 A 校的管理員改不到 B 校的班。讀取面早就套了 `applyCampusFilter`，
 * 唯獨這裡的寫入沒接（scores／sessions／class-logs 都有）。
 *
 * 掛成中介層而不是逐支加：之後新增的 `/{id}/…` 寫入自動被守住，不會有「新的那支忘了加」。
 * - 不受限（scope null）直接放行，不多查一次
 * - 範圍外 → 403（同 #1783 `campusForClassrooms`）；別 org 或不存在 → 交給路由自己回 404
 * - 路徑段不是 UUID（`/batch`、`/check-conflicts`）不是班級 id，放行 —— 那幾支在路由裡自己比
 *
 * **讀取面（#1800）**：`GET /{id}`、`GET /{id}/sessions/preview` 原本只守 org。同一支中介層也擋
 * GET，但範圍外回 **404**、body 跟路由的「班級不存在」一字不差 —— 讀取不洩漏「別校有這個班」；
 * 寫入回 403 是因為行政已經拿著 id 要動它，告訴他「沒權限」比「不存在」好排查。
 */
const CLASS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const classScopeGuard = createMiddleware<AppEnv>(async (c, next) => {
  const scope = getCampusScope(c);
  const id = c.req.param('id');
  if (scope === null || !id || !CLASS_ID.test(id)) return next();
  if ((await classWriteScope(c.get('supabase'), c.get('orgId'), scope, id)) === 'out-of-scope') {
    return c.req.method === 'GET'
      ? c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404)
      : c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
  }
  return next();
});
// `/:id/*` 也吃得到 `/:id` 本身（改班、刪班）—— 兩條都掛是多餘的，campus-scope-classes.spec 守著
app.use('/:id/*', classScopeGuard);

// GET /api/classes
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Classes'],
    summary: '取得班級列表',
    request: { query: QueryParamsSchema },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: ClassListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const query = c.req.valid('query');
    const page = Math.max(parseInt(query.page || '1'), 1);
    const rawPageSize = query.pageSize !== undefined ? parseInt(query.pageSize) : 50;
    const unpaginated = rawPageSize === 0;
    const pageSize = unpaginated ? 0 : Math.max(rawPageSize, 1);
    const offset = (page - 1) * pageSize;

    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(
      new Date(),
    );

    let dbQuery = supabase
      .from('classes')
      .select(
        '*, courses(name, grade_levels, subjects(id, name)), campuses(name), schedules(*, staff(display_name), classrooms(name)), ba_user!updated_by(name)',
        {
          count: 'exact',
        },
      )
      .eq('org_id', c.get('orgId'));

    if (query.search) dbQuery = dbQuery.ilike('name', `%${query.search}%`);
    dbQuery = applyCampusFilter(dbQuery, 'campus_id', getCampusScope(c), query.campusId);
    if (query.courseId) dbQuery = dbQuery.eq('course_id', query.courseId);
    if (query.isActive !== undefined) dbQuery = dbQuery.eq('is_active', query.isActive === 'true');

    // 歷史班級過濾：預設排除，includeHistorical=true 時拉全部（JS post-filter 處理日期範圍）
    if (query.includeHistorical !== 'true') {
      dbQuery = dbQuery.or(`end_date.is.null,end_date.gte.${todayStr}`);
    }

    dbQuery = dbQuery.order('created_at', { ascending: false });
    if (!unpaginated) dbQuery = dbQuery.range(offset, offset + pageSize - 1);

    const { data, count, error } = await dbQuery;
    if (error) console.error('DB Error:', error);

    let rows = data || [];

    if (query.includeHistorical === 'true' && (query.historicalFrom || query.historicalTo)) {
      const from = query.historicalFrom;
      const to = query.historicalTo;

      rows = rows.filter((row) => {
        const endDate = row['end_date'] as string | null;
        const startDate = row['start_date'] as string | null;
        const isHistorical = endDate != null && endDate < todayStr;

        if (!isHistorical) return true; // 現役班級永遠保留

        // 歷史班級：檢查有效期間是否與查詢範圍重疊
        if (from && endDate < from) return false;
        if (to && startDate != null && startDate > to) return false;
        return true;
      });
    }

    const classIds = rows.map((r) => r.id as string);

    // Batch-fetch schedule counts & teacher IDs for this page
    const scheduleCountMap: Record<string, number> = {};
    const scheduleTeacherMap: Record<string, string[]> = {};
    const hasUpcomingSet = new Set<string>();
    // TODO: 待老師點名功能完成後，改為查 status='completed'
    const hasPastSessionsSet = new Set<string>();
    const upcomingCancelledCountMap: Record<string, number> = {};
    const upcomingUnassignedCountMap: Record<string, number> = {};
    const upcomingClassConflictCountMap: Record<string, number> = {};
    const upcomingTeacherConflictCountMap: Record<string, number> = {};
    const enrolledCountMap: Record<string, number> = {};
    let latestExamMap: Map<string, LatestExam | null> | null = null;

    if (classIds.length > 0) {
      // 台北時間，不是 UTC —— 見 lib/taipei-date.ts 檔頭。這個變數同時餵給下面
      // 兩支「即將到來」查詢（477 行附近與 upcomingCancelledResult），不要各自
      // 重算一次，免得兩處又各自漂移一次。
      const today = getCurrentTaipeiDateString();
      // #949：三支都只依賴 classIds，彼此互不相依 —— 同一輪發出去
      // （原本依序發四支，第四支是下面註解說的 any-sessions，已刪）。
      const [
        sessionsResult,
        pastSessionsCheck,
        upcomingCancelledResult,
        enrollmentsResult,
        latestExams,
      ] = await Promise.all([
        supabase
          .from('sessions')
          .select('id, class_id, session_date, start_time, end_time, teacher_id')
          .in('class_id', classIds)
          .gte('session_date', today)
          .eq('status', 'scheduled'),
        // TODO: 待老師點名功能完成後，改為查 status='completed'
        // 顯示用，查詢失敗時退回空集合（跟現況一致）——刪除守門那份 fail closed，
        // 見 lib/class-past-sessions.ts 檔頭說明兩者為什麼不同。
        checkClassesPastSessions(supabase, classIds),
        supabase
          .from('sessions')
          .select('class_id')
          .in('class_id', classIds)
          .gte('session_date', today)
          .eq('status', 'cancelled'),
        // 在籍人數（A6「17／24 人」）：只撈本頁班級的在籍報名，在記憶體裡用 `countEnrolledOn`
        // 數 —— 跟課堂名單、點名同一份「某天在不在籍」的規則（`lib/session-roster.ts`）
        supabase
          .from('enrollments')
          .select('class_id, effective_from, effective_to')
          .in('class_id', classIds)
          .eq('status', 'active')
          .eq('org_id', c.get('orgId')),
        loadLatestExams(supabase, c.get('orgId'), classIds),
      ]);
      latestExamMap = latestExams;

      const enrollmentRanges: EnrollmentRange[] = (
        (enrollmentsResult.data ?? []) as Array<Record<string, unknown>>
      ).map((r) => ({
        classId: r['class_id'] as string,
        effectiveFrom: r['effective_from'] as string,
        effectiveTo: (r['effective_to'] as string | null) ?? null,
      }));
      // 查詢失敗就不回人數（前端退回「上限 N 人」）—— 回 0 會把「查不到」說成「沒有人」
      if (!enrollmentsResult.error) {
        for (const id of classIds) {
          enrolledCountMap[id] = countEnrolledOn(enrollmentRanges, id, today);
        }
      }

      for (const s of sessionsResult.data || []) {
        const classId = s.class_id as string;
        hasUpcomingSet.add(classId);
        if (!s.teacher_id) {
          upcomingUnassignedCountMap[classId] = (upcomingUnassignedCountMap[classId] ?? 0) + 1;
        }
      }

      const upcomingSessions =
        (sessionsResult.data as Array<{
          id: string;
          class_id: string;
          session_date: string;
          start_time: string;
          end_time: string;
          teacher_id: string | null;
        }> | null) ?? [];

      const classDateBuckets = new Map<string, typeof upcomingSessions>();
      for (const session of upcomingSessions) {
        const bucketKey = `${session.class_id}|${session.session_date}`;
        const bucket = classDateBuckets.get(bucketKey) ?? [];
        bucket.push(session);
        classDateBuckets.set(bucketKey, bucket);
      }

      for (const sessions of classDateBuckets.values()) {
        sessions.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
        for (let i = 0; i < sessions.length; i++) {
          for (let j = i + 1; j < sessions.length; j++) {
            if (
              isTimeOverlap(
                normalizeTime(sessions[i].start_time),
                normalizeTime(sessions[i].end_time),
                normalizeTime(sessions[j].start_time),
                normalizeTime(sessions[j].end_time),
              )
            ) {
              const classId = sessions[i].class_id;
              upcomingClassConflictCountMap[classId] =
                (upcomingClassConflictCountMap[classId] ?? 0) + 1;
            } else {
              break;
            }
          }
        }
      }

      const teacherDateBuckets = new Map<string, typeof upcomingSessions>();
      for (const session of upcomingSessions) {
        if (!session.teacher_id) continue;
        const bucketKey = `${session.teacher_id}|${session.session_date}`;
        const bucket = teacherDateBuckets.get(bucketKey) ?? [];
        bucket.push(session);
        teacherDateBuckets.set(bucketKey, bucket);
      }

      for (const sessions of teacherDateBuckets.values()) {
        sessions.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
        for (let i = 0; i < sessions.length; i++) {
          for (let j = i + 1; j < sessions.length; j++) {
            if (
              isTimeOverlap(
                normalizeTime(sessions[i].start_time),
                normalizeTime(sessions[i].end_time),
                normalizeTime(sessions[j].start_time),
                normalizeTime(sessions[j].end_time),
              )
            ) {
              const classIdA = sessions[i].class_id;
              const classIdB = sessions[j].class_id;
              upcomingTeacherConflictCountMap[classIdA] =
                (upcomingTeacherConflictCountMap[classIdA] ?? 0) + 1;
              upcomingTeacherConflictCountMap[classIdB] =
                (upcomingTeacherConflictCountMap[classIdB] ?? 0) + 1;
            } else {
              break;
            }
          }
        }
      }

      if (pastSessionsCheck.status === 'ok') {
        for (const classId of pastSessionsCheck.classIdsWithPastSessions) {
          hasPastSessionsSet.add(classId);
        }
      }

      for (const s of upcomingCancelledResult.data || []) {
        const classId = s.class_id as string;
        upcomingCancelledCountMap[classId] = (upcomingCancelledCountMap[classId] ?? 0) + 1;
      }
    }

    // 有 JS post-filter 時，DB count 會不准，改用 rows.length
    const effectiveTotal =
      query.includeHistorical === 'true' && (query.historicalFrom || query.historicalTo)
        ? rows.length
        : (count ?? 0);

    const listToday = getCurrentTaipeiDateString();
    return c.json({
      data: rows.map((r) => {
        const id = r.id as string;
        const allSchedules = (r['schedules'] as Record<string, unknown>[]) || [];
        // #1100 #22：列表的時段（摘要、時段數）看「那天」有效的 —— 今天，還沒開課的班看開課日
        // （不然下個月才開的班會變成「沒有時段」）。老師篩選沒有日期脈絡，照 Q3 看今天有效或未來有效
        const startDate = (r['start_date'] as string | null) ?? null;
        const asOf = startDate && startDate > listToday ? startDate : listToday;
        const schedules = allSchedules.filter((s) =>
          isScheduleEffectiveOn(scheduleRangeOf(s), asOf),
        );
        return mapClass(r as Record<string, unknown>, {
          schedules,
          scheduleCount: schedules.length,
          scheduleTeacherIds: allSchedules
            .filter((s) => isScheduleCurrentOrUpcoming(scheduleRangeOf(s), listToday))
            .map((s) => s['teacher_id'] as string | null)
            .filter((tid): tid is string => !!tid),
          hasUpcomingSessions: hasUpcomingSet.has(id),
          hasPastSessions: hasPastSessionsSet.has(id),
          upcomingCancelledCount: upcomingCancelledCountMap[id] ?? 0,
          upcomingUnassignedCount: upcomingUnassignedCountMap[id] ?? 0,
          upcomingClassConflictCount: upcomingClassConflictCountMap[id] ?? 0,
          upcomingTeacherConflictCount: upcomingTeacherConflictCountMap[id] ?? 0,
          enrolledCount: enrolledCountMap[id],
          latestExam: latestExamMap ? (latestExamMap.get(id) ?? null) : undefined,
        });
      }),
      meta: {
        total: effectiveTotal,
        page: unpaginated ? 1 : page,
        pageSize: unpaginated ? effectiveTotal : pageSize,
        totalPages: unpaginated ? 1 : Math.ceil(effectiveTotal / pageSize),
      },
    });
  },
);

// POST /api/classes/check-conflicts
// 注意：必須在所有 /{id} 路由之前定義，否則 check-conflicts 會被當成 :id
app.openapi(
  createRoute({
    method: 'post',
    path: '/check-conflicts',
    tags: ['Classes'],
    summary: '排課衝突預檢（soft check，不阻擋儲存）',
    request: {
      body: { content: { 'application/json': { schema: CheckConflictsRequestSchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({ conflicts: z.array(ScheduleConflictItemSchema) }),
          },
        },
      },
      500: { description: '讀取失敗（#1928：不再當成「沒有衝突」回 200）' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { schedules, excludeClassId } = c.req.valid('json');

    const schedulesToCheck = schedules.filter((s) => s.teacherId != null);
    if (schedulesToCheck.length === 0) {
      return c.json({ conflicts: [] }, 200);
    }

    const teacherIds = [...new Set(schedulesToCheck.map((s) => s.teacherId as string))];

    // 這些老師在本 org 的所有時段。**org 範圍在 join 裡套**（`classes!inner` ＋ `classes.org_id`，#1928）——
    // 原本先撈整個 org 歷年所有班級 id 再塞回 `.in('class_id', …)`：班一多網址太長 → 414，
    // 而且那份清單本身也被 max_rows（1000）截斷。老師 id 只有表單上那幾位，`.in` 很短。
    let query = supabase
      .from('schedules')
      .select('*, staff(display_name), classes!inner(org_id, name, courses(name))')
      .eq('classes.org_id', orgId)
      .in('teacher_id', teacherIds);
    if (excludeClassId) query = query.neq('class_id', excludeClassId);
    const { data: existingSchedules, error } = await query;

    if (error) {
      console.error('check-conflicts DB error:', error);
      return c.json({ error: '讀取時段失敗', code: 'DB_ERROR' }, 500);
    }

    type ConflictItem = {
      scheduleIndex: number;
      teacherName: string;
      conflictingClassId: string;
      conflictingClassName: string;
      conflictingCourseName: string;
      conflictingWeekday: number;
      conflictingStartTime: string;
      conflictingEndTime: string;
    };

    const conflicts: ConflictItem[] = [];

    for (let i = 0; i < schedules.length; i++) {
      const s = schedules[i];
      if (!s.teacherId) continue;

      const sStart = s.startTime.substring(0, 5);
      const sEnd = s.endTime.substring(0, 5);

      for (const existing of existingSchedules || []) {
        if (existing.teacher_id !== s.teacherId) continue;
        if (existing.weekday !== s.weekday) continue;

        // 時間重疊：兩段 [s1,e1) 與 [s2,e2) 重疊條件 = s1 < e2 && s2 < e1
        const eStart = (existing.start_time as string).substring(0, 5);
        const eEnd = (existing.end_time as string).substring(0, 5);
        if (sStart >= eEnd || eStart >= sEnd) continue;

        // 生效期間也要有交集才算衝突（#1100 #22；原本算了 sTo／eTo 卻沒用到，已經結束的舊時段也報衝突）
        const sFrom = s.effectiveFrom ?? null;
        const sTo = s.effectiveTo ?? null;
        if (!scheduleOverlaps(scheduleRangeOf(existing), sFrom, sTo)) continue;

        const clsData = existing.classes as {
          name: string;
          courses: { name: string } | null;
        } | null;
        const teacherData = existing.staff as { display_name: string } | null;

        conflicts.push({
          scheduleIndex: i,
          teacherName: teacherData?.display_name ?? '未知老師',
          conflictingClassId: existing.class_id as string,
          conflictingClassName: clsData?.name ?? '未知班級',
          conflictingCourseName: clsData?.courses?.name ?? '未知課程',
          conflictingWeekday: existing.weekday as number,
          conflictingStartTime: existing.start_time as string,
          conflictingEndTime: existing.end_time as string,
        });
      }
    }

    return c.json({ conflicts }, 200);
  },
);

// PATCH /api/classes/batch-set-active
app.openapi(
  createRoute({
    method: 'patch',
    path: '/batch-set-active',
    tags: ['Classes'],
    summary: '批次啟用/停用班級',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({ ids: z.array(DbUuidSchema), isActive: z.boolean() }),
          },
        },
      },
    },
    responses: {
      403: {
        description: '不在分校範圍（#1797）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ updated: z.number() }) } },
      },
      404: {
        description: '有班級不存在（含別 org 的 id）—— 整批不動',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { ids, isActive } = c.req.valid('json');
    if (ids.length === 0) return c.json({ updated: 0 }, 200);

    // 任何一個 id 不屬於本 org → 整批 404，不略過（c1，#966 B2）
    if ((await missingInOrg(supabase, 'classes', orgId, ids)).length > 0) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }
    // 任何一個不在分校範圍 → 整批 403，不略過（#1797；id 在 body 裡，路徑中介層看不到）
    const scope = getCampusScope(c);
    if (scope !== null) {
      const { data: rows, error: scopeError } = await supabase
        .from('classes')
        .select('campus_id')
        .eq('org_id', orgId)
        .in('id', ids);
      if (scopeError) throw new Error(`batch-set-active scope failed: ${scopeError.message}`);
      if ((rows ?? []).some((r) => !scope.includes(r['campus_id'] as string))) {
        return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
      }
    }

    const { data, error } = await inOrg(
      supabase.from('classes').update({ is_active: isActive, updated_by: userId }).in('id', ids),
      orgId,
    ).select('id');

    if (error) return c.json({ updated: 0 }, 200);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        action: isActive ? 'batch_activate' : 'batch_deactivate',
        details: { count: ids.length },
      },
      waitUntilFrom(c),
    );

    return c.json({ updated: data?.length ?? 0 }, 200);
  },
);

interface ClassDeleteFailure {
  readonly http: 404 | 409 | 500;
  readonly body: { error: string; code: string; classIds?: string[] };
}

/**
 * 刪班級的交易入口（#1652）：拿這個請求的 pg 池、帶 org 與分校範圍，把「什麼都沒動」的結果對成 HTTP。
 * **池不在就 500，不退回舊的 PostgREST 逐步刪** —— 那條就是沒有交易、會刪一半的 bug 本身。
 */
async function deleteClassesForRequest(
  c: Context<AppEnv>,
  ids: readonly string[],
  onBlocked: 'abort' | 'skip',
): Promise<Extract<ClassDeleteOutcome, { status: 'done' }> | ClassDeleteFailure> {
  const pool = getAuth(c).pool;
  if (!pool) return { http: 500, body: { error: '刪除班級失敗', code: 'DB_POOL_UNAVAILABLE' } };
  let result: ClassDeleteOutcome;
  try {
    result = await deleteClasses(pool, {
      orgId: c.get('orgId'),
      ids,
      scope: getCampusScope(c),
      onBlocked,
    });
  } catch (err) {
    console.error('[classes] delete transaction failed:', err);
    return { http: 500, body: { error: '刪除班級失敗', code: 'DB_ERROR' } };
  }
  switch (result.status) {
    case 'done':
      return result;
    case 'not-found':
      return { http: 404, body: { error: '班級不存在', code: 'NOT_FOUND' } };
    case 'has-invoice-items':
      return {
        http: 409,
        body: {
          error: '這個班已經有帳單，不能刪除，請改為停用',
          code: 'HAS_INVOICE_ITEMS',
          classIds: result.classIds,
        },
      };
    case 'in-use':
      return { http: 409, body: { error: '班級還有其他資料引用，無法刪除', code: 'IN_USE' } };
  }
}

// DELETE /api/classes/batch
app.openapi(
  createRoute({
    method: 'delete',
    path: '/batch',
    tags: ['Classes'],
    summary: '批次刪除班級（有歷史課堂或堂數包的略過；有帳單整批擋）',
    request: {
      body: {
        content: {
          'application/json': { schema: z.object({ ids: z.array(DbUuidSchema) }) },
        },
      },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              deleted: z.number(),
              deletedIds: z.array(z.string()),
              skipped: z.number(),
            }),
          },
        },
      },
      404: {
        description: '有班級不存在或不在分校範圍（含別 org 的 id）—— 整批不動',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '有班級已有帳單明細（HAS_INVOICE_ITEMS，body 帶 classIds）—— 整批不動',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: '交易失敗 —— 整批不動',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { ids } = c.req.valid('json');
    if (ids.length === 0) return c.json({ deleted: 0, deletedIds: [], skipped: 0 }, 200);

    // 範圍、守門、刪除全在同一個交易裡，跟單筆共用（#1652，見 lib/class-delete.ts）：
    // 任何一個 id 不在 org／分校範圍 → 整批 404（c1，#966 B2）；有帳單明細 → 整批 409；
    // 有過去課堂或堂數包的班略過。
    const result = await deleteClassesForRequest(c, ids, 'skip');
    if ('http' in result) {
      if (result.http === 404) return c.json(result.body, 404);
      if (result.http === 409) return c.json(result.body, 409);
      return c.json(result.body, 500);
    }
    const toDeleteIds = result.deletedIds;
    const skipped = ids.length - toDeleteIds.length;
    if (toDeleteIds.length === 0) {
      return c.json({ deleted: 0, deletedIds: [], skipped }, 200);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        action: 'batch_delete',
        details: { count: toDeleteIds.length },
      },
      waitUntilFrom(c),
    );

    return c.json({ deleted: toDeleteIds.length, deletedIds: toDeleteIds, skipped }, 200);
  },
);

// GET /api/classes/:id（含 schedules）
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Classes'],
    summary: '取得單一班級（含上課時間）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const classQuery = supabase
      .from('classes')
      .select(
        '*, courses(name, grade_levels, subjects(id, name)), campuses(name), ba_user!updated_by(name)',
      )
      .eq('id', id)
      .eq('org_id', orgId)
      .single();
    const scheduleQuery = applyClassDetailScheduleScope(
      supabase.from('schedules').select('*, staff(display_name), classrooms(name)') as any,
      id,
    ) as any;

    const [classResult, schedulesResult] = await Promise.all([classQuery, scheduleQuery]);

    if (classResult.error || !classResult.data) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    // 最後修改者的姓名（#1839：原本讀 profiles，那張表已經沒有人寫，新的人一律是 null）
    const updatedByUserId = classResult.data.updated_by as string | null;
    const updatedByName = updatedByUserId
      ? await loadDisplayName(supabase, orgId, updatedByUserId)
      : null;

    return c.json(
      {
        data: mapClass(classResult.data as Record<string, unknown>, {
          schedules: schedulesResult.data || [],
          updatedByName,
        }),
      },
      200,
    );
  },
);

// POST /api/classes
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Classes'],
    summary: '新增班級',
    request: {
      body: { content: { 'application/json': { schema: CreateClassSchema } } },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      400: {
        description: '驗證錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: '設定目錄參考價需要 manage_finance（#1175）；或課程不在分校範圍（#1797）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '班名重複',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // 從 course 取得 campus_id 與啟用狀態
    const { data: course } = await supabase
      .from('courses')
      .select('campus_id, is_active')
      .eq('id', body.courseId)
      .eq('org_id', orgId)
      .single();

    if (!course) {
      return c.json({ error: '課程不存在', code: 'COURSE_NOT_FOUND' }, 400);
    }
    // 新班開在課程的分校：受限者只能在自己的分校開班（#1797）
    if (!resourceCampusAllowed(getCampusScope(c), course.campus_id as string | null)) {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }
    if (!(course.is_active as boolean)) {
      return c.json({ error: '課程已停用，無法新增班級', code: 'COURSE_INACTIVE' }, 409);
    }
    const feeRejection = await rejectDefaultFeeTemplate(c, body.defaultFeeTemplateId);
    if (feeRejection?.status === 403) return c.json(feeRejection.body, 403);
    if (feeRejection?.status === 400) return c.json(feeRejection.body, 400);

    const { data, error } = await supabase
      .from('classes')
      .insert({
        org_id: orgId,
        campus_id: course.campus_id,
        course_id: body.courseId,
        name: body.name,
        max_students: body.maxStudents ?? 20,
        next_class_id: body.nextClassId ?? null,
        default_fee_template_id: body.defaultFeeTemplateId ?? null,
        ...(body.isRecommended === undefined ? {} : { is_recommended: body.isRecommended }),
        ...(body.isPublicEnrollment === undefined
          ? {}
          : { is_public_enrollment: body.isPublicEnrollment }),
        ...(body.usesContactBook === undefined ? {} : { uses_contact_book: body.usesContactBook }),
        start_date: body.startDate ?? null,
        end_date: body.endDate ?? null,
        updated_by: userId,
      })
      .select('*, courses(name, grade_levels, subjects(id, name)), campuses(name)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: '此課程已有同名班級', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceId: data.id as string,
        resourceName: classAuditResourceName(data as Record<string, unknown>),
        action: 'create',
      },
      waitUntilFrom(c),
    );

    return c.json({ data: mapClass(data as Record<string, unknown>, {}) }, 201);
  },
);

// PUT /api/classes/:id
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Classes'],
    summary: '更新班級',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: UpdateClassSchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      400: {
        description: '價目範本不存在或已停用（#1175）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: '設定目錄參考價需要 manage_finance（#1175）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    // 班級本身與 body 指名的下一期班級都要屬於本 org（c1，#966 B2）
    const [current, nextClass] = await Promise.all([
      findInOrg(supabase, 'classes', orgId, id),
      body.nextClassId ? findInOrg(supabase, 'classes', orgId, body.nextClassId) : null,
    ]);
    if (!current || (body.nextClassId && !nextClass)) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const feeRejection = await rejectDefaultFeeTemplate(c, body.defaultFeeTemplateId);
    if (feeRejection?.status === 403) return c.json(feeRejection.body, 403);
    if (feeRejection?.status === 400) return c.json(feeRejection.body, 400);

    const updateData: Record<string, unknown> = { updated_by: userId };
    if (body.defaultFeeTemplateId !== undefined) {
      updateData['default_fee_template_id'] = body.defaultFeeTemplateId;
    }
    if (body.name !== undefined) updateData['name'] = body.name;
    if (body.maxStudents !== undefined) updateData['max_students'] = body.maxStudents;
    if (body.nextClassId !== undefined) updateData['next_class_id'] = body.nextClassId;
    if (body.isActive !== undefined) updateData['is_active'] = body.isActive;
    if (body.usesContactBook !== undefined) updateData['uses_contact_book'] = body.usesContactBook;
    if (body.isRecommended !== undefined) updateData['is_recommended'] = body.isRecommended;
    if (body.isPublicEnrollment !== undefined) {
      updateData['is_public_enrollment'] = body.isPublicEnrollment;
    }
    if (body.startDate !== undefined) updateData['start_date'] = body.startDate;
    if (body.endDate !== undefined) updateData['end_date'] = body.endDate;

    const { data, error } = await inOrg(
      supabase.from('classes').update(updateData).eq('id', id),
      orgId,
    )
      .select('*, courses(name, grade_levels, subjects(id, name)), campuses(name)')
      .single();

    if (error || !data) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceId: id,
        resourceName: classAuditResourceName(data as Record<string, unknown>),
        action: 'update',
      },
      waitUntilFrom(c),
    );

    return c.json({ data: mapClass(data as Record<string, unknown>, {}) }, 200);
  },
);

// PATCH /api/classes/:id/toggle-active
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/toggle-active',
    tags: ['Classes'],
    summary: '切換班級啟用/停用',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    // 別 org 的 id 跟不存在一樣回 404（c1，#966 B2）
    const current = await findInOrg(supabase, 'classes', orgId, id, 'is_active');

    if (!current) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data, error } = await inOrg(
      supabase
        .from('classes')
        .update({ is_active: !current['is_active'], updated_by: userId })
        .eq('id', id),
      orgId,
    )
      .select('*, courses(name, grade_levels, subjects(id, name)), campuses(name)')
      .single();

    if (error || !data) {
      return c.json({ error: '更新失敗', code: 'UPDATE_FAILED' }, 404);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceId: id,
        resourceName: classAuditResourceName(data as Record<string, unknown>),
        action: 'toggle_active',
        details: { isActive: !current['is_active'] },
      },
      waitUntilFrom(c),
    );

    return c.json({ data: mapClass(data as Record<string, unknown>, {}) }, 200);
  },
);

// DELETE /api/classes/:id
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Classes'],
    summary: '刪除班級（無過去課堂、堂數包、帳單才可刪）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '已有過去課堂、堂數包或帳單明細（HAS_INVOICE_ITEMS），無法刪除',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: '交易失敗 —— 什麼都沒刪（fail closed）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    // 刪之前先讀（稽核要名字），同時是 org 範圍的存在檢查 —— 排在所有守門查詢之前，
    // 否則別 org 的 id 會先拿到 409，等於告訴對方「這個班有歷史課堂」（c1，#966 B2）
    const existing = await findInOrg(
      supabase,
      'classes',
      orgId,
      id,
      'name, courses(name), campuses(name)',
    );
    if (!existing) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    // 範圍、守門、刪除全在同一個交易裡（#1652，見 lib/class-delete.ts）。上面那次讀只為了稽核的名字，
    // 不是權威 —— 交易裡會用 FOR UPDATE 重做 org／分校範圍判斷。
    const result = await deleteClassesForRequest(c, [id], 'abort');
    if ('http' in result) {
      if (result.http === 404) return c.json(result.body, 404);
      if (result.http === 409) return c.json(result.body, 409);
      return c.json(result.body, 500);
    }
    if (result.pastSessionIds.length > 0) {
      return c.json(
        { error: '此班級已有歷史課堂記錄，無法刪除，請改為停用', code: 'HAS_PAST_SESSIONS' },
        409,
      );
    }
    if (result.sessionPackIds.length > 0) {
      return c.json(
        { error: '此班級已有學生購買堂數包，無法刪除，請改為停用', code: 'HAS_SESSION_PACK' },
        409,
      );
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceId: id,
        resourceName: classAuditResourceName(existing),
        action: 'delete',
      },
      waitUntilFrom(c),
    );

    return c.json({ success: true }, 200);
  },
);

// POST /api/classes/:id/schedules
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/schedules',
    tags: ['Classes'],
    summary: '新增上課時間',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: CreateScheduleSchema } } },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ScheduleSchema }) } },
      },
      400: {
        description: '驗證錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '時段重複，或教室不在這個班級的分校（CLASSROOM_CAMPUS_MISMATCH）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    // `schedules` 沒有 org_id 欄位，要驗的是父班級屬於本 org（c1，#966 B2）
    const cls = await findInOrg(
      supabase,
      'classes',
      orgId,
      id,
      'name, campus_id, courses(name), campuses(name)',
    );
    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    // 指名的老師要屬於本 org（c1，#966 B5a）。任課資格（分校／科目）是 #854 的另一題，不在這裡
    if (body.teacherId && !(await findInOrg(supabase, 'staff', orgId, body.teacherId))) {
      return c.json({ error: '老師不存在', code: 'TEACHER_NOT_FOUND' }, 404);
    }
    if (body.classroomId) {
      const problem = await classroomProblem(
        supabase,
        orgId,
        (cls['campus_id'] as string | null) ?? null,
        body.classroomId,
      );
      if (problem) return c.json({ error: problem.error, code: problem.code }, problem.status);
    }

    const { data, error } = await supabase
      .from('schedules')
      .insert({
        class_id: id,
        weekday: body.weekday,
        start_time: body.startTime,
        end_time: body.endTime,
        teacher_id: body.teacherId ?? null,
        effective_to: body.effectiveTo ?? null,
        classroom_id: body.classroomId ?? null,
      })
      .select('*, staff(display_name), classrooms(name)')
      .single();

    if (error) {
      // 23505：舊的唯一鍵；23P01：#1100 #22 換成的排除約束（同時段生效區間重疊）
      if (error.code === '23505' || error.code === '23P01') {
        return c.json({ error: '此時段已存在', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceId: id,
        resourceName: classAuditResourceName(cls),
        action: 'add_schedule',
        details: {
          weekday: body.weekday,
          startTime: body.startTime,
          endTime: body.endTime,
          classroomId: body.classroomId ?? null,
        },
      },
      waitUntilFrom(c),
    );

    return c.json({ data: mapSchedule(data as Record<string, unknown>) }, 201);
  },
);

// PUT /api/classes/:id/schedules/:sid
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}/schedules/{sid}',
    tags: ['Classes'],
    summary: '更新上課時間',
    request: {
      params: z.object({ id: DbUuidSchema, sid: DbUuidSchema }),
      body: { content: { 'application/json': { schema: CreateScheduleSchema.partial() } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ScheduleSchema }) } },
      },
      400: {
        description: 'DB 錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description:
          '這位老師未被指派到本分校或科目（#854，跟代課同一個錯誤碼）；或教室不在這個班級的分校（CLASSROOM_CAMPUS_MISMATCH，#1796）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id, sid } = c.req.valid('param');
    const body = c.req.valid('json');

    // `schedules` 沒有 org_id 欄位，要驗的是父班級屬於本 org（c1，#966 B2）
    const cls = await findInOrg(supabase, 'classes', orgId, id, 'campus_id');
    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    /**
     * **#854：排課指定任課老師要驗分校與科目，跟代課同一個判準、同一個錯誤碼。**
     *
     * 原本這裡完全不驗，而代課（409）與批次指派（skip）都驗 —— 三處讀同一張表、一處漏。
     * 後果：A 校老師被排進 B 校的課，**那堂課從此找不到代課老師**，而畫面上一切正常。
     *
     * ⚠️ **只在 `teacherId` 真的變動時驗。** 前端的排課對話框把既有 `teacherId`
     * 原封不動送回來（它的老師下拉在 D4 已被移除），所以「改個上課時間」也會帶著舊老師。
     * 不分變動與否一律驗的話，**歷史資料裡任何一筆不合格的排課會從此無法編輯**
     * —— 那不是擋，那是鎖死（#854 的邊界「既有已排的不回溯」真正的含意）。
     */
    const { data: existingSchedule } = await supabase
      .from('schedules')
      .select('id, class_id, teacher_id, classroom_id')
      .eq('id', sid)
      .eq('class_id', id)
      .maybeSingle();

    const nextTeacherId = body.teacherId;
    const teacherChanged =
      nextTeacherId !== undefined &&
      nextTeacherId !== ((existingSchedule?.['teacher_id'] as string | null) ?? null);

    // `null` 是取消指派 —— 沒有人要驗資格
    if (teacherChanged && nextTeacherId) {
      const { data: classRow } = await supabase
        .from('classes')
        .select('id, campus_id, course_id')
        .eq('org_id', orgId)
        .eq('id', id)
        .maybeSingle();
      const { data: courseRow } = await supabase
        .from('courses')
        .select('subject_id')
        .eq('org_id', orgId)
        .eq('id', (classRow?.['course_id'] as string | undefined) ?? '')
        .maybeSingle();

      const campusId = classRow?.['campus_id'] as string | undefined;
      const subjectId = courseRow?.['subject_id'] as string | undefined;

      if (!campusId || !subjectId) {
        return c.json(
          { error: '這個班級缺少分校或科目設定，無法指派老師', code: 'TEACHER_NOT_ELIGIBLE' },
          409,
        );
      }

      const eligibility = await checkTeacherEligibility(supabase, {
        staffId: nextTeacherId,
        orgId,
        campusId,
        subjectId,
      });

      if (!eligibility.eligible) {
        if ('dbError' in eligibility) {
          return c.json({ error: eligibility.dbError, code: 'DB_ERROR' }, 400);
        }
        return c.json({ error: eligibility.reason, code: 'TEACHER_NOT_ELIGIBLE' }, 409);
      }
    }

    // 教室同老師：**只在真的換了才驗**。前端把既有 classroomId 原封送回，班級後來換了分校的話，
    // 一律驗會讓那筆時段從此改不動（同上面 #854 的理由）；null 是改回不指定，不用驗
    const classroomChanged =
      body.classroomId !== undefined &&
      body.classroomId !== ((existingSchedule?.['classroom_id'] as string | null) ?? null);
    if (classroomChanged && body.classroomId) {
      const problem = await classroomProblem(
        supabase,
        orgId,
        (cls['campus_id'] as string | null) ?? null,
        body.classroomId,
      );
      if (problem) return c.json({ error: problem.error, code: problem.code }, problem.status);
    }

    const updateData: Record<string, unknown> = {};
    if (body.weekday !== undefined) updateData['weekday'] = body.weekday;
    if (body.startTime !== undefined) updateData['start_time'] = body.startTime;
    if (body.endTime !== undefined) updateData['end_time'] = body.endTime;
    if (body.teacherId !== undefined) updateData['teacher_id'] = body.teacherId;
    if (body.effectiveTo !== undefined) updateData['effective_to'] = body.effectiveTo;
    if (body.classroomId !== undefined) updateData['classroom_id'] = body.classroomId;

    const { data, error } = await supabase
      .from('schedules')
      .update(updateData)
      .eq('id', sid)
      .eq('class_id', id)
      .select('*, staff(display_name), classrooms(name)')
      .single();

    if (error || !data) {
      return c.json({ error: '時段不存在', code: 'NOT_FOUND' }, 404);
    }

    return c.json({ data: mapSchedule(data as Record<string, unknown>) }, 200);
  },
);

// DELETE /api/classes/:id/schedules/:sid
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/schedules/{sid}',
    tags: ['Classes'],
    summary: '刪除上課時間',
    request: { params: z.object({ id: DbUuidSchema, sid: DbUuidSchema }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id, sid } = c.req.valid('param');

    // `schedules` 沒有 org_id 欄位，要驗的是父班級屬於本 org（c1，#966 B2）
    const cls = await findInOrg(
      supabase,
      'classes',
      orgId,
      id,
      'name, courses(name), campuses(name)',
    );
    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { error } = await supabase.from('schedules').delete().eq('id', sid).eq('class_id', id);

    if (error) {
      return c.json({ error: '時段不存在', code: 'NOT_FOUND' }, 404);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceId: id,
        resourceName: classAuditResourceName(cls),
        action: 'delete_schedule',
      },
      waitUntilFrom(c),
    );

    return c.json({ success: true }, 200);
  },
);

// GET /api/classes/:id/sessions/preview
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/sessions/preview',
    tags: ['Classes'],
    summary: '預覽將產生的課堂',
    request: {
      params: z.object({ id: DbUuidSchema }),
      query: z.object({
        from: z.string(),
        to: z.string(),
        excludeDates: z.string().optional(),
        includeUnassigned: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': { schema: z.object({ data: z.array(SessionPreviewSchema) }) },
        },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '班級或課程已停用',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: {
        description: '參數錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const { from, to, excludeDates, includeUnassigned } = c.req.valid('query');

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
      return c.json({ error: '無效日期格式', code: 'INVALID_DATE' }, 400);
    }

    const includeUnassignedValue = includeUnassigned !== 'false';
    const excludeSet = new Set(excludeDates ? excludeDates.split(',').filter(Boolean) : []);

    const { data: cls, error: clsError } = await supabase
      .from('classes')
      .select('id, is_active, courses(id, is_active)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (clsError) {
      return c.json({ error: clsError.message, code: 'DB_ERROR' }, 400);
    }
    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }
    if (!(cls.is_active as boolean)) {
      return c.json({ error: '班級已停用，無法新增未來課程排程', code: 'CLASS_INACTIVE' }, 409);
    }
    const linkedCourseRaw = cls.courses as
      | { id?: string; is_active?: boolean | null }
      | Array<{ id?: string; is_active?: boolean | null }>
      | null;
    const linkedCourse = Array.isArray(linkedCourseRaw) ? linkedCourseRaw[0] : linkedCourseRaw;
    if (linkedCourse && linkedCourse.is_active === false) {
      return c.json({ error: '課程已停用，無法新增未來課程排程', code: 'COURSE_INACTIVE' }, 409);
    }

    const { data: schedules } = await supabase
      .from('schedules')
      .select('*, staff(display_name)')
      .eq('class_id', id);

    if (!schedules || schedules.length === 0) {
      return c.json({ data: [] }, 200);
    }

    const { data: existingSessions } = await supabase
      .from('sessions')
      .select('session_date, start_time')
      .eq('class_id', id)
      .gte('session_date', from)
      .lte('session_date', to);

    const existingSet = new Set(
      (existingSessions || []).map(
        (s: { session_date: string; start_time: string }) =>
          `${s.session_date}|${normalizeTime(s.start_time)}`,
      ),
    );

    const plan = buildSessionGenerationPlan({
      orgId: c.get('orgId'),
      classId: id,
      from,
      to,
      includeUnassigned: includeUnassignedValue,
      schedules: (schedules || []).map((schedule) => ({
        id: schedule.id as string,
        weekday: schedule.weekday as number,
        startTime: schedule.start_time as string,
        endTime: schedule.end_time as string,
        teacherId: (schedule.teacher_id as string | null) ?? null,
        teacherName: (schedule.staff as { display_name: string } | null)?.display_name,
        effectiveFrom: schedule.effective_from as string,
        effectiveTo: (schedule.effective_to as string | null) ?? null,
      })),
      existingKeys: existingSet,
      excludeDates: excludeSet,
    });

    return c.json({ data: plan.preview }, 200);
  },
);

// POST /api/classes/:id/sessions/generate
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/sessions/generate',
    tags: ['Classes'],
    summary: '批次建立課堂',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              from: z.string(),
              to: z.string(),
              excludeDates: z.array(z.string()).optional(),
              includeUnassigned: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: GenerateSessionsResponseSchema,
          },
        },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '班級或課程已停用',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: {
        description: '參數錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const { from, to, excludeDates, includeUnassigned } = c.req.valid('json');

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
      return c.json({ error: '無效日期格式', code: 'INVALID_DATE' }, 400);
    }

    const excludeSet = new Set(excludeDates ?? []);
    const includeUnassignedValue = includeUnassigned ?? true;

    const { data: cls, error: clsError } = await supabase
      .from('classes')
      .select(
        'id, name, is_active, courses!course_id(id, name, is_active, campus:campuses!campus_id(name))',
      )
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (clsError) {
      return c.json({ error: clsError.message, code: 'DB_ERROR' }, 400);
    }
    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }
    if (!(cls.is_active as boolean)) {
      return c.json({ error: '班級已停用，無法新增未來課程排程', code: 'CLASS_INACTIVE' }, 409);
    }
    const linkedCourseRaw = cls.courses as
      | {
          id?: string;
          name?: string | null;
          is_active?: boolean | null;
          campus?: { name?: string | null } | Array<{ name?: string | null }> | null;
        }
      | Array<{
          id?: string;
          name?: string | null;
          is_active?: boolean | null;
          campus?: { name?: string | null } | Array<{ name?: string | null }> | null;
        }>
      | null;
    const linkedCourse = Array.isArray(linkedCourseRaw) ? linkedCourseRaw[0] : linkedCourseRaw;
    const linkedCampusRaw = linkedCourse?.campus;
    const linkedCampus = Array.isArray(linkedCampusRaw) ? linkedCampusRaw[0] : linkedCampusRaw;
    const courseName = linkedCourse?.name ?? null;
    const campusName = linkedCampus?.name ?? null;
    if (linkedCourse && linkedCourse.is_active === false) {
      return c.json({ error: '課程已停用，無法新增未來課程排程', code: 'COURSE_INACTIVE' }, 409);
    }

    const { data: schedules } = await supabase.from('schedules').select('*').eq('class_id', id);

    if (!schedules || schedules.length === 0) {
      return c.json(
        {
          createdAssigned: 0,
          createdUnassigned: 0,
          skippedExisting: 0,
          skippedNoTeacher: 0,
          totalPlanned: 0,
        },
        200,
      );
    }

    const { data: existingSessions } = await supabase
      .from('sessions')
      .select('session_date, start_time')
      .eq('class_id', id)
      .gte('session_date', from)
      .lte('session_date', to);

    const existingSet = new Set(
      (existingSessions || []).map(
        (s: { session_date: string; start_time: string }) =>
          `${s.session_date}|${normalizeTime(s.start_time)}`,
      ),
    );

    const plan = buildSessionGenerationPlan({
      orgId,
      classId: id,
      createdBy: userId,
      from,
      to,
      includeUnassigned: includeUnassignedValue,
      schedules: schedules.map((schedule) => ({
        id: schedule.id as string,
        weekday: schedule.weekday as number,
        startTime: schedule.start_time as string,
        endTime: schedule.end_time as string,
        teacherId: (schedule.teacher_id as string | null) ?? null,
        effectiveFrom: schedule.effective_from as string,
        effectiveTo: (schedule.effective_to as string | null) ?? null,
      })),
      existingKeys: existingSet,
      excludeDates: excludeSet,
    });

    if (plan.toInsert.length === 0) {
      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'session',
          action: 'generate_sessions',
          resourceName: formatAuditClassResourceName({
            className: (cls.name as string | null | undefined) ?? null,
            courseName,
            campusName,
          }),
          details: { from, to, created: 0 },
        },
        waitUntilFrom(c),
      );

      return c.json(plan.summary, 200);
    }

    // upsert with ignoreDuplicates to skip existing sessions
    const { data: inserted, error } = await supabase
      .from('sessions')
      .upsert(plan.toInsert, {
        onConflict: 'class_id,session_date,start_time',
        ignoreDuplicates: true,
      })
      .select('id, assignment_status');

    if (error) {
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    const insertedRows = inserted ?? [];
    const createdAssigned = insertedRows.filter(
      (row) => row.assignment_status === 'assigned',
    ).length;
    const createdUnassigned = insertedRows.filter(
      (row) => row.assignment_status === 'unassigned',
    ).length;
    const raceConditionSkipped = plan.toInsert.length - insertedRows.length;

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'session',
        action: 'generate_sessions',
        resourceName: formatAuditClassResourceName({
          className: (cls.name as string | null | undefined) ?? null,
          courseName,
          campusName,
        }),
        details: { from, to, createdAssigned, createdUnassigned },
      },
      waitUntilFrom(c),
    );

    return c.json(
      {
        createdAssigned,
        createdUnassigned,
        skippedExisting: plan.summary.skippedExisting + raceConditionSkipped,
        skippedNoTeacher: plan.summary.skippedNoTeacher,
        totalPlanned: plan.summary.totalPlanned,
      },
      200,
    );
  },
);

// PATCH /api/classes/:id/sessions/batch-assign-teacher
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/sessions/batch-assign-teacher',
    tags: ['Classes'],
    summary: '批次指派班級課堂老師（單班級）',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: BatchAssignBodySchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              updated: z.number(),
              skippedConflicts: z.number(),
              skippedNotEligible: z.number(),
              conflicts: z.array(BatchAssignConflictSchema),
              dryRun: z.boolean(),
            }),
          },
        },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '教師時段衝突（strict 模式）',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
              code: z.string(),
              updated: z.number(),
              skippedConflicts: z.number(),
              skippedNotEligible: z.number(),
              conflicts: z.array(BatchAssignConflictSchema),
              dryRun: z.boolean(),
            }),
          },
        },
      },
      400: {
        description: '參數或資料錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const fromDate = new Date(body.from);
    const toDate = new Date(body.to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
      return c.json({ error: '無效日期格式', code: 'INVALID_DATE_RANGE' }, 400);
    }

    const weekdaySet = new Set(body.weekday ?? []);
    const timeRanges = (body.timeRanges ?? []).map((range) => ({
      startTime: normalizeTime(range.startTime),
      endTime: normalizeTime(range.endTime),
    }));

    const { data: cls } = await supabase
      .from('classes')
      .select('id, name, courses(name), campuses(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    // 指名的老師要屬於本 org（c1，#966 B5a）
    if (!(await findInOrg(supabase, 'staff', orgId, body.toTeacherId))) {
      return c.json({ error: '老師不存在', code: 'TEACHER_NOT_FOUND' }, 404);
    }

    const { data: classSessions, error: classSessionsError } = await supabase
      .from('sessions')
      .select('id, session_date, start_time, end_time, status, assignment_status, teacher_id')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .gte('session_date', body.from)
      .lte('session_date', body.to);

    if (classSessionsError) {
      return c.json({ error: classSessionsError.message, code: 'DB_ERROR' }, 400);
    }

    const filteredSessions = (classSessions || []).filter((session) => {
      const sessionDate = session.session_date as string;
      const sessionStart = normalizeTime(session.start_time as string);
      const sessionEnd = normalizeTime(session.end_time as string);

      if (weekdaySet.size > 0 && !weekdaySet.has(toWeekdayFromString(sessionDate))) {
        return false;
      }

      if (timeRanges.length === 0) return true;
      return timeRanges.some((range) =>
        isTimeOverlap(sessionStart, sessionEnd, range.startTime, range.endTime),
      );
    });

    const { data: teacherBusySessions, error: teacherBusyError } = await supabase
      .from('sessions')
      .select('id, session_date, start_time, end_time')
      .eq('org_id', orgId)
      .eq('teacher_id', body.toTeacherId)
      .eq('status', 'scheduled')
      .gte('session_date', body.from)
      .lte('session_date', body.to);

    if (teacherBusyError) {
      return c.json({ error: teacherBusyError.message, code: 'DB_ERROR' }, 400);
    }

    const mode = body.mode as BatchAssignMode;
    const dryRun = body.dryRun ?? false;
    const includeAssigned = body.includeAssigned ?? false;

    // Inline planBatchAssign logic
    const targetSessions = filteredSessions.map((session) => ({
      id: session.id as string,
      sessionDate: session.session_date as string,
      startTime: normalizeTime(session.start_time as string),
      endTime: normalizeTime(session.end_time as string),
      status: session.status as 'scheduled' | 'completed' | 'cancelled',
      assignmentStatus:
        (session.assignment_status as 'assigned' | 'unassigned' | null) ??
        deriveAssignmentStatus((session.teacher_id as string | null) ?? null),
    }));
    const teacherBusySlots = (teacherBusySessions || []).map((session) => ({
      sessionId: session.id as string,
      sessionDate: session.session_date as string,
      startTime: normalizeTime(session.start_time as string),
      endTime: normalizeTime(session.end_time as string),
    }));

    const updatedIds: string[] = [];
    const conflicts: BatchAssignConflict[] = [];
    let skippedNotEligible = 0;
    const conflictSessionIds = new Set<string>();

    for (const session of targetSessions) {
      const eligible =
        session.status === 'scheduled' &&
        (session.assignmentStatus === 'unassigned' || includeAssigned);
      if (!eligible) {
        skippedNotEligible += 1;
        continue;
      }

      if (mode === 'force') {
        updatedIds.push(session.id);
        continue;
      }

      const sessionConflicts = teacherBusySlots.filter(
        (busy) =>
          busy.sessionDate === session.sessionDate &&
          busy.sessionId !== session.id &&
          isTimeOverlap(session.startTime, session.endTime, busy.startTime, busy.endTime),
      );

      if (sessionConflicts.length > 0) {
        conflictSessionIds.add(session.id);
        for (const conflict of sessionConflicts) {
          conflicts.push({
            sessionId: session.id,
            sessionDate: session.sessionDate,
            startTime: session.startTime,
            endTime: session.endTime,
            conflictWithSessionId: conflict.sessionId,
          });
        }
        continue;
      }

      updatedIds.push(session.id);
    }

    let plan: BatchAssignPlanOutput;
    if (mode === 'strict' && conflicts.length > 0) {
      plan = {
        updatedIds: [],
        skippedConflicts: conflictSessionIds.size,
        skippedNotEligible,
        conflicts,
      };
    } else {
      plan = {
        updatedIds,
        skippedConflicts: conflictSessionIds.size,
        skippedNotEligible,
        conflicts,
      };
    }

    if (!dryRun && mode === 'strict' && plan.conflicts.length > 0) {
      return c.json(
        {
          error: '老師時段衝突，未執行更新',
          code: 'TEACHER_CONFLICT',
          updated: 0,
          skippedConflicts: plan.skippedConflicts,
          skippedNotEligible: plan.skippedNotEligible,
          conflicts: plan.conflicts,
          dryRun: false,
        },
        409,
      );
    }

    if (!dryRun && plan.updatedIds.length > 0) {
      const { error: updateError } = await inOrg(
        supabase
          .from('sessions')
          .update({ teacher_id: body.toTeacherId, assignment_status: 'assigned' })
          .in('id', plan.updatedIds),
        orgId,
      );

      if (updateError) {
        return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
      }

      // #1693：這支不寫流水，通知照樣發（Q3）；原老師與新老師都收
      const batchId = crypto.randomUUID();
      const previousTeacher = new Map(
        (classSessions ?? []).map((s) => [s.id as string, (s.teacher_id as string | null) ?? null]),
      );
      await queueScheduleChangeNotice(
        c,
        plan.updatedIds.map((sessionId) => ({
          session_id: sessionId,
          change_type: 'assign_teacher' as const,
          batch_id: batchId,
          original_teacher_id: previousTeacher.get(sessionId) ?? null,
          substitute_teacher_id: body.toTeacherId,
        })),
      );

      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'class',
          resourceId: id,
          resourceName: classAuditResourceName(cls as Record<string, unknown>),
          action: 'batch_assign_teacher',
          details: {
            from: body.from,
            to: body.to,
            mode,
            updated: plan.updatedIds.length,
            skippedConflicts: plan.skippedConflicts,
            skippedNotEligible: plan.skippedNotEligible,
          },
        },
        waitUntilFrom(c),
      );
    }

    return c.json(
      {
        updated: plan.updatedIds.length,
        skippedConflicts: plan.skippedConflicts,
        skippedNotEligible: plan.skippedNotEligible,
        conflicts: plan.conflicts,
        dryRun,
      },
      200,
    );
  },
);

// PATCH /api/classes/:id/sessions/batch-update-time
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/sessions/batch-update-time',
    tags: ['Classes'],
    summary: '批次修改課堂時間（固定略過衝突）',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: BatchUpdateSessionTimeBodySchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: BatchSessionActionResponseSchema } },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: {
        description: '參數或資料錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const uniqueSessionIds = [...new Set(body.sessionIds)];
    const dryRun = body.dryRun ?? true;
    const newStartTime = normalizeTime(body.startTime);
    const newEndTime = normalizeTime(body.endTime);

    if (toMinutes(newStartTime) >= toMinutes(newEndTime)) {
      return c.json({ error: '開始時間需早於結束時間', code: 'INVALID_TIME_RANGE' }, 400);
    }

    const { data: cls } = await supabase
      .from('classes')
      .select('id, name, courses(name), campuses(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data: sessionRows, error: sessionRowsError } = await supabase
      .from('sessions')
      .select('id, session_date, start_time, end_time, status, teacher_id')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .in('id', uniqueSessionIds);

    if (sessionRowsError) {
      return c.json({ error: sessionRowsError.message, code: 'DB_ERROR' }, 400);
    }

    const targetSessions = (sessionRows ?? []) as Array<{
      id: string;
      session_date: string;
      start_time: string;
      end_time: string;
      status: 'scheduled' | 'completed' | 'cancelled';
      teacher_id: string | null;
    }>;

    if (targetSessions.length === 0) {
      return c.json(
        {
          updated: 0,
          skipped: uniqueSessionIds.length,
          processableIds: [],
          conflicts: [],
          dryRun,
        },
        200,
      );
    }

    const targetDates = [...new Set(targetSessions.map((session) => session.session_date))];
    const targetTeacherIds = [
      ...new Set(
        targetSessions
          .map((session) => session.teacher_id)
          .filter((teacherId): teacherId is string => !!teacherId),
      ),
    ];

    const { data: classDateSessions, error: classDateSessionsError } = await supabase
      .from('sessions')
      .select('id, session_date, start_time, end_time, status, teacher_id')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .eq('status', 'scheduled')
      .in('session_date', targetDates);

    if (classDateSessionsError) {
      return c.json({ error: classDateSessionsError.message, code: 'DB_ERROR' }, 400);
    }

    const teacherDateSessionsResult =
      targetTeacherIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from('sessions')
            .select('id, session_date, start_time, end_time, status, teacher_id')
            .eq('org_id', orgId)
            .eq('status', 'scheduled')
            .in('teacher_id', targetTeacherIds)
            .in('session_date', targetDates);

    if (teacherDateSessionsResult.error) {
      return c.json({ error: teacherDateSessionsResult.error.message, code: 'DB_ERROR' }, 400);
    }

    const classPeers = (classDateSessions ?? []) as Array<{
      id: string;
      session_date: string;
      start_time: string;
      end_time: string;
    }>;
    const teacherPeers = (teacherDateSessionsResult.data ?? []) as Array<{
      id: string;
      session_date: string;
      start_time: string;
      end_time: string;
      teacher_id: string | null;
    }>;

    const conflicts: BatchSessionConflictItem[] = [];
    const processableIds: string[] = [];

    for (const target of targetSessions) {
      if (target.status !== 'scheduled') {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'status_not_editable',
          detail: '僅可修改狀態為「scheduled」的課堂',
        });
        continue;
      }

      const classConflict = classPeers.find(
        (peer) =>
          peer.id !== target.id &&
          peer.session_date === target.session_date &&
          isTimeOverlap(
            newStartTime,
            newEndTime,
            normalizeTime(peer.start_time),
            normalizeTime(peer.end_time),
          ),
      );

      if (classConflict) {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'class_conflict',
          detail: '同班級於此時段已有課堂',
          conflictingSessionId: classConflict.id,
        });
        continue;
      }

      if (target.teacher_id) {
        const teacherConflict = teacherPeers.find(
          (peer) =>
            peer.id !== target.id &&
            peer.teacher_id === target.teacher_id &&
            peer.session_date === target.session_date &&
            isTimeOverlap(
              newStartTime,
              newEndTime,
              normalizeTime(peer.start_time),
              normalizeTime(peer.end_time),
            ),
        );

        if (teacherConflict) {
          conflicts.push({
            sessionId: target.id,
            sessionDate: target.session_date,
            reason: 'teacher_conflict',
            detail: '老師於此時段已有其他課堂',
            conflictingSessionId: teacherConflict.id,
          });
          continue;
        }
      }

      processableIds.push(target.id);
    }

    const missingCount = uniqueSessionIds.length - targetSessions.length;
    const updated = processableIds.length;
    const skipped = conflicts.length + missingCount;

    if (!dryRun && updated > 0) {
      const { error: updateError } = await supabase
        .from('sessions')
        .update({ start_time: newStartTime, end_time: newEndTime })
        .eq('org_id', orgId)
        .eq('class_id', id)
        .in('id', processableIds);

      if (updateError) {
        return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
      }

      const targetSessionDateMap = new Map(
        targetSessions.map((session) => [session.id, session.session_date]),
      );

      const actorName = await loadDisplayName(supabase, orgId, userId);

      const batchId = crypto.randomUUID();
      const { error: insertChangeError } = await supabase.from('schedule_changes').insert(
        processableIds.map((sessionId) => ({
          org_id: orgId,
          session_id: sessionId,
          // #1195：原本沒寫 operation_source（DB 預設 single），/admin/changes 把整批記成一堆單堂
          operation_source: 'batch',
          batch_id: batchId,
          change_type: 'reschedule',
          new_session_date: targetSessionDateMap.get(sessionId) ?? null,
          new_start_time: newStartTime,
          new_end_time: newEndTime,
          reason: '批次改時間',
          created_by_name: actorName,
        })),
      );

      if (insertChangeError) {
        return c.json({ error: insertChangeError.message, code: 'DB_ERROR' }, 400);
      }

      // #1693：通知任課老師（業務與流水都寫成功之後；背景跑、失敗只記 log）
      await queueScheduleChangeNotice(
        c,
        processableIds.map((sessionId) => ({
          session_id: sessionId,
          change_type: 'reschedule' as const,
          batch_id: batchId,
        })),
      );

      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'class',
          resourceId: id,
          resourceName: classAuditResourceName(cls as Record<string, unknown>),
          action: 'batch_update_session_time',
          details: {
            requested: uniqueSessionIds.length,
            updated,
            skipped,
            startTime: newStartTime,
            endTime: newEndTime,
          },
        },
        waitUntilFrom(c),
      );
    }

    return c.json(
      {
        updated,
        skipped,
        processableIds,
        conflicts,
        dryRun,
      },
      200,
    );
  },
);

// PATCH /api/classes/:id/sessions/batch-cancel
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/sessions/batch-cancel',
    tags: ['Classes'],
    summary: '批次停課（固定略過不可停課項目）',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: BatchCancelSessionsBodySchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: BatchSessionActionResponseSchema } },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: {
        description: '參數或資料錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const uniqueSessionIds = [...new Set(body.sessionIds)];
    const dryRun = body.dryRun ?? true;

    const { data: cls } = await supabase
      .from('classes')
      .select('id, name, courses(name), campuses(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data: sessionRows, error: sessionRowsError } = await supabase
      .from('sessions')
      .select('id, session_date, status')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .in('id', uniqueSessionIds);

    if (sessionRowsError) {
      return c.json({ error: sessionRowsError.message, code: 'DB_ERROR' }, 400);
    }

    const targetSessions = (sessionRows ?? []) as Array<{
      id: string;
      session_date: string;
      status: 'scheduled' | 'completed' | 'cancelled';
    }>;

    if (targetSessions.length === 0) {
      return c.json(
        {
          updated: 0,
          skipped: uniqueSessionIds.length,
          processableIds: [],
          conflicts: [],
          dryRun,
        },
        200,
      );
    }

    const conflicts: BatchSessionConflictItem[] = [];
    const processableIds: string[] = [];

    for (const target of targetSessions) {
      if (target.status !== 'scheduled') {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'status_not_cancellable',
          detail: '僅可停課狀態為「scheduled」的課堂',
        });
        continue;
      }
      processableIds.push(target.id);
    }

    const missingCount = uniqueSessionIds.length - targetSessions.length;
    const updated = processableIds.length;
    const skipped = conflicts.length + missingCount;

    if (!dryRun && updated > 0) {
      const { error: cancelError } = await supabase
        .from('sessions')
        .update({ status: 'cancelled' })
        .eq('org_id', orgId)
        .eq('class_id', id)
        .in('id', processableIds);

      if (cancelError) {
        return c.json({ error: cancelError.message, code: 'DB_ERROR' }, 400);
      }

      const actorName = await loadDisplayName(supabase, orgId, userId);

      const batchId = crypto.randomUUID();
      const { error: insertChangeError } = await supabase.from('schedule_changes').insert(
        processableIds.map((sessionId) => ({
          org_id: orgId,
          session_id: sessionId,
          // #1195：原本沒寫 operation_source（DB 預設 single），/admin/changes 把整批記成一堆單堂
          operation_source: 'batch',
          batch_id: batchId,
          change_type: 'cancellation',
          reason: '批次停課',
          created_by_name: actorName,
        })),
      );

      if (insertChangeError) {
        return c.json({ error: insertChangeError.message, code: 'DB_ERROR' }, 400);
      }

      // #1693：通知任課老師（業務與流水都寫成功之後；背景跑、失敗只記 log）
      await queueScheduleChangeNotice(
        c,
        processableIds.map((sessionId) => ({
          session_id: sessionId,
          change_type: 'cancellation' as const,
          batch_id: batchId,
        })),
      );

      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'class',
          resourceId: id,
          resourceName: classAuditResourceName(cls as Record<string, unknown>),
          action: 'batch_cancel_session',
          details: {
            requested: uniqueSessionIds.length,
            updated,
            skipped,
          },
        },
        waitUntilFrom(c),
      );
    }

    return c.json(
      {
        updated,
        skipped,
        processableIds,
        conflicts,
        dryRun,
      },
      200,
    );
  },
);

// PATCH /api/classes/:id/sessions/batch-uncancel
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/sessions/batch-uncancel',
    tags: ['Classes'],
    summary: '批次取消停課（恢復為已排定，固定略過衝突）',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: BatchCancelSessionsBodySchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: BatchSessionActionResponseSchema } },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: {
        description: '參數或資料錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const uniqueSessionIds = [...new Set(body.sessionIds)];
    const dryRun = body.dryRun ?? true;

    const { data: cls } = await supabase
      .from('classes')
      .select('id, name, courses(name), campuses(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data: sessionRows, error: sessionRowsError } = await supabase
      .from('sessions')
      .select('id, class_id, session_date, start_time, end_time, status, teacher_id')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .in('id', uniqueSessionIds);

    if (sessionRowsError) {
      return c.json({ error: sessionRowsError.message, code: 'DB_ERROR' }, 400);
    }

    const targetSessions = (sessionRows ?? []) as Array<{
      id: string;
      class_id: string;
      session_date: string;
      start_time: string;
      end_time: string;
      status: 'scheduled' | 'completed' | 'cancelled';
      teacher_id: string | null;
      makeup_for_session_id: string | null;
    }>;

    if (targetSessions.length === 0) {
      return c.json(
        {
          updated: 0,
          skipped: uniqueSessionIds.length,
          processableIds: [],
          conflicts: [],
          dryRun,
        },
        200,
      );
    }

    const targetDates = [...new Set(targetSessions.map((session) => session.session_date))];
    const targetTeacherIds = [
      ...new Set(
        targetSessions
          .map((session) => session.teacher_id)
          .filter((teacherId): teacherId is string => !!teacherId),
      ),
    ];

    const { data: classDateSessions, error: classDateSessionsError } = await supabase
      .from('sessions')
      .select(
        'id, class_id, session_date, start_time, end_time, status, teacher_id, makeup_for_session_id',
      )
      .eq('org_id', orgId)
      .eq('class_id', id)
      .eq('status', 'scheduled')
      .in('session_date', targetDates);

    if (classDateSessionsError) {
      return c.json({ error: classDateSessionsError.message, code: 'DB_ERROR' }, 400);
    }

    const teacherDateSessionsResult =
      targetTeacherIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from('sessions')
            .select('id, session_date, start_time, end_time, status, teacher_id')
            .eq('org_id', orgId)
            .eq('status', 'scheduled')
            .in('teacher_id', targetTeacherIds)
            .in('session_date', targetDates);

    if (teacherDateSessionsResult.error) {
      return c.json({ error: teacherDateSessionsResult.error.message, code: 'DB_ERROR' }, 400);
    }

    const classPeers = (classDateSessions ?? []) as Array<{
      id: string;
      session_date: string;
      start_time: string;
      end_time: string;
    }>;
    const teacherPeers = (teacherDateSessionsResult.data ?? []) as Array<{
      id: string;
      session_date: string;
      start_time: string;
      end_time: string;
      teacher_id: string | null;
    }>;

    // 決策 5.5：要復課的補課，它補的那一堂是不是已經被另一堂有效的補課佔住了。
    // 撈「補同一個目標的其他課堂」—— **不限本班**，因為唯一索引是全表的。
    const makeupTargetIds = [
      ...new Set(
        targetSessions
          .map((session) => session.makeup_for_session_id)
          .filter((targetId): targetId is string => !!targetId),
      ),
    ];

    const makeupSiblingsResult =
      makeupTargetIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from('sessions')
            .select('id, makeup_for_session_id, status')
            .eq('org_id', orgId)
            .in('makeup_for_session_id', makeupTargetIds);

    if (makeupSiblingsResult.error) {
      return c.json({ error: makeupSiblingsResult.error.message, code: 'DB_ERROR' }, 400);
    }

    const coveredMakeupTargets = findCoveredMakeupTargets(
      targetSessions,
      (makeupSiblingsResult.data ?? []) as Array<{
        id: string;
        makeup_for_session_id: string | null;
        status: string;
      }>,
    );

    const conflicts: BatchSessionConflictItem[] = [];
    const processableIds: string[] = [];

    for (const target of targetSessions) {
      if (target.status !== 'cancelled') {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'status_not_reopenable',
          detail: '僅可取消已停課（cancelled）的課堂',
        });
        continue;
      }

      const targetStart = normalizeTime(target.start_time);
      const targetEnd = normalizeTime(target.end_time);

      const classConflict = classPeers.find(
        (peer) =>
          peer.session_date === target.session_date &&
          isTimeOverlap(
            targetStart,
            targetEnd,
            normalizeTime(peer.start_time),
            normalizeTime(peer.end_time),
          ),
      );

      if (classConflict) {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'class_conflict',
          detail: '同班級於此時段已有課堂',
          conflictingSessionId: classConflict.id,
        });
        continue;
      }

      if (target.teacher_id) {
        const teacherConflict = teacherPeers.find(
          (peer) =>
            peer.teacher_id === target.teacher_id &&
            peer.session_date === target.session_date &&
            isTimeOverlap(
              targetStart,
              targetEnd,
              normalizeTime(peer.start_time),
              normalizeTime(peer.end_time),
            ),
        );

        if (teacherConflict) {
          conflicts.push({
            sessionId: target.id,
            sessionDate: target.session_date,
            reason: 'teacher_conflict',
            detail: '老師於此時段已有其他課堂',
            conflictingSessionId: teacherConflict.id,
          });
          continue;
        }
      }

      // 決策 5.5 —— 擋在 push 之前，不要讓它變成 update 撞唯一索引的 500
      const holderId = coveredMakeupTargets.get(target.id);
      if (holderId) {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'makeup_target_already_covered',
          detail: '這堂補課的目標已經另外有補課了，要復課請先解除那一個連結',
          conflictingSessionId: holderId,
        });
        continue;
      }

      processableIds.push(target.id);
    }

    const missingCount = uniqueSessionIds.length - targetSessions.length;
    const updated = processableIds.length;
    const skipped = conflicts.length + missingCount;

    if (!dryRun && updated > 0) {
      const { error: reopenError } = await supabase
        .from('sessions')
        .update({ status: 'scheduled' })
        .eq('org_id', orgId)
        .eq('class_id', id)
        .in('id', processableIds);

      if (reopenError) {
        return c.json({ error: reopenError.message, code: 'DB_ERROR' }, 400);
      }

      // #1693：這支不寫流水，通知照樣發（Q3）
      const batchId = crypto.randomUUID();
      await queueScheduleChangeNotice(
        c,
        processableIds.map((sessionId) => ({
          session_id: sessionId,
          change_type: 'uncancel' as const,
          batch_id: batchId,
        })),
      );

      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'class',
          resourceId: id,
          resourceName: classAuditResourceName(cls as Record<string, unknown>),
          action: 'batch_uncancel_session',
          details: {
            requested: uniqueSessionIds.length,
            updated,
            skipped,
          },
        },
        waitUntilFrom(c),
      );
    }

    return c.json(
      {
        updated,
        skipped,
        processableIds,
        conflicts,
        dryRun,
      },
      200,
    );
  },
);

// POST /api/classes/:id/cancel-future-sessions
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel-future-sessions',
    tags: ['Classes'],
    summary: '取消此班級所有未來課堂排程（軟刪除，保留 schedule_change 紀錄）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({ cancelled: z.number() }),
          },
        },
      },
      400: {
        description: '操作失敗',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    // 確認班級存在（名稱給稽核用）。別 org 的班跟不存在一樣 404（#1345）
    const { data: cls } = await supabase
      .from('classes')
      .select('id, name, courses(name), campuses(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    // 台北時間，不是 UTC —— 見 lib/taipei-date.ts 檔頭。算錯一天會把台北昨天
    // 已經上過的課堂一併抓進來取消（軟刪除，保留 schedule_change，但語意錯）。
    const today = getCurrentTaipeiDateString();

    // 查出要取消的課堂 IDs
    const { data: targetSessions, error: fetchError } = await supabase
      .from('sessions')
      .select('id')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .gte('session_date', today)
      .neq('status', 'completed');

    if (fetchError) {
      return c.json({ error: fetchError.message, code: 'DB_ERROR' }, 400);
    }

    const sessionIds = (targetSessions ?? []).map((r) => r['id'] as string);

    if (sessionIds.length > 0) {
      // 軟刪除：更新狀態為 cancelled
      const { error: updateError } = await inOrg(
        supabase.from('sessions').update({ status: 'cancelled' }).in('id', sessionIds),
        orgId,
      );

      if (updateError) {
        return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
      }

      // 取得操作者名稱
      const actorName = await loadDisplayName(supabase, orgId, userId);

      // 為每堂課建立 schedule_change 紀錄（整個班一次停用 = 一批，#1195）
      const batchId = crypto.randomUUID();
      const changeRecords = sessionIds.map((sessionId) => ({
        org_id: orgId,
        session_id: sessionId,
        operation_source: 'batch',
        batch_id: batchId,
        change_type: 'cancellation',
        reason: '班級停用',
        created_by_name: actorName,
      }));

      const { error: insertError } = await supabase.from('schedule_changes').insert(changeRecords);

      if (insertError) {
        return c.json({ error: insertError.message, code: 'DB_ERROR' }, 400);
      }

      // #1693：通知任課老師（業務與流水都寫成功之後；背景跑、失敗只記 log）
      await queueScheduleChangeNotice(
        c,
        sessionIds.map((sessionId) => ({
          session_id: sessionId,
          change_type: 'cancellation' as const,
          batch_id: batchId,
        })),
      );

      // 同 `/{id}/sessions/batch-cancel` 的稽核形狀（#1336）—— 整班未來課全停是影響最大的批次動作
      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'class',
          resourceId: id,
          resourceName: classAuditResourceName(cls as Record<string, unknown>),
          action: 'batch_cancel_session',
          details: {
            requested: sessionIds.length,
            updated: sessionIds.length,
            skipped: 0,
            classId: id,
            scope: 'all_future',
            batchId,
          },
        },
        waitUntilFrom(c),
      );
    }

    return c.json({ cancelled: sessionIds.length }, 200);
  },
);

export default app;
