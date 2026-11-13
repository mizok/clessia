import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { inChunks } from '../lib/in-chunks';
import { waitUntilFrom } from '../lib/wait-until';
import type { AppEnv } from '../index';
import { loadTeachingScope, taughtClassIds } from '../lib/teacher-scope';
import { canManageOrgExam } from '../lib/exam-scope';
import { DbUuidSchema, QueryBooleanSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';
import { campusFilterIds, getCampusScope } from '../lib/campus-scope';
import { studentInScope } from '../lib/invoice-campus-scope';
import { outOfCampusScope } from './students/read-scope';
import { fetchAllPages } from '../lib/fetch-all-pages';
import { splitScoreMutations } from '../lib/score-mutations';
import { writeExamScores } from '../lib/exam-scores-write';
import { getAuth } from '../lib/get-auth';
import { loadDisplayName } from '../lib/display-name';
const SchoolExamTypeSchema = z.enum(['term_exam', 'mock_exam', 'other']).openapi('SchoolExamType');
const SchoolExamStatusSchema = z.enum(['active', 'closed']).openapi('SchoolExamStatus');

type SchoolExamType = z.infer<typeof SchoolExamTypeSchema>;

const ScoreStatusSchema = z.enum(['scored', 'absent', 'makeup']).openapi('SchoolExamScoreStatus');

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi('SchoolExamError');

const SchoolExamListItemSchema = z
  .object({
    id: DbUuidSchema,
    academicYear: z.number().int(),
    semester: z.union([z.literal(1), z.literal(2)]),
    examType: SchoolExamTypeSchema,
    subjectId: z.string().uuid().nullable(),
    subjectName: z.string().nullable(),
    name: z.string().nullable(),
    label: z.string(),
    examDate: z.string().nullable(),
    status: SchoolExamStatusSchema,
    schoolId: DbUuidSchema,
    schoolName: z.string(),
    scoreCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SchoolExamListItem');

const SchoolExamListResponseSchema = z
  .object({
    data: z.array(SchoolExamListItemSchema),
    meta: z.object({
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
    }),
  })
  .openapi('SchoolExamListResponse');

const SchoolExamSubjectSummarySchema = z
  .object({
    subjectId: DbUuidSchema,
    subjectName: z.string(),
    averageScore: z.number().nullable(),
    recordedCount: z.number().int(),
  })
  .openapi('SchoolExamSubjectSummary');

const SchoolExamDetailSchema = z
  .object({
    id: DbUuidSchema,
    academicYear: z.number().int(),
    semester: z.union([z.literal(1), z.literal(2)]),
    examType: SchoolExamTypeSchema,
    subjectId: z.string().uuid().nullable(),
    subjectName: z.string().nullable(),
    name: z.string().nullable(),
    label: z.string(),
    examDate: z.string().nullable(),
    status: SchoolExamStatusSchema,
    schoolId: DbUuidSchema,
    schoolName: z.string(),
    summary: z.object({
      bySubject: z.array(SchoolExamSubjectSummarySchema),
      totalRecordedCount: z.number().int(),
    }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SchoolExamDetail');

const CreateSchoolExamSchema = z
  .object({
    academicYear: z.number().int().min(100).max(999),
    semester: z.union([z.literal(1), z.literal(2)]),
    examType: SchoolExamTypeSchema,
    subjectId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(100).nullable().optional(),
    schoolId: DbUuidSchema,
    examDate: z.string().date().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.examType === 'other' && !data.name) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: '學校考試（其他）需填寫名稱',
      });
    }
  })
  .openapi('CreateSchoolExam');

const UpdateSchoolExamSchema = z
  .object({
    academicYear: z.number().int().min(100).max(200).optional(),
    semester: z.union([z.literal(1), z.literal(2)]).optional(),
    examType: SchoolExamTypeSchema.optional(),
    subjectId: z.string().uuid().nullable().optional(),
    name: z.string().trim().max(100).nullable().optional(),
    schoolId: DbUuidSchema.optional(),
    examDate: z.string().date().nullable().optional(),
  })
  .openapi('UpdateSchoolExam');

const RecentSchoolExamStudentSchema = z
  .object({
    studentId: DbUuidSchema,
    studentName: z.string(),
    studentGrade: z.string().nullable(),
    scoreCount: z.number().int(),
    lastUpdatedAt: z.string(),
  })
  .openapi('RecentSchoolExamStudent');

const SchoolExamStudentStatusSchema = z
  .enum(['pending', 'scored', 'absent', 'makeup'])
  .openapi('SchoolExamStudentStatus');

const SchoolExamStudentRowSchema = z
  .object({
    studentId: DbUuidSchema,
    studentName: z.string(),
    studentGrade: z.string().nullable(),
    campusNames: z.array(z.string()),
    scoreCount: z.number().int(),
    subjectCount: z.number().int(),
    hasScored: z.boolean(),
    hasAbsent: z.boolean(),
    hasMakeup: z.boolean(),
    lastUpdatedAt: z.string().nullable(),
  })
  .openapi('SchoolExamStudentRow');

const SchoolExamStudentListResponseSchema = z
  .object({
    data: z.array(SchoolExamStudentRowSchema),
    meta: z.object({
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
    }),
  })
  .openapi('SchoolExamStudentListResponse');

const SchoolScoreSchema = z
  .object({
    studentId: DbUuidSchema,
    studentName: z.string(),
    studentGrade: z.string().nullable(),
    subjectId: DbUuidSchema,
    subjectName: z.string(),
    score: z.number().nullable(),
    status: ScoreStatusSchema,
    notes: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi('SchoolScore');

const SchoolScoreListResponseSchema = z
  .object({
    data: z.array(SchoolScoreSchema),
  })
  .openapi('SchoolScoreListResponse');

const BatchUpsertSchoolScoresSchema = z
  .object({
    scores: z
      .array(
        z.object({
          studentId: DbUuidSchema,
          subjectId: DbUuidSchema,
          score: z.number().min(0).max(9999).nullable(),
          status: ScoreStatusSchema,
          notes: z.string().max(5000).nullable().optional(),
        }),
      )
      .min(1)
      // 上限（#2232）：一張名冊（學生×科目）實務上幾百列；沒上限的話異常輸入整串進 DB
      .max(2000),
  })
  .openapi('BatchUpsertSchoolScores');

const StudentSchoolScoreSchema = z
  .object({
    schoolExamId: DbUuidSchema,
    label: z.string(),
    academicYear: z.number().int(),
    semester: z.union([z.literal(1), z.literal(2)]),
    examType: SchoolExamTypeSchema,
    name: z.string().nullable(),
    subjectId: DbUuidSchema,
    subjectName: z.string(),
    score: z.number().nullable(),
    status: ScoreStatusSchema,
    notes: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi('StudentSchoolScore');

const app = new OpenAPIHono<AppEnv>();

interface SchoolExamRow {
  id: string;
  academic_year: number;
  semester: 1 | 2;
  exam_type: SchoolExamType;
  subject_id: string | null;
  name: string | null;
  label: string;
  exam_date: string | null;
  status: 'active' | 'closed';
  school_id: string;
  created_at: string;
  updated_at: string;
}

interface SchoolScoreCountRow {
  count: number | null;
}

interface SubjectRelation {
  id: string;
  name: string | null;
}

interface SchoolRelation {
  id: string;
  name: string | null;
}

interface StudentRelation {
  name: string | null;
  grade: string | null;
}

interface SchoolExamDetailRow extends SchoolExamRow {
  schools?: SchoolRelation | SchoolRelation[] | null;
  subjects?: SubjectRelation | SubjectRelation[] | null;
}

interface ScoreRowWithRelations {
  student_id: string;
  subject_id: string;
  score: number | null;
  status: 'scored' | 'absent' | 'makeup';
  notes: string | null;
  updated_at: string;
  students?: StudentRelation | StudentRelation[] | null;
  subjects?: SubjectRelation | SubjectRelation[] | null;
}

interface StudentScoreRow {
  score: number | null;
  status: 'scored' | 'absent' | 'makeup';
  notes: string | null;
  updated_at: string;
  school_exams?:
    | (SchoolExamRow & { org_id?: string | null })
    | Array<SchoolExamRow & { org_id?: string | null }>
    | null;
  subjects?: SubjectRelation | SubjectRelation[] | null;
}

function pickRelationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function examTypeLabel(examType: SchoolExamType): string {
  const map: Record<SchoolExamType, string> = {
    term_exam: '段考',
    mock_exam: '模擬考',
    other: '其他',
  };
  return map[examType];
}

function buildSchoolExamLabel(input: {
  academicYear: number;
  semester: 1 | 2;
  examType: SchoolExamType;
  name?: string | null;
  examDate?: string | null;
}): string {
  const prefix = `${input.academicYear}-${input.semester}`;
  const trimmedName = input.name?.trim();

  if (input.examType === 'term_exam') {
    if (trimmedName) {
      return `${prefix} 段考 · ${trimmedName}`;
    }
    if (input.examDate) {
      return `${prefix} 段考（${input.examDate}）`;
    }
    return `${prefix} 段考`;
  }

  if (input.examType === 'other') {
    return `${prefix} ${trimmedName ?? '學校考試'}`;
  }

  const typeLabel = examTypeLabel(input.examType);
  if (trimmedName) {
    return `${prefix} ${typeLabel} · ${trimmedName}`;
  }
  return `${prefix} ${typeLabel}`;
}

function compareSchoolExamChronologically(
  left: { examDate: string | null; createdAt: string; id: string },
  right: { examDate: string | null; createdAt: string; id: string },
): number {
  const leftDate = left.examDate ? Date.parse(left.examDate) : Number.NEGATIVE_INFINITY;
  const rightDate = right.examDate ? Date.parse(right.examDate) : Number.NEGATIVE_INFINITY;
  if (leftDate !== rightDate) {
    return rightDate - leftDate;
  }

  const createdDiff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return left.id.localeCompare(right.id);
}

async function ensureSchoolExamOwnedByOrg(
  supabase: AppEnv['Variables']['supabase'],
  schoolExamId: string,
  orgId: string,
): Promise<SchoolExamRow | null> {
  const { data, error } = await supabase
    .from('school_exams')
    .select(
      'id, academic_year, semester, exam_type, subject_id, name, label, exam_date, status, school_id, created_at, updated_at',
    )
    .eq('id', schoolExamId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as SchoolExamRow;
}

/**
 * 待登錄段考（#2437，計畫席 11-12 裁定）：清單 `todo=true` 與 `/todo-count` 共用，條件只寫這一份。
 *
 * - **範圍內**＝段考的學校有任一位學生、任一筆報名的班在範圍分校（不分報名狀態，同 `GET /{id}` 的 summary）
 * - **待登錄**＝`active` ∧ 範圍內 ∧ **範圍內學生的成績 0 筆**。別校登過不算 —— 否則別校的進度會從我的數字露出來
 * - `campusIds` null（跨分校）退化成原本的「active 且成績 0 筆」；`[]` 由呼叫端先回空
 *
 * 全在 DB 端：範圍走 `!inner`、「0 筆」走反連接（`todo_hit=is.null`），空 embed `()` 不回資料。
 * 原本先撈全 org 未結案 id 再 `.in()` —— 兩百多場就 414，而且不受分校範圍限制。
 */
const TODO_SCOPE_PATH = 'students!inner(enrollments!inner(classes!inner()))';

/**
 * 成績列的分校範圍（#2493 R6）：成績屬於學生，學生的分校經報名的班推得（不濾 status，同 /students）。
 * 條件放進 embed 的 `!inner`，不先撈範圍內學生 id 再 `.in()`（會 414）。
 */
const SCORE_SCOPE_EMBED =
  'scope_campus:students!inner(enrollments!inner(classes!inner(campus_id)))';
const SCORE_SCOPE_COLUMN = 'scope_campus.enrollments.classes.campus_id';

function todoSelect(campusIds: readonly string[] | null): string {
  return campusIds
    ? `, todo_scope:schools!inner(${TODO_SCOPE_PATH}), todo_hit:school_scores(${TODO_SCOPE_PATH})`
    : ', todo_hit:school_scores()';
}

interface TodoFilterable {
  eq(column: string, value: unknown): TodoFilterable;
  in(column: string, values: readonly unknown[]): TodoFilterable;
  is(column: string, value: null): TodoFilterable;
}

// `<Q,>` 而不是 `Q extends Filterable<Q>`：後者對 supabase builder 會 TS2589（labor-20261112-1233 charter）
function applyTodo<Q>(query: Q, campusIds: readonly string[] | null): Q {
  let q = (query as unknown as TodoFilterable).eq('status', 'active');
  if (campusIds) {
    q = q
      .in('todo_scope.students.enrollments.classes.campus_id', campusIds)
      .in('todo_hit.students.enrollments.classes.campus_id', campusIds);
  }
  return q.is('todo_hit', null) as unknown as Q;
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['SchoolExams'],
  summary: '取得學校考試列表',
  request: {
    query: z.object({
      academic_year: z.coerce.number().int().optional(),
      semester: z.coerce.number().int().min(1).max(2).optional(),
      search: z.string().optional(),
      status: SchoolExamStatusSchema.optional(),
      school_id: DbUuidSchema.optional(),
      subject_id: DbUuidSchema.optional(),
      date_from: z.string().date().optional(),
      date_to: z.string().date().optional(),
      todo: QueryBooleanSchema.optional(),
      page: z.coerce.number().int().min(1).default(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).default(20).optional(),
    }),
  },
  responses: {
    200: {
      description: '學校考試列表',
      content: {
        'application/json': {
          schema: SchoolExamListResponseSchema,
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '查詢失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(listRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const {
    academic_year: academicYear,
    semester,
    search,
    status,
    school_id: schoolId,
    subject_id: subjectId,
    date_from: dateFrom,
    date_to: dateTo,
    todo = false,
    page = 1,
    pageSize = 20,
  } = c.req.valid('query');
  const todoCampusIds = campusFilterIds(getCampusScope(c), undefined);

  let query = supabase
    .from('school_exams')
    .select(
      'id, academic_year, semester, exam_type, subject_id, name, label, exam_date, status, school_id, schools(id, name), subjects(id, name), created_at, updated_at, school_scores(count)' +
        (todo ? todoSelect(todoCampusIds) : ''),
      {
        count: 'exact',
      },
    )
    .eq('org_id', orgId);

  if (academicYear !== undefined) {
    query = query.eq('academic_year', academicYear);
  }
  if (semester !== undefined) {
    query = query.eq('semester', semester);
  }
  if (search?.trim()) {
    query = query.ilike('label', `%${search.trim()}%`);
  }
  // todo 的 status=active 由 applyTodo 下
  if (!todo && status) {
    query = query.eq('status', status);
  }
  if (schoolId) {
    query = query.eq('school_id', schoolId);
  }
  if (subjectId) {
    query = query.eq('subject_id', subjectId);
  }
  if (dateFrom) {
    query = query.gte('exam_date', dateFrom);
  }
  if (dateTo) {
    query = query.lte('exam_date', dateTo);
  }

  if (todo) {
    if (todoCampusIds?.length === 0) {
      return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
    }
    query = applyTodo(query, todoCampusIds);
  }

  const from = (page - 1) * pageSize;
  query = query
    .range(from, from + pageSize - 1)
    .order('exam_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });

  const { data, error, count } = await query;

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 500);
  }

  // #2493 R6：受限管理員的 scoreCount 只數範圍內學生的成績 —— 全機構的筆數是看別校規模的側管道
  //（同 billing-periods／fee-templates）。段考目錄本身是機構層，照舊全列
  const pageExamIds = ((data ?? []) as unknown as Array<{ id: string }>).map((row) => row.id);
  let scopedCounts: Map<string, number> | null = null;
  if (todoCampusIds !== null) {
    scopedCounts = new Map();
    if (todoCampusIds.length > 0 && pageExamIds.length > 0) {
      const { rows: scoped, error: scopedError } = await fetchAllPages((from, to) =>
        supabase
          .from('school_scores')
          .select(`id, school_exam_id, ${SCORE_SCOPE_EMBED}`)
          .in('school_exam_id', pageExamIds)
          .in(SCORE_SCOPE_COLUMN, [...todoCampusIds])
          .order('id')
          .range(from, to),
      );
      if (scopedError) return c.json({ error: '查詢失敗', code: 'DB_ERROR' }, 500);
      for (const row of scoped as Array<{ school_exam_id: string }>)
        scopedCounts.set(row.school_exam_id, (scopedCounts.get(row.school_exam_id) ?? 0) + 1);
    }
  }

  const rows = (
    (data ?? []) as unknown as Array<
      SchoolExamRow & {
        school_scores?: SchoolScoreCountRow[] | null;
        schools?: SchoolRelation | SchoolRelation[] | null;
        subjects?: SubjectRelation | SubjectRelation[] | null;
      }
    >
  ).map((row) => {
    const school = pickRelationFirst(row.schools);
    const subject = pickRelationFirst(row.subjects);
    return {
      id: row.id,
      academicYear: row.academic_year,
      semester: row.semester,
      examType: row.exam_type,
      subjectId: row.subject_id,
      subjectName: subject?.name ?? null,
      name: row.name,
      label: row.label,
      examDate: row.exam_date,
      status: row.status,
      schoolId: row.school_id,
      schoolName: school?.name ?? '',
      scoreCount: scopedCounts
        ? (scopedCounts.get(row.id) ?? 0)
        : (row.school_scores?.[0]?.count ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  return c.json(
    {
      data: rows,
      meta: {
        total: count ?? 0,
        page,
        pageSize,
      },
    },
    200,
  );
});

const todoCountRoute = createRoute({
  method: 'get',
  path: '/todo-count',
  tags: ['SchoolExams'],
  summary: '取得學校考試待登錄數量',
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: z.object({ count: z.number().int().min(0) }),
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '查詢失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(todoCountRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');

  const campusIds = campusFilterIds(getCampusScope(c), undefined);
  if (campusIds?.length === 0) return c.json({ count: 0 }, 200);

  const { count, error } = await applyTodo(
    supabase
      .from('school_exams')
      .select('id' + todoSelect(campusIds), { count: 'exact', head: true })
      .eq('org_id', orgId),
    campusIds,
  );
  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 500);
  }

  return c.json({ count: count ?? 0 }, 200);
});

const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['SchoolExams'],
  summary: '取得學校考試單筆（summary 可依 campus/grade 過濾）',
  request: {
    params: z.object({ id: DbUuidSchema }),
    query: z.object({
      campusId: DbUuidSchema.optional(),
      grade: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: '學校考試明細',
      content: {
        'application/json': {
          schema: z.object({ data: SchoolExamDetailSchema }),
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '查詢失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '找不到資料',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(getRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');
  const { campusId, grade } = c.req.valid('query');

  const { data: schoolExamData, error: schoolExamError } = await supabase
    .from('school_exams')
    .select(
      'id, academic_year, semester, exam_type, subject_id, name, label, exam_date, status, school_id, schools(id, name), subjects(id, name), created_at, updated_at',
    )
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (schoolExamError) {
    return c.json({ error: schoolExamError.message, code: 'DB_ERROR' }, 500);
  }

  if (!schoolExamData) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  const schoolExam = schoolExamData as SchoolExamDetailRow;
  const school = pickRelationFirst(schoolExam.schools);
  const subject = pickRelationFirst(schoolExam.subjects);
  const schoolName = school?.name ?? '';

  // 分校範圍（#1928）：**一律套**（原本只有帶 campusId 或 grade 才套，受限管理員不帶篩選就拿到整個 org 的平均），
  // 條件放進 embed 的 `!inner` 在 DB 端篩 —— 不先撈範圍內學生 id 再塞進 URL（兩三百位就 414）。
  // 學生「任一筆報名」的班在範圍內就算、不分報名狀態（同 routes/students.ts、enrollment-rules 第 8 節）
  const campusIds = campusFilterIds(getCampusScope(c), campusId);
  if (campusIds !== null && campusIds.length === 0) {
    return c.json(
      {
        data: {
          id: schoolExam.id,
          academicYear: schoolExam.academic_year,
          semester: schoolExam.semester,
          examType: schoolExam.exam_type,
          subjectId: schoolExam.subject_id,
          subjectName: subject?.name ?? null,
          name: schoolExam.name,
          label: schoolExam.label,
          examDate: schoolExam.exam_date,
          status: schoolExam.status,
          schoolId: schoolExam.school_id,
          schoolName,
          summary: { bySubject: [], totalRecordedCount: 0 },
          createdAt: schoolExam.created_at,
          updatedAt: schoolExam.updated_at,
        },
      },
      200,
    );
  }
  // 帶了 campusId 或 grade 的篩選只算在籍學生（行為同原本）
  const filtered = Boolean(campusId || grade);
  const { rows: scoreRows, error: scoreError } = await fetchAllPages((from, to) => {
    let query = supabase
      .from('school_scores')
      .select(
        'id, student_id, subject_id, score, subjects(id, name)' +
          (filtered ? ', filt:students!inner(grade, is_active)' : '') +
          (campusIds
            ? ', scope_campus:students!inner(enrollments!inner(classes!inner(campus_id)))'
            : ''),
      )
      .eq('school_exam_id', id);
    if (filtered) query = query.eq('filt.is_active', true);
    if (grade) query = query.eq('filt.grade', grade);
    if (campusIds) query = query.in('scope_campus.enrollments.classes.campus_id', [...campusIds]);
    return query.order('id').range(from, to);
  });

  if (scoreError) {
    return c.json(
      { error: (scoreError as { message?: string }).message ?? '查詢失敗', code: 'DB_ERROR' },
      500,
    );
  }

  const summaryMap = new Map<
    string,
    { subjectId: string; subjectName: string; scores: number[]; rowCount: number }
  >();

  for (const row of scoreRows as unknown as Array<{
    subject_id: string;
    score: number | null;
    subjects: { id: string; name: string } | Array<{ id: string; name: string }> | null;
  }>) {
    const subject = pickRelationFirst(row.subjects);
    const subjectId = row.subject_id;
    const subjectName = subject?.name ?? '';

    if (!summaryMap.has(subjectId)) {
      summaryMap.set(subjectId, {
        subjectId,
        subjectName,
        scores: [],
        rowCount: 0,
      });
    }

    summaryMap.get(subjectId)!.rowCount += 1;

    if (typeof row.score === 'number' && Number.isFinite(row.score)) {
      summaryMap.get(subjectId)?.scores.push(row.score);
    }
  }

  const bySubject = Array.from(summaryMap.values()).map((item) => ({
    subjectId: item.subjectId,
    subjectName: item.subjectName,
    averageScore:
      item.scores.length > 0
        ? Number(
            (item.scores.reduce((sum, score) => sum + score, 0) / item.scores.length).toFixed(2),
          )
        : null,
    recordedCount: item.rowCount,
  }));

  return c.json(
    {
      data: {
        id: schoolExam.id,
        academicYear: schoolExam.academic_year,
        semester: schoolExam.semester,
        examType: schoolExam.exam_type,
        subjectId: schoolExam.subject_id,
        subjectName: subject?.name ?? null,
        name: schoolExam.name,
        label: schoolExam.label,
        examDate: schoolExam.exam_date,
        status: schoolExam.status,
        schoolId: schoolExam.school_id,
        schoolName,
        summary: {
          bySubject,
          totalRecordedCount: (scoreRows ?? []).length,
        },
        createdAt: schoolExam.created_at,
        updatedAt: schoolExam.updated_at,
      },
    },
    200,
  );
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['SchoolExams'],
  summary: '建立學校考試',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateSchoolExamSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: '建立成功',
      content: {
        'application/json': {
          schema: z.object({ data: z.object({ id: DbUuidSchema, label: z.string() }) }),
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '建立失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: '重複學校考試',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(createRouteDef, async (c) => {
  // `school_exams` 是**學校段考的機構層目錄**（學年 × 學期 × 類型），不是老師辦的考試 ——
  // 沒有 created_by、沒有班級關聯。兩個老師各自建一筆「第一次段考」只會製造重複資料。
  // 成績是另一回事：段考成績照樣由老師登錄（見 upsertScores 的範圍檢查）。
  if (!canManageOrgExam(c.get('roles') ?? [])) {
    return c.json({ error: '段考目錄只有管理員能維護', code: 'ORG_EXAM_ADMIN_ONLY' }, 403);
  }
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const trimmedName = body.name?.trim() ?? null;
  const normalizedName = trimmedName && trimmedName.length > 0 ? trimmedName : null;
  const subjectId = body.examType === 'other' ? (body.subjectId ?? null) : null;

  const label = buildSchoolExamLabel({
    academicYear: body.academicYear,
    semester: body.semester,
    examType: body.examType,
    name: normalizedName,
    examDate: body.examDate ?? null,
  });

  const { data: school, error: schoolError } = await supabase
    .from('schools')
    .select('id')
    .eq('id', body.schoolId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (schoolError) {
    return c.json({ error: schoolError.message, code: 'DB_ERROR' }, 500);
  }

  if (!school) {
    return c.json({ error: '指定的學校不存在', code: 'SCHOOL_NOT_FOUND' }, 400);
  }

  const { data, error } = await supabase
    .from('school_exams')
    .insert({
      org_id: orgId,
      school_id: body.schoolId,
      academic_year: body.academicYear,
      semester: body.semester,
      exam_type: body.examType,
      subject_id: subjectId,
      name: normalizedName,
      label,
      exam_date: body.examDate ?? null,
    })
    .select('id, label')
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '資料重複，請確認後再試', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: error.message, code: 'DB_ERROR' }, 500);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'school_exam',
      resourceId: data.id,
      resourceName: data.label,
      action: 'school_exam.create',
      details: {
        academicYear: body.academicYear,
        semester: body.semester,
        examType: body.examType,
        subjectId,
        name: normalizedName,
        schoolId: body.schoolId,
      },
    },
    waitUntilFrom(c),
  );

  return c.json({ data: { id: data.id, label: data.label } }, 201);
});

const updateRouteDef = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['SchoolExams'],
  summary: '更新學校考試',
  request: {
    params: z.object({ id: DbUuidSchema }),
    body: {
      content: {
        'application/json': {
          schema: UpdateSchoolExamSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '更新成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean(), label: z.string() }),
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '更新失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '找不到資料',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(updateRouteDef, async (c) => {
  // `school_exams` 是**學校段考的機構層目錄**（學年 × 學期 × 類型），不是老師辦的考試 ——
  // 沒有 created_by、沒有班級關聯。兩個老師各自建一筆「第一次段考」只會製造重複資料。
  // 成績是另一回事：段考成績照樣由老師登錄（見 upsertScores 的範圍檢查）。
  if (!canManageOrgExam(c.get('roles') ?? [])) {
    return c.json({ error: '段考目錄只有管理員能維護', code: 'ORG_EXAM_ADMIN_ONLY' }, 403);
  }
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  if (body.schoolId !== undefined && body.schoolId !== existing.school_id) {
    const { data: school, error: schoolError } = await supabase
      .from('schools')
      .select('id')
      .eq('id', body.schoolId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (schoolError) {
      return c.json({ error: schoolError.message, code: 'DB_ERROR' }, 500);
    }

    if (!school) {
      return c.json({ error: '指定的學校不存在', code: 'SCHOOL_NOT_FOUND' }, 400);
    }
  }

  const nextAcademicYear = body.academicYear ?? existing.academic_year;
  const nextSemester = body.semester ?? existing.semester;
  const nextExamType = body.examType ?? existing.exam_type;
  const nextSchoolId = body.schoolId ?? existing.school_id;
  const nextExamDate = body.examDate === undefined ? existing.exam_date : body.examDate;
  const nextSubjectId =
    nextExamType === 'other'
      ? body.subjectId === undefined
        ? existing.subject_id
        : body.subjectId
      : null;

  let nextName: string | null;
  if (body.name === undefined) {
    nextName = existing.name;
  } else if (body.name === null) {
    nextName = null;
  } else {
    const trimmed = body.name.trim();
    nextName = trimmed.length > 0 ? trimmed : null;
  }

  if (nextExamType === 'other' && !nextName) {
    return c.json({ error: '學校考試（其他）需填寫名稱', code: 'NAME_REQUIRED' }, 400);
  }

  const nextLabel = buildSchoolExamLabel({
    academicYear: nextAcademicYear,
    semester: nextSemester,
    examType: nextExamType,
    name: nextName,
    examDate: nextExamDate,
  });

  const { error } = await supabase
    .from('school_exams')
    .update({
      academic_year: nextAcademicYear,
      semester: nextSemester,
      exam_type: nextExamType,
      subject_id: nextSubjectId,
      name: nextName,
      school_id: nextSchoolId,
      label: nextLabel,
      exam_date: nextExamDate,
    })
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '資料重複，請確認後再試', code: 'DUPLICATE' }, 400);
    }
    return c.json({ error: error.message, code: 'DB_ERROR' }, 500);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'school_exam',
      resourceId: id,
      resourceName: nextLabel,
      action: 'school_exam.update',
      details: {
        academicYear: nextAcademicYear,
        semester: nextSemester,
        examType: nextExamType,
        subjectId: nextSubjectId,
        name: nextName,
        schoolId: nextSchoolId,
      },
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true, label: nextLabel }, 200);
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['SchoolExams'],
  summary: '刪除學校考試',
  request: {
    params: z.object({ id: DbUuidSchema }),
  },
  responses: {
    200: {
      description: '刪除成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '已有成績，無法刪除',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '找不到資料',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(deleteRouteDef, async (c) => {
  // `school_exams` 是**學校段考的機構層目錄**（學年 × 學期 × 類型），不是老師辦的考試 ——
  // 沒有 created_by、沒有班級關聯。兩個老師各自建一筆「第一次段考」只會製造重複資料。
  // 成績是另一回事：段考成績照樣由老師登錄（見 upsertScores 的範圍檢查）。
  if (!canManageOrgExam(c.get('roles') ?? [])) {
    return c.json({ error: '段考目錄只有管理員能維護', code: 'ORG_EXAM_ADMIN_ONLY' }, 403);
  }
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const existing = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  const { count, error: countError } = await supabase
    .from('school_scores')
    .select('id', { count: 'exact', head: true })
    .eq('school_exam_id', id);

  if (countError) {
    return c.json({ error: countError.message, code: 'DB_ERROR' }, 500);
  }

  if ((count ?? 0) > 0) {
    return c.json({ error: '已有成績紀錄，無法刪除', code: 'HAS_SCORES' }, 400);
  }

  const { error } = await supabase.from('school_exams').delete().eq('id', id).eq('org_id', orgId);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 500);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'school_exam',
      resourceId: id,
      resourceName: existing.label,
      action: 'school_exam.delete',
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
});

const listScoresRoute = createRoute({
  method: 'get',
  path: '/{id}/scores',
  tags: ['SchoolExams'],
  summary: '取得學校考試成績',
  request: {
    params: z.object({ id: DbUuidSchema }),
    query: z.object({
      studentId: DbUuidSchema.optional(),
    }),
  },
  responses: {
    200: {
      description: '成績列表',
      content: {
        'application/json': {
          schema: SchoolScoreListResponseSchema,
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '查詢失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '找不到資料',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(listScoresRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');
  const { studentId } = c.req.valid('query');

  const schoolExam = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!schoolExam) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  // #2493 R6：受限管理員只看範圍內學生的成績（原本整份全機構名冊）
  const scoreCampusIds = campusFilterIds(getCampusScope(c), undefined);
  if (scoreCampusIds !== null && scoreCampusIds.length === 0) return c.json({ data: [] }, 200);
  let query = supabase
    .from('school_scores')
    .select(
      'student_id, subject_id, score, status, notes, updated_at, students(name, grade), subjects(id, name)' +
        (scoreCampusIds ? `, ${SCORE_SCOPE_EMBED}` : ''),
    )
    .eq('school_exam_id', id);
  if (scoreCampusIds) query = query.in(SCORE_SCOPE_COLUMN, [...scoreCampusIds]);

  if (studentId) {
    query = query.eq('student_id', studentId);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 500);
  }

  const rows = (data ?? []) as unknown as ScoreRowWithRelations[];

  return c.json(
    {
      data: rows.map((row) => ({
        studentId: row.student_id,
        studentName: pickRelationFirst(row.students)?.name ?? '',
        studentGrade: pickRelationFirst(row.students)?.grade ?? null,
        subjectId: row.subject_id,
        subjectName: pickRelationFirst(row.subjects)?.name ?? '',
        score: row.score,
        status: row.status,
        notes: row.notes,
        updatedAt: row.updated_at,
      })),
    },
    200,
  );
});

const upsertScoresRoute = createRoute({
  method: 'post',
  path: '/{id}/scores',
  tags: ['SchoolExams'],
  summary: '批次登錄/更新學校考試成績',
  request: {
    params: z.object({ id: DbUuidSchema }),
    body: {
      content: {
        'application/json': {
          schema: BatchUpsertSchoolScoresSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '登錄成功',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            affected: z.number().int().min(0),
            // 被清空而刪掉的列數（#886）
            removed: z.number().int().min(0),
          }),
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '資料錯誤',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '找不到資料',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: {
      description: '成績與操作紀錄同一個交易，任何一步失敗就整筆回滾（#1931）',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

app.openapi(upsertScoresRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const schoolExam = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!schoolExam) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  // 完成後仍可修改（#1931，照 A6 scores）：每一筆修改的舊值→新值跟成績同一個交易進操作紀錄

  // **段考的目錄是管理員的，成績還是老師的。** 老師只能登錄自己固定任課班的學生 ——
  // 「看得到這份段考」不等於「可以登錄全校的成績」
  const roles = c.get('roles') ?? [];
  if (!roles.includes('admin')) {
    const scope = await loadTeachingScope(supabase, { orgId, userId, roles });
    if ('forbidden' in scope || !scope.teacherStaffId) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    const taught = await taughtClassIds(supabase, orgId, scope.teacherStaffId);
    const requestedStudentIds = Array.from(new Set(body.scores.map((item) => item.studentId)));

    if (taught.length === 0) {
      return c.json({ error: '沒有任課班級', code: 'NO_TAUGHT_CLASS' }, 403);
    }

    // 學生 id 分段送（#2232：一張段考名冊上百人，整串放 URL 會 414）；讀不到就 500，不吞成「全部不在範圍」
    const { data: allowedRows, error: allowedError } = await inChunks<{ student_id: string }>(
      requestedStudentIds,
      (part) =>
        supabase
          .from('enrollments')
          .select('student_id')
          .eq('org_id', orgId)
          .in('class_id', taught)
          .in('student_id', part),
    );
    if (allowedError) {
      return c.json({ error: allowedError.message, code: 'DB_ERROR' }, 500);
    }
    const allowed = new Set(
      (allowedRows ?? []).map((row: { student_id: string }) => row.student_id),
    );

    if (requestedStudentIds.some((studentId) => !allowed.has(studentId))) {
      return c.json({ error: '包含非自己任課班的學生', code: 'STUDENT_OUT_OF_SCOPE' }, 403);
    }
  } else if (getCampusScope(c) !== null) {
    // #2493 W5：受限管理員只能登錄範圍內學生的成績（同 academy-exams，studentInScope 判準）
    const campusScope = getCampusScope(c);
    const requestedStudentIds = Array.from(new Set(body.scores.map((item) => item.studentId)));
    const { data: scopedRows, error: scopedError } = await inChunks<{
      id: string;
      enrollments: unknown;
    }>(requestedStudentIds, (part) =>
      supabase
        .from('students')
        .select('id, enrollments(classes(campus_id))')
        .eq('org_id', orgId)
        .in('id', part),
    );
    if (scopedError) return c.json({ error: scopedError.message, code: 'DB_ERROR' }, 500);
    const inScope = new Set(
      (scopedRows ?? [])
        .filter((row) => studentInScope(row.enrollments, campusScope))
        .map((row) => row.id),
    );
    if (requestedStudentIds.some((studentId) => !inScope.has(studentId))) {
      return c.json({ error: '包含不在你分校範圍內的學生', code: 'STUDENT_OUT_OF_SCOPE' }, 403);
    }
  }

  if (schoolExam.subject_id !== null) {
    const hasDisallowedSubject = body.scores.some(
      (item) => item.subjectId !== schoolExam.subject_id,
    );
    if (hasDisallowedSubject) {
      return c.json({ error: '此考試僅允許登錄指定科目的成績', code: 'SUBJECT_NOT_ALLOWED' }, 400);
    }
  }

  const studentIds = Array.from(new Set(body.scores.map((item) => item.studentId)));
  const subjectIds = Array.from(new Set(body.scores.map((item) => item.subjectId)));

  const [{ data: students, error: studentError }, { data: subjects, error: subjectError }] =
    await Promise.all([
      inChunks(studentIds, (part) =>
        supabase.from('students').select('id').eq('org_id', orgId).in('id', part),
      ),
      supabase.from('subjects').select('id').eq('org_id', orgId).in('id', subjectIds),
    ]);

  if (studentError || subjectError) {
    return c.json(
      { error: studentError?.message ?? subjectError?.message ?? 'DB_ERROR', code: 'DB_ERROR' },
      500,
    );
  }

  if ((students ?? []).length !== studentIds.length) {
    return c.json({ error: '存在不屬於此機構的 studentId', code: 'INVALID_STUDENT_IDS' }, 400);
  }

  if ((subjects ?? []).length !== subjectIds.length) {
    return c.json({ error: '存在不屬於此機構的 subjectId', code: 'INVALID_SUBJECT_IDS' }, 400);
  }

  // 清空分數 ＝ 刪除那一列（#886）。跟補習班考試同一條語意、同一個判準 ——
  // 兩邊分開做的話會有一段時間「補習班考試清得掉、學校考試清不掉」，
  // 而那個不一致沒有辦法對使用者解釋。
  const { toUpsert, toDelete } = splitScoreMutations(body.scores);

  // 成績與操作紀錄要全有或全無，不退回 supabase-js 逐句寫（pg-pool-writes rule 6）
  const pool = getAuth(c).pool;
  if (!pool) return c.json({ error: '儲存失敗', code: 'DB_POOL_UNAVAILABLE' }, 500);
  const userName = await loadDisplayName(supabase, orgId, userId);

  let result;
  try {
    // ⚠️ 學校考試的唯一鍵是三段（多一個 `subject_id`）：刪除一定要帶科目，
    // 只用學生刪會把他沒有被清空的其他科一起刪掉（lib 裡照三段鍵刪）
    result = await writeExamScores(pool, {
      kind: 'school',
      orgId,
      userId,
      userName,
      examId: id,
      examName: schoolExam.label,
      toUpsert: toUpsert.map((item) => ({
        studentId: item.studentId,
        subjectId: item.subjectId,
        score: item.score,
        status: item.status,
        notes: item.notes ?? null,
      })),
      toDelete: toDelete.map((item) => ({ studentId: item.studentId, subjectId: item.subjectId })),
    });
  } catch (err) {
    console.error('[school-exams] 寫入成績失敗，已整筆回滾', err);
    return c.json({ error: '儲存失敗，成績沒有變動', code: 'DB_ERROR' }, 500);
  }
  if (result.status === 'not-found') {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ success: true, affected: toUpsert.length, removed: toDelete.length }, 200);
});

const closeRoute = createRoute({
  method: 'patch',
  path: '/{id}/close',
  tags: ['SchoolExams'],
  summary: '結束學校考試（active -> closed）',
  request: {
    params: z.object({ id: DbUuidSchema }),
  },
  responses: {
    200: {
      description: '更新成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '狀態錯誤',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '找不到資料',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(closeRoute, async (c) => {
  // `school_exams` 是**學校段考的機構層目錄**（學年 × 學期 × 類型），不是老師辦的考試 ——
  // 沒有 created_by、沒有班級關聯。兩個老師各自建一筆「第一次段考」只會製造重複資料。
  // 成績是另一回事：段考成績照樣由老師登錄（見 upsertScores 的範圍檢查）。
  if (!canManageOrgExam(c.get('roles') ?? [])) {
    return c.json({ error: '段考目錄只有管理員能維護', code: 'ORG_EXAM_ADMIN_ONLY' }, 403);
  }
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const existing = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  if (existing.status !== 'active') {
    return c.json({ error: '僅 active 可結束', code: 'INVALID_STATUS' }, 400);
  }

  const { error } = await supabase
    .from('school_exams')
    .update({ status: 'closed' })
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 500);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'school_exam',
      resourceId: id,
      resourceName: existing.label,
      action: 'school_exam.close',
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
});

const reopenRoute = createRoute({
  method: 'patch',
  path: '/{id}/reopen',
  tags: ['SchoolExams'],
  summary: '重新開啟學校考試（closed -> active）',
  request: {
    params: z.object({ id: DbUuidSchema }),
  },
  responses: {
    200: {
      description: '更新成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '狀態錯誤',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '找不到資料',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(reopenRoute, async (c) => {
  // `school_exams` 是**學校段考的機構層目錄**（學年 × 學期 × 類型），不是老師辦的考試 ——
  // 沒有 created_by、沒有班級關聯。兩個老師各自建一筆「第一次段考」只會製造重複資料。
  // 成績是另一回事：段考成績照樣由老師登錄（見 upsertScores 的範圍檢查）。
  if (!canManageOrgExam(c.get('roles') ?? [])) {
    return c.json({ error: '段考目錄只有管理員能維護', code: 'ORG_EXAM_ADMIN_ONLY' }, 403);
  }
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const existing = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  if (existing.status !== 'closed') {
    return c.json({ error: '僅 closed 可重新開啟', code: 'INVALID_STATUS' }, 400);
  }

  const { error } = await supabase
    .from('school_exams')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 500);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'school_exam',
      resourceId: id,
      resourceName: existing.label,
      action: 'school_exam.reopen',
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
});

const recentStudentsRoute = createRoute({
  method: 'get',
  path: '/{id}/recent-students',
  tags: ['SchoolExams'],
  summary: '該學校考試已有成績的學生列表（最近登錄優先）',
  request: {
    params: z.object({ id: DbUuidSchema }),
  },
  responses: {
    200: {
      description: '學生列表',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(RecentSchoolExamStudentSchema),
          }),
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '查詢失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '找不到資料',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(recentStudentsRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');

  const schoolExam = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!schoolExam) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  // #2493 R6：受限管理員只看範圍內學生
  const recentCampusIds = campusFilterIds(getCampusScope(c), undefined);
  if (recentCampusIds !== null && recentCampusIds.length === 0) return c.json({ data: [] }, 200);
  let recentQuery = supabase
    .from('school_scores')
    .select(
      'student_id, updated_at, students(name, grade)' +
        (recentCampusIds ? `, ${SCORE_SCOPE_EMBED}` : ''),
    )
    .eq('school_exam_id', id);
  if (recentCampusIds) recentQuery = recentQuery.in(SCORE_SCOPE_COLUMN, [...recentCampusIds]);
  const { data, error } = (await recentQuery) as unknown as {
    data: Array<{
      student_id: string;
      updated_at: string;
      students: { name: string; grade: string | null } | null;
    }> | null;
    error: { message: string } | null;
  };

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 500);
  }

  const aggregated = new Map<
    string,
    {
      studentId: string;
      studentName: string;
      studentGrade: string | null;
      scoreCount: number;
      lastUpdatedAt: string;
    }
  >();

  for (const row of data ?? []) {
    const student = pickRelationFirst(row.students);
    const existing = aggregated.get(row.student_id);
    if (!existing) {
      aggregated.set(row.student_id, {
        studentId: row.student_id,
        studentName: student?.name ?? '',
        studentGrade: student?.grade ?? null,
        scoreCount: 1,
        lastUpdatedAt: row.updated_at,
      });
      continue;
    }

    existing.scoreCount += 1;
    if (Date.parse(row.updated_at) > Date.parse(existing.lastUpdatedAt)) {
      existing.lastUpdatedAt = row.updated_at;
    }
    if (!existing.studentName && student?.name) {
      existing.studentName = student.name;
    }
    if (!existing.studentGrade && student?.grade) {
      existing.studentGrade = student.grade;
    }
  }

  const rows = Array.from(aggregated.values()).sort(
    (a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt),
  );

  return c.json({ data: rows }, 200);
});

const studentsRoute = createRoute({
  method: 'get',
  path: '/{id}/students',
  tags: ['SchoolExams'],
  summary: '取得學校考試下的學生列表（支援 campus / status / search / grade 過濾）',
  request: {
    params: z.object({ id: DbUuidSchema }),
    query: z.object({
      campusId: DbUuidSchema.optional(),
      status: z.enum(['all', 'pending', 'scored', 'absent', 'makeup']).default('all').optional(),
      search: z.string().trim().min(1).optional(),
      grade: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).default(50).optional(),
    }),
  },
  responses: {
    200: {
      description: '學生列表',
      content: {
        'application/json': {
          schema: SchoolExamStudentListResponseSchema,
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '查詢失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '找不到資料',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(studentsRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');
  const { campusId, status = 'all', search, grade, page = 1, pageSize = 50 } = c.req.valid('query');

  const schoolExam = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!schoolExam) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  const { count: subjectCount } = await supabase
    .from('subjects')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);

  // 分校範圍（#1928）：條件放進 embed 的 `!inner` 在 DB 端篩，不先撈範圍內學生 id 再 `.in()` 回去（兩三百位就 414）。
  // 同 routes/students.ts：**不濾 enrollment status**，這條同時是 campusScope 授權的路
  // （kb/wiki/rules/enrollment-rules.md 第 8 節）
  const campusIds = campusFilterIds(getCampusScope(c), campusId);
  if (campusIds !== null && campusIds.length === 0) {
    return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
  }
  // 這場的成績直接掛在學生底下（embed 上的條件只篩子列），不再拿整校學生的 id 另查 —— 那份清單也會 414。
  // 分頁撈齊：一所學校在籍的學生可能過千（max_rows 1000 會靜默截斷）
  const { rows: studentsData, error: studentsError } = await fetchAllPages((from, to) => {
    let query = supabase
      .from('students')
      .select(
        'id, name, grade, is_active, enrollments(id, classes(campus_id, campuses(name))), ' +
          'school_scores(status, updated_at, school_exam_id)' +
          (campusIds ? ', scope_campus:enrollments!inner(classes!inner(campus_id))' : ''),
      )
      .eq('org_id', orgId)
      .eq('is_active', true)
      .eq('school_id', schoolExam.school_id)
      .eq('school_scores.school_exam_id', id);
    if (grade) query = query.eq('grade', grade);
    if (search) query = query.ilike('name', `%${search}%`);
    if (campusIds) query = query.in('scope_campus.classes.campus_id', [...campusIds]);
    return query.order('name').order('id').range(from, to);
  });

  if (studentsError) {
    return c.json(
      { error: (studentsError as { message?: string }).message ?? '查詢失敗', code: 'DB_ERROR' },
      500,
    );
  }

  const studentRows = studentsData as unknown as Array<{
    id: string;
    name: string | null;
    grade: string | null;
    is_active: boolean;
    enrollments?: Array<{
      id: string;
      classes: { campus_id: string | null; campuses: { name: string } | null } | null;
    }> | null;
    school_scores?: Array<{
      status: 'scored' | 'absent' | 'makeup';
      updated_at: string;
    }> | null;
  }>;

  if (studentRows.length === 0) {
    return c.json(
      {
        data: [],
        meta: { total: 0, page, pageSize },
      },
      200,
    );
  }

  const scoreRows = studentRows.flatMap((row) =>
    (row.school_scores ?? []).map((score) => ({ student_id: row.id, ...score })),
  );

  const aggregated = new Map<
    string,
    {
      scoreCount: number;
      hasScored: boolean;
      hasAbsent: boolean;
      hasMakeup: boolean;
      lastUpdatedAt: string | null;
    }
  >();

  for (const row of (scoreRows ?? []) as Array<{
    student_id: string;
    status: 'scored' | 'absent' | 'makeup';
    updated_at: string;
  }>) {
    const entry = aggregated.get(row.student_id) ?? {
      scoreCount: 0,
      hasScored: false,
      hasAbsent: false,
      hasMakeup: false,
      lastUpdatedAt: null as string | null,
    };
    entry.scoreCount += 1;
    if (row.status === 'scored') entry.hasScored = true;
    if (row.status === 'absent') entry.hasAbsent = true;
    if (row.status === 'makeup') entry.hasMakeup = true;
    if (!entry.lastUpdatedAt || Date.parse(row.updated_at) > Date.parse(entry.lastUpdatedAt)) {
      entry.lastUpdatedAt = row.updated_at;
    }
    aggregated.set(row.student_id, entry);
  }

  const allRows = studentRows.map((row) => {
    const agg = aggregated.get(row.id);
    // 不濾 enrollment status，跟 routes/students.ts 的 campusNames 同一條規則
    // （kb/wiki/rules/enrollment-rules.md 第 8 節）——分校歸屬看「收過他」不看現在的狀態
    const campusNames = Array.from(
      new Set(
        (row.enrollments ?? [])
          .map((e) => e.classes?.campuses?.name)
          .filter((n): n is string => !!n),
      ),
    );

    return {
      studentId: row.id,
      studentName: row.name ?? '',
      studentGrade: row.grade,
      campusNames,
      scoreCount: agg?.scoreCount ?? 0,
      subjectCount: subjectCount ?? 0,
      hasScored: agg?.hasScored ?? false,
      hasAbsent: agg?.hasAbsent ?? false,
      hasMakeup: agg?.hasMakeup ?? false,
      lastUpdatedAt: agg?.lastUpdatedAt ?? null,
    };
  });

  const filtered = allRows.filter((row) => {
    switch (status) {
      case 'pending':
        return row.scoreCount === 0;
      case 'scored':
        return row.hasScored;
      case 'absent':
        return row.hasAbsent;
      case 'makeup':
        return row.hasMakeup;
      default:
        return true;
    }
  });

  const total = filtered.length;
  const from = (page - 1) * pageSize;
  const paged = filtered.slice(from, from + pageSize);

  return c.json(
    {
      data: paged,
      meta: { total, page, pageSize },
    },
    200,
  );
});

const byStudentRoute = createRoute({
  method: 'get',
  path: '/by-student/{studentId}',
  tags: ['SchoolExams'],
  summary: '取得學生學校考試成績',
  request: {
    params: z.object({ studentId: DbUuidSchema }),
  },
  responses: {
    200: {
      description: '學生學校考試成績列表',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(StudentSchoolScoreSchema) }),
        },
      },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: '查詢失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '找不到學生',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    500: { description: 'DB 錯誤', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(byStudentRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { studentId } = c.req.valid('param');

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id')
    .eq('id', studentId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (studentError) {
    return c.json({ error: studentError.message, code: 'DB_ERROR' }, 500);
  }

  // #2493 R6：範圍外的學生跟不存在一樣（同 GET /students/:id）
  if (!student || (await outOfCampusScope(supabase, orgId, studentId, getCampusScope(c)))) {
    return c.json({ error: '找不到學生', code: 'NOT_FOUND' }, 404);
  }

  const { data, error } = await supabase
    .from('school_scores')
    .select(
      'score, status, notes, updated_at, school_exams!inner(id, academic_year, semester, exam_type, name, label, exam_date, created_at, org_id), subjects(id, name)',
    )
    .eq('student_id', studentId)
    .eq('school_exams.org_id', orgId);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 500);
  }

  const rows = (data ?? []) as StudentScoreRow[];
  const mapped = rows
    .map((row) => {
      const schoolExam = pickRelationFirst(row.school_exams);
      const subject = pickRelationFirst(row.subjects);

      if (!schoolExam || !subject) {
        return null;
      }

      return {
        schoolExamId: schoolExam.id,
        label: schoolExam.label,
        academicYear: schoolExam.academic_year,
        semester: schoolExam.semester,
        examType: schoolExam.exam_type,
        name: schoolExam.name,
        examDate: schoolExam.exam_date,
        examCreatedAt: schoolExam.created_at,
        subjectId: subject.id,
        subjectName: subject.name ?? '',
        score: row.score,
        status: row.status,
        notes: row.notes,
        updatedAt: row.updated_at,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => {
      return compareSchoolExamChronologically(
        { examDate: a.examDate, createdAt: a.examCreatedAt, id: a.schoolExamId },
        { examDate: b.examDate, createdAt: b.examCreatedAt, id: b.schoolExamId },
      );
    })
    .map((row) => ({
      schoolExamId: row.schoolExamId,
      label: row.label,
      academicYear: row.academicYear,
      semester: row.semester,
      examType: row.examType,
      name: row.name,
      subjectId: row.subjectId,
      subjectName: row.subjectName,
      score: row.score,
      status: row.status,
      notes: row.notes,
      updatedAt: row.updatedAt,
    }));

  return c.json({ data: mapped }, 200);
});

export default app;
