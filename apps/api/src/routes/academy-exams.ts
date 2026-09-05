import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { loadTeachingScope, taughtClassIds } from '../lib/teacher-scope';
import { canManageAcademyExam, resolveExamClassIds } from '../lib/exam-scope';
import { logAudit } from '../utils/audit';
import { applyCampusFilter } from '../lib/campus-scope';

const AcademyExamStatusSchema = z.enum(['active', 'closed']).openapi('AcademyExamStatus');

const AcademyExamTypeSchema = z
  .enum(['quiz', 'mock_exam', 'placement_test'])
  .openapi('AcademyExamType');

const ScoreStatusSchema = z.enum(['scored', 'absent', 'makeup']).openapi('ScoreStatus');

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi('AcademyExamError');

const AcademyExamListItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    examType: AcademyExamTypeSchema,
    status: AcademyExamStatusSchema,
    examDate: z.string(),
    totalScore: z.number(),
    passScore: z.number().nullable(),
    scopeNote: z.string().nullable(),
    campusId: z.uuid().nullable(),
    subjectId: z.uuid().nullable(),
    subjectName: z.string().nullable(),
    classCount: z.number().int(),
    scoreCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AcademyExamListItem');

const AcademyExamListResponseSchema = z
  .object({
    data: z.array(AcademyExamListItemSchema),
    meta: z.object({
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
    }),
  })
  .openapi('AcademyExamListResponse');

const AcademyExamClassSchema = z
  .object({
    classId: z.uuid(),
    className: z.string(),
    campusName: z.string().nullable(),
    courseName: z.string().nullable(),
  })
  .openapi('AcademyExamClass');

const AcademyExamScoreSummarySchema = z
  .object({
    averageScore: z.number().nullable(),
    highestScore: z.number().nullable(),
    lowestScore: z.number().nullable(),
    absentCount: z.number().int(),
    recordedCount: z.number().int(),
  })
  .openapi('AcademyExamScoreSummary');

const AcademyExamDetailSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    examType: AcademyExamTypeSchema,
    status: AcademyExamStatusSchema,
    examDate: z.string(),
    totalScore: z.number(),
    passScore: z.number().nullable(),
    scopeNote: z.string().nullable(),
    campusId: z.uuid().nullable(),
    campusName: z.string().nullable(),
    subjectId: z.uuid().nullable(),
    subjectName: z.string().nullable(),
    classes: z.array(AcademyExamClassSchema),
    summary: AcademyExamScoreSummarySchema,
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AcademyExamDetail');

const CreateAcademyExamSchema = z
  .object({
    name: z.string().min(1).max(200),
    examType: AcademyExamTypeSchema,
    subjectId: DbUuidSchema.nullable().optional(),
    campusId: DbUuidSchema.nullable().optional(),
    examDate: z.string().date(),
    totalScore: z.number().min(0).max(9999).optional(),
    // null = 未設，沿用「總分 × 60%」的既有退路（見 score-threshold.util.ts）
    passScore: z.number().min(0).max(9999).nullable().optional(),
    scopeNote: z.string().max(5000).nullable().optional(),
    classIds: z.array(DbUuidSchema).min(1),
  })
  .openapi('CreateAcademyExam');

const UpdateAcademyExamSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    examType: AcademyExamTypeSchema.optional(),
    subjectId: DbUuidSchema.nullable().optional(),
    campusId: DbUuidSchema.nullable().optional(),
    examDate: z.string().date().optional(),
    totalScore: z.number().min(0).max(9999).optional(),
    passScore: z.number().min(0).max(9999).nullable().optional(),
    scopeNote: z.string().max(5000).nullable().optional(),
    classIds: z.array(DbUuidSchema).min(1).optional(),
  })
  .openapi('UpdateAcademyExam');

export interface AcademyScoreListRow {
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  score: number | null;
  status: 'scored' | 'absent' | 'makeup';
  notes: string | null;
  updatedAt: string | null;
  classIds: string[];
}

interface EnrollmentRowInput {
  student_id: string;
  class_id: string | null;
  students: unknown;
}

interface ScoredRowInput {
  student_id: string;
  score: number | null;
  status: 'scored' | 'absent' | 'makeup';
  notes: string | null;
  updated_at: string | null;
  students: unknown;
}

/**
 * 把「這場考試的在籍學生」與「已登錄的成績」合併成成績登錄畫面的列。
 *
 * classIds 是**陣列**：一個學生可能同時在這場考試的多個班級裡（例如數學 A 班 + 數學進階班）。
 * 取第一個命中的班級會讓「按班級篩選」漏掉跨班學生 —— 明明有成績卻找不到人。
 */
export function buildAcademyScoreRows(
  enrolledStudents: readonly EnrollmentRowInput[],
  scoredRows: readonly ScoredRowInput[],
): AcademyScoreListRow[] {
  const studentMap = new Map<string, AcademyScoreListRow>();

  for (const row of enrolledStudents) {
    const student = pickRelationFirst(row.students) as { name?: string; grade?: string } | null;
    const existing = studentMap.get(row.student_id);
    // 同一學生在多個班級各有一筆 enrollment —— classIds 要累積而不是覆蓋
    const classIds = existing ? [...existing.classIds] : [];
    if (row.class_id && !classIds.includes(row.class_id)) classIds.push(row.class_id);

    studentMap.set(row.student_id, {
      studentId: row.student_id,
      studentName: student?.name ?? existing?.studentName ?? '',
      studentGrade: student?.grade ?? existing?.studentGrade ?? null,
      score: existing?.score ?? null,
      status: existing?.status ?? 'scored',
      notes: existing?.notes ?? null,
      updatedAt: existing?.updatedAt ?? null,
      classIds,
    });
  }

  for (const row of scoredRows) {
    const student = pickRelationFirst(row.students) as { name?: string; grade?: string } | null;
    const existingRow = studentMap.get(row.student_id);
    studentMap.set(row.student_id, {
      studentId: row.student_id,
      studentName: student?.name ?? existingRow?.studentName ?? '',
      studentGrade: student?.grade ?? existingRow?.studentGrade ?? null,
      score: row.score,
      status: row.status,
      notes: row.notes,
      updatedAt: row.updated_at,
      // 成績那一輪不知道班級，沿用 enrollment 那一輪累積的結果
      classIds: existingRow?.classIds ?? [],
    });
  }

  return Array.from(studentMap.values()).sort((a, b) => {
    const aTs = a.updatedAt ? Date.parse(a.updatedAt) : Number.NaN;
    const bTs = b.updatedAt ? Date.parse(b.updatedAt) : Number.NaN;
    const aHasTs = Number.isFinite(aTs);
    const bHasTs = Number.isFinite(bTs);

    if (aHasTs && bHasTs) return bTs - aTs;
    if (aHasTs) return -1;
    if (bHasTs) return 1;
    return a.studentName.localeCompare(b.studentName, 'zh-Hant');
  });
}

const AcademyScoreSchema = z
  .object({
    studentId: z.uuid(),
    studentName: z.string(),
    studentGrade: z.string().nullable(),
    score: z.number().nullable(),
    status: ScoreStatusSchema,
    notes: z.string().nullable(),
    updatedAt: z.string().nullable(),
    // 一個學生可能同時在這場考試的多個班級裡（例如數學 A 班 + 數學進階班），
    // 所以是陣列而非單一 classId —— 取第一個會讓「按班級篩選」漏掉跨班的學生。
    classIds: z.array(z.uuid()),
  })
  .openapi('AcademyScore');

const AcademyScoreListResponseSchema = z
  .object({
    data: z.array(AcademyScoreSchema),
  })
  .openapi('AcademyScoreListResponse');

const BatchUpsertScoresSchema = z
  .object({
    scores: z
      .array(
        z.object({
          studentId: DbUuidSchema,
          score: z.number().min(0).max(9999).nullable(),
          status: ScoreStatusSchema,
          notes: z.string().max(5000).nullable().optional(),
        }),
      )
      .min(1),
  })
  .openapi('BatchUpsertScores');

const app = new OpenAPIHono<AppEnv>();

interface ExamListRow {
  id: string;
  name: string;
  exam_type: 'quiz' | 'mock_exam' | 'placement_test';
  status: 'active' | 'closed';
  exam_date: string;
  total_score: number;
  pass_score: number | null;
  scope_note: string | null;
  campus_id: string | null;
  subject_id: string | null;
  created_at: string;
  updated_at: string;
  subjects?: { name: string | null } | Array<{ name: string | null }> | null;
  academy_exam_classes?: Array<{ count: number | null }> | null;
  academy_scores?: Array<{ count: number | null }> | null;
}

interface ExamClassRow {
  class_id: string;
  classes?:
    | {
        name: string | null;
        campuses?: { name: string | null } | Array<{ name: string | null }> | null;
        courses?: { name: string | null } | Array<{ name: string | null }> | null;
      }
    | Array<{
        name: string | null;
        campuses?: { name: string | null } | Array<{ name: string | null }> | null;
        courses?: { name: string | null } | Array<{ name: string | null }> | null;
      }>
    | null;
}

interface AcademyScoreRow {
  score: number | null;
  status: 'scored' | 'absent' | 'makeup';
}

function pickRelationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/**
 * 及格線合不合法 —— 跟 migration 的 `academy_exams_pass_score_range` CHECK
 * 是同一條規則，**這裡先擋一次是為了給友善的錯誤訊息**，不是取代 DB constraint
 * （DB 那道才是真正的最後防線，這裡漏接的話還有它兜底）。
 *
 * `null` / `undefined` 一律合法 —— 那是「未設」，不是「設成 0」。
 */
export function isPassScoreValid(
  passScore: number | null | undefined,
  totalScore: number,
): boolean {
  if (passScore === null || passScore === undefined) return true;
  return passScore >= 0 && passScore <= totalScore;
}

async function ensureExamOwnedByOrg(
  supabase: AppEnv['Variables']['supabase'],
  examId: string,
  orgId: string,
): Promise<{
  id: string;
  name: string;
  status: 'active' | 'closed';
  created_by: string | null;
  total_score: number;
} | null> {
  const { data, error } = await supabase
    .from('academy_exams')
    .select('id, name, status, created_by, total_score')
    .eq('id', examId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    name: data.name,
    status: data.status,
    created_by: (data as { created_by?: string | null }).created_by ?? null,
    total_score: (data as { total_score: number }).total_score,
  };
}

/**
 * 這個請求的考試範圍。**管理員不受限，老師只碰自己固定任課的班**
 * （`schedules.teacher_id`，不含代課 —— 跟聯絡簿／教務日誌共用 `lib/teacher-scope.ts`）。
 *
 * `taught` 只有老師會用到；管理員拿到空陣列但 `isAdmin` 是 true，兩者要一起看。
 */
async function loadExamScope(
  supabase: AppEnv['Variables']['supabase'],
  params: { orgId: string; userId: string; roles: readonly string[] },
): Promise<{ isAdmin: boolean; taught: string[] } | { forbidden: true }> {
  const scope = await loadTeachingScope(supabase, {
    orgId: params.orgId,
    userId: params.userId,
    roles: params.roles,
  });
  if ('forbidden' in scope) return { forbidden: true };

  return {
    isAdmin: params.roles.includes('admin'),
    taught: scope.teacherStaffId
      ? await taughtClassIds(supabase, params.orgId, scope.teacherStaffId)
      : [],
  };
}

/**
 * 這位老師看不看得到這場考試 —— **參加班級裡有沒有自己任課的班**，不看誰建的。
 * 登錄成績本來就是老師的工作，別人建的考試只要含自己的班就要看得到。
 */
async function examInScope(
  supabase: AppEnv['Variables']['supabase'],
  examId: string,
  scope: { isAdmin: boolean; taught: string[] },
): Promise<boolean> {
  if (scope.isAdmin) return true;
  if (scope.taught.length === 0) return false;

  const classIds = await examClassIds(supabase, examId);
  return classIds.some((classId) => scope.taught.includes(classId));
}

/** 某場考試目前的參加班級 */
async function examClassIds(
  supabase: AppEnv['Variables']['supabase'],
  examId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('academy_exam_classes')
    .select('class_id')
    .eq('exam_id', examId);

  return (data ?? []).map((row: { class_id: string }) => row.class_id);
}

async function ensureClassesInOrg(
  supabase: AppEnv['Variables']['supabase'],
  orgId: string,
  classIds: readonly string[],
): Promise<boolean> {
  if (classIds.length === 0) {
    return true;
  }

  const dedupedClassIds = Array.from(new Set(classIds));
  const { data, error } = await supabase
    .from('classes')
    .select('id')
    .eq('org_id', orgId)
    .in('id', dedupedClassIds);

  if (error) {
    return false;
  }

  return (data ?? []).length === dedupedClassIds.length;
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['AcademyExams'],
  summary: '取得補習班考試列表',
  request: {
    query: z.object({
      search: z.string().optional(),
      status: AcademyExamStatusSchema.optional(),
      campus_id: DbUuidSchema.optional(),
      subject_id: DbUuidSchema.optional(),
      class_id: DbUuidSchema.optional(),
      date_from: z.string().date().optional(),
      date_to: z.string().date().optional(),
      todo: z.coerce.boolean().optional(),
      order: z.enum(['date_asc', 'date_desc']).default('date_desc').optional(),
      page: z.coerce.number().int().min(1).default(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).default(20).optional(),
    }),
  },
  responses: {
    200: {
      description: '考試列表',
      content: {
        'application/json': {
          schema: AcademyExamListResponseSchema,
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
  },
});

app.openapi(listRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const {
    search,
    status,
    campus_id: campusId,
    subject_id: subjectId,
    class_id: classId,
    date_from: dateFrom,
    date_to: dateTo,
    todo = false,
    order = 'date_desc',
    page = 1,
    pageSize = 20,
  } = c.req.valid('query');
  const isDateAsc = order === 'date_asc';

  const scope = await loadExamScope(supabase, {
    orgId,
    userId: c.get('userId'),
    roles: c.get('roles') ?? [],
  });
  if ('forbidden' in scope) {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }

  let classFilteredExamIds: string[] | null = null;

  // 老師只看得到「參加班級裡有自己任課的班」的考試。沒有任何班就回空 —— 不是回全部
  if (!scope.isAdmin) {
    if (scope.taught.length === 0) {
      return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
    }
    const { data: taughtExamRows } = await supabase
      .from('academy_exam_classes')
      .select('exam_id')
      .in('class_id', scope.taught);
    classFilteredExamIds = Array.from(
      new Set((taughtExamRows ?? []).map((row: { exam_id: string }) => row.exam_id)),
    );
    if (classFilteredExamIds.length === 0) {
      return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
    }
  }

  if (classId) {
    const { data: classExamRows, error: classExamError } = await supabase
      .from('academy_exam_classes')
      .select('exam_id')
      .eq('class_id', classId);
    if (classExamError) {
      return c.json({ error: classExamError.message, code: 'DB_ERROR' }, 400);
    }
    const byClass = (classExamRows ?? []).map((row: { exam_id: string }) => row.exam_id);
    // 老師已經有一份範圍清單時取**交集**，不是覆蓋 —— 覆蓋等於用 class_id 參數繞過範圍
    classFilteredExamIds = classFilteredExamIds
      ? classFilteredExamIds.filter((id) => byClass.includes(id))
      : byClass;
    if (classFilteredExamIds.length === 0) {
      return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
    }
  }

  let query = supabase
    .from('academy_exams')
    .select(
      `
      id,
      name,
      exam_type,
      status,
      exam_date,
      total_score,
      pass_score,
      scope_note,
      campus_id,
      subject_id,
      created_at,
      updated_at,
      subjects(name),
      academy_exam_classes(count),
      academy_scores(count)
    `,
      { count: 'exact' },
    )
    .eq('org_id', orgId);

  if (search?.trim()) {
    query = query.ilike('name', `%${search.trim()}%`);
  }
  if (todo) {
    query = query.eq('status', 'active');
  } else if (status) {
    query = query.eq('status', status);
  }
  query = applyCampusFilter(query, 'campus_id', c.get('campusScope'), campusId);
  if (subjectId) {
    query = query.eq('subject_id', subjectId);
  }
  if (dateFrom) {
    query = query.gte('exam_date', dateFrom);
  }
  if (dateTo) {
    query = query.lte('exam_date', dateTo);
  }
  if (classFilteredExamIds) {
    query = query.in('id', classFilteredExamIds);
  }

  if (todo) {
    let todoIdQuery = supabase
      .from('academy_exams')
      .select('id')
      .eq('org_id', orgId)
      .eq('status', 'active');
    if (search?.trim()) {
      todoIdQuery = todoIdQuery.ilike('name', `%${search.trim()}%`);
    }
    if (campusId) {
      todoIdQuery = todoIdQuery.eq('campus_id', campusId);
    }
    if (subjectId) {
      todoIdQuery = todoIdQuery.eq('subject_id', subjectId);
    }
    if (dateFrom) {
      todoIdQuery = todoIdQuery.gte('exam_date', dateFrom);
    }
    if (dateTo) {
      todoIdQuery = todoIdQuery.lte('exam_date', dateTo);
    }
    if (classFilteredExamIds) {
      todoIdQuery = todoIdQuery.in('id', classFilteredExamIds);
    }

    const { data: activeRows, error: todoQueryError } = await todoIdQuery.order('exam_date', {
      ascending: isDateAsc,
      nullsFirst: false,
    });
    if (todoQueryError) {
      return c.json({ error: todoQueryError.message, code: 'DB_ERROR' }, 400);
    }
    const activeExamIds = (activeRows ?? []).map((row: { id: string }) => row.id);
    if (activeExamIds.length === 0) {
      return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
    }

    const { data: scoreRows, error: scoreRowsError } = await supabase
      .from('academy_scores')
      .select('exam_id')
      .in('exam_id', activeExamIds);
    if (scoreRowsError) {
      return c.json({ error: scoreRowsError.message, code: 'DB_ERROR' }, 400);
    }

    const scoredExamIds = new Set((scoreRows ?? []).map((row: { exam_id: string }) => row.exam_id));
    const todoExamIds = activeExamIds.filter((examId) => !scoredExamIds.has(examId));
    if (todoExamIds.length === 0) {
      return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
    }
    query = query.in('id', todoExamIds);
  }

  const from = (page - 1) * pageSize;
  query = query
    .range(from, from + pageSize - 1)
    .order('exam_date', { ascending: isDateAsc, nullsFirst: false });

  const { data, error, count } = await query;

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const rows = ((data ?? []) as ExamListRow[]).map((row) => {
    const subject = pickRelationFirst(row.subjects);
    const classCount = row.academy_exam_classes?.[0]?.count ?? 0;
    const scoreCount = row.academy_scores?.[0]?.count ?? 0;

    return {
      id: row.id,
      name: row.name,
      examType: row.exam_type,
      status: row.status,
      examDate: row.exam_date,
      totalScore: row.total_score,
      passScore: row.pass_score,
      scopeNote: row.scope_note,
      campusId: row.campus_id,
      subjectId: row.subject_id,
      subjectName: subject?.name ?? null,
      classCount,
      scoreCount,
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
  tags: ['AcademyExams'],
  summary: '取得補習班考試待登錄數量',
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
  },
});

app.openapi(todoCountRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');

  const { data: activeRows, error: activeRowsError } = await supabase
    .from('academy_exams')
    .select('id')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (activeRowsError) {
    return c.json({ error: activeRowsError.message, code: 'DB_ERROR' }, 400);
  }

  const activeExamIds = (activeRows ?? []).map((row: { id: string }) => row.id);
  if (activeExamIds.length === 0) {
    return c.json({ count: 0 }, 200);
  }

  const { data: scoreRows, error: scoreRowsError } = await supabase
    .from('academy_scores')
    .select('exam_id')
    .in('exam_id', activeExamIds);

  if (scoreRowsError) {
    return c.json({ error: scoreRowsError.message, code: 'DB_ERROR' }, 400);
  }

  const scoredExamIds = new Set((scoreRows ?? []).map((row: { exam_id: string }) => row.exam_id));
  const count = activeExamIds.filter((examId) => !scoredExamIds.has(examId)).length;

  return c.json({ count }, 200);
});

const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['AcademyExams'],
  summary: '取得補習班考試單筆',
  request: {
    params: z.object({
      id: DbUuidSchema,
    }),
  },
  responses: {
    200: {
      description: '考試明細',
      content: {
        'application/json': {
          schema: z.object({ data: AcademyExamDetailSchema }),
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
  },
});

app.openapi(getRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');

  const scope = await loadExamScope(supabase, {
    orgId,
    userId: c.get('userId'),
    roles: c.get('roles') ?? [],
  });
  if ('forbidden' in scope) {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }
  if (!(await examInScope(supabase, id, scope))) {
    return c.json({ error: '沒有這場考試的權限', code: 'EXAM_OUT_OF_SCOPE' }, 403);
  }

  const { data: examRow, error: examError } = await supabase
    .from('academy_exams')
    .select(
      `
      id,
      name,
      exam_type,
      status,
      exam_date,
      total_score,
      pass_score,
      scope_note,
      campus_id,
      subject_id,
      created_by,
      created_at,
      updated_at,
      subjects(name),
      campuses(name)
    `,
    )
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (examError || !examRow) {
    return c.json({ error: '找不到考試事件', code: 'NOT_FOUND' }, 404);
  }

  const [{ data: classRows, error: classError }, { data: scoreRows, error: scoreError }] =
    await Promise.all([
      supabase
        .from('academy_exam_classes')
        .select('class_id, classes(name, campuses(name), courses(name))')
        .eq('exam_id', id),
      supabase.from('academy_scores').select('score, status').eq('exam_id', id),
    ]);

  if (classError || scoreError) {
    return c.json({ error: classError?.message ?? scoreError?.message ?? '查詢失敗' }, 400);
  }

  const classes = ((classRows ?? []) as ExamClassRow[]).map((row) => {
    const classRel = pickRelationFirst(row.classes);
    return {
      classId: row.class_id,
      className: classRel?.name ?? '',
      campusName: pickRelationFirst(classRel?.campuses)?.name ?? null,
      courseName: pickRelationFirst(classRel?.courses)?.name ?? null,
    };
  });

  const typedScoreRows = (scoreRows ?? []) as AcademyScoreRow[];
  const scoreNumbers = typedScoreRows
    .map((row) => toNumberOrNull(row.score))
    .filter((value): value is number => value !== null);

  const averageScore =
    scoreNumbers.length > 0
      ? Number(
          (scoreNumbers.reduce((sum, score) => sum + score, 0) / scoreNumbers.length).toFixed(2),
        )
      : null;
  const highestScore = scoreNumbers.length > 0 ? Math.max(...scoreNumbers) : null;
  const lowestScore = scoreNumbers.length > 0 ? Math.min(...scoreNumbers) : null;
  const absentCount = typedScoreRows.filter((row) => row.status === 'absent').length;

  const subject = pickRelationFirst(examRow.subjects);
  const campus = pickRelationFirst(
    (
      examRow as unknown as {
        campuses?: { name: string | null } | Array<{ name: string | null }> | null;
      }
    ).campuses,
  );

  return c.json(
    {
      data: {
        id: examRow.id,
        name: examRow.name,
        examType: examRow.exam_type,
        status: examRow.status,
        examDate: examRow.exam_date,
        totalScore: examRow.total_score,
        passScore: examRow.pass_score,
        scopeNote: examRow.scope_note,
        campusId: examRow.campus_id,
        campusName: campus?.name ?? null,
        subjectId: examRow.subject_id,
        subjectName: subject?.name ?? null,
        classes,
        summary: {
          averageScore,
          highestScore,
          lowestScore,
          absentCount,
          recordedCount: typedScoreRows.length,
        },
        createdBy: examRow.created_by,
        createdAt: examRow.created_at,
        updatedAt: examRow.updated_at,
      },
    },
    200,
  );
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['AcademyExams'],
  summary: '建立補習班考試事件',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateAcademyExamSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: '建立成功',
      content: {
        'application/json': {
          schema: z.object({ data: z.object({ id: z.uuid() }) }),
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
  },
});

app.openapi(createRouteDef, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const scope = await loadExamScope(supabase, {
    orgId,
    userId: c.get('userId'),
    roles: c.get('roles') ?? [],
  });
  if ('forbidden' in scope) {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }

  const requested = Array.from(new Set(body.classIds));
  // 老師建考試時參加班級只能是自己任課的班 —— 沒有這條，「可以建考試」就變成
  // 「可以把任何班拉進自己的考試」，而那看起來完全像正常操作
  const resolved = resolveExamClassIds({
    isAdmin: scope.isAdmin,
    current: [],
    requested,
    taught: scope.taught,
  });
  if ('error' in resolved) {
    return c.json({ error: '只能選自己任課的班', code: resolved.error }, 403);
  }
  const classIds = resolved.classIds;

  const isClassValid = await ensureClassesInOrg(supabase, orgId, classIds);
  if (!isClassValid) {
    return c.json({ error: '包含不合法的 classIds', code: 'INVALID_CLASS_IDS' }, 400);
  }

  const totalScore = body.totalScore ?? 100;
  if (!isPassScoreValid(body.passScore, totalScore)) {
    return c.json({ error: '及格線不能超過總分，也不能是負數', code: 'INVALID_PASS_SCORE' }, 400);
  }

  const insertExam = {
    org_id: orgId,
    name: body.name.trim(),
    exam_type: body.examType,
    subject_id: body.subjectId ?? null,
    campus_id: body.campusId ?? null,
    exam_date: body.examDate,
    total_score: totalScore,
    pass_score: body.passScore ?? null,
    scope_note: body.scopeNote ?? null,
    status: 'active' as const,
    created_by: userId,
  };

  const { data: exam, error: examError } = await supabase
    .from('academy_exams')
    .insert(insertExam)
    .select('id, name')
    .single();

  if (examError || !exam) {
    return c.json({ error: examError?.message ?? '建立考試失敗', code: 'DB_ERROR' }, 400);
  }

  if (classIds.length > 0) {
    const { error: classesError } = await supabase.from('academy_exam_classes').insert(
      classIds.map((classId) => ({
        exam_id: exam.id,
        class_id: classId,
      })),
    );

    if (classesError) {
      await supabase.from('academy_exams').delete().eq('id', exam.id).eq('org_id', orgId);
      return c.json({ error: classesError.message, code: 'DB_ERROR' }, 400);
    }
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'academy_exam',
      resourceId: exam.id,
      resourceName: exam.name,
      action: 'academy_exam.create',
      details: {
        examType: body.examType,
        examDate: body.examDate,
        classCount: classIds.length,
      },
    },
    waitUntilFrom(c),
  );

  return c.json({ data: { id: exam.id } }, 201);
});

const updateRouteDef = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['AcademyExams'],
  summary: '更新補習班考試事件',
  request: {
    params: z.object({ id: DbUuidSchema }),
    body: {
      content: {
        'application/json': {
          schema: UpdateAcademyExamSchema,
        },
      },
    },
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
  },
});

app.openapi(updateRouteDef, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await ensureExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到考試事件', code: 'NOT_FOUND' }, 404);
  }

  const scope = await loadExamScope(supabase, {
    orgId,
    userId,
    roles: c.get('roles') ?? [],
  });
  if ('forbidden' in scope) {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }

  // A3：老師只能動**自己建的**考試。別人建的只能登錄成績 ——
  // 一場考試可以跨班，刪除會 CASCADE 掉其他班的成績，而老師看不到那些班
  if (
    !canManageAcademyExam({
      roles: c.get('roles') ?? [],
      userId,
      createdBy: existing.created_by,
    })
  ) {
    return c.json({ error: '只能修改自己建立的考試', code: 'NOT_EXAM_OWNER' }, 403);
  }

  if (body.classIds) {
    // 老師可以加自己任課的班，但**不能移除自己沒任課的班** ——
    // 管理員事後把別班加進來，老師把它踢掉會刪掉別班的成績
    const resolved = resolveExamClassIds({
      isAdmin: scope.isAdmin,
      current: await examClassIds(supabase, id),
      requested: body.classIds,
      taught: scope.taught,
    });
    if ('error' in resolved) {
      return c.json({ error: '參加班級超出可管理範圍', code: resolved.error }, 403);
    }

    const isClassValid = await ensureClassesInOrg(supabase, orgId, resolved.classIds);
    if (!isClassValid) {
      return c.json({ error: '包含不合法的 classIds', code: 'INVALID_CLASS_IDS' }, 400);
    }
  }

  // passScore 跟 totalScore 誰有值就用誰 —— 這個請求沒帶 totalScore 的話，
  // 及格線要對照的是資料庫裡現有的總分，不是憑空當成 100
  if (body.passScore !== undefined) {
    const totalScore = body.totalScore ?? existing.total_score;
    if (!isPassScoreValid(body.passScore, totalScore)) {
      return c.json({ error: '及格線不能超過總分，也不能是負數', code: 'INVALID_PASS_SCORE' }, 400);
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates['name'] = body.name.trim();
  if (body.examType !== undefined) updates['exam_type'] = body.examType;
  if (body.subjectId !== undefined) updates['subject_id'] = body.subjectId;
  if (body.campusId !== undefined) updates['campus_id'] = body.campusId;
  if (body.examDate !== undefined) updates['exam_date'] = body.examDate;
  if (body.totalScore !== undefined) updates['total_score'] = body.totalScore;
  if (body.passScore !== undefined) updates['pass_score'] = body.passScore;
  if (body.scopeNote !== undefined) updates['scope_note'] = body.scopeNote;

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from('academy_exams')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId);

    if (updateError) {
      return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
    }
  }

  if (body.classIds) {
    const dedupedClassIds = Array.from(new Set(body.classIds));

    const { error: deleteError } = await supabase
      .from('academy_exam_classes')
      .delete()
      .eq('exam_id', id);

    if (deleteError) {
      return c.json({ error: deleteError.message, code: 'DB_ERROR' }, 400);
    }

    if (dedupedClassIds.length > 0) {
      const { error: insertError } = await supabase.from('academy_exam_classes').insert(
        dedupedClassIds.map((classId) => ({
          exam_id: id,
          class_id: classId,
        })),
      );

      if (insertError) {
        return c.json({ error: insertError.message, code: 'DB_ERROR' }, 400);
      }
    }
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'academy_exam',
      resourceId: id,
      resourceName: existing.name,
      action: 'academy_exam.update',
      details: {
        updatedFields: Object.keys(updates),
        classIdsReplaced: body.classIds !== undefined,
      },
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['AcademyExams'],
  summary: '刪除補習班考試事件',
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
      description: '不可刪除有成績的考試',
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
  },
});

app.openapi(deleteRouteDef, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const existing = await ensureExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到考試事件', code: 'NOT_FOUND' }, 404);
  }

  // A3：只能動自己建的考試（管理員不受限）
  if (
    !canManageAcademyExam({
      roles: c.get('roles') ?? [],
      userId,
      createdBy: existing.created_by,
    })
  ) {
    return c.json({ error: '只能修改自己建立的考試', code: 'NOT_EXAM_OWNER' }, 403);
  }

  const { count: scoreCount, error: scoreCountError } = await supabase
    .from('academy_scores')
    .select('id', { count: 'exact', head: true })
    .eq('exam_id', id);

  if (scoreCountError) {
    return c.json({ error: scoreCountError.message, code: 'DB_ERROR' }, 400);
  }

  if ((scoreCount ?? 0) > 0) {
    return c.json({ error: '已有成績紀錄，無法刪除', code: 'HAS_SCORES' }, 400);
  }

  const { error: deleteError } = await supabase
    .from('academy_exams')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId);

  if (deleteError) {
    return c.json({ error: deleteError.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'academy_exam',
      resourceId: id,
      resourceName: existing.name,
      action: 'academy_exam.delete',
      details: {
        status: existing.status,
      },
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
});

const listScoresRoute = createRoute({
  method: 'get',
  path: '/{id}/scores',
  tags: ['AcademyExams'],
  summary: '取得考試成績列表',
  request: {
    params: z.object({ id: DbUuidSchema }),
  },
  responses: {
    200: {
      description: '成績列表',
      content: {
        'application/json': {
          schema: AcademyScoreListResponseSchema,
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
  },
});

app.openapi(listScoresRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');

  const scope = await loadExamScope(supabase, {
    orgId,
    userId: c.get('userId'),
    roles: c.get('roles') ?? [],
  });
  if ('forbidden' in scope) {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }
  if (!(await examInScope(supabase, id, scope))) {
    return c.json({ error: '沒有這場考試的權限', code: 'EXAM_OUT_OF_SCOPE' }, 403);
  }

  const exam = await ensureExamOwnedByOrg(supabase, id, orgId);
  if (!exam) {
    return c.json({ error: '找不到考試事件', code: 'NOT_FOUND' }, 404);
  }

  const { data: examClasses, error: examClassesError } = await supabase
    .from('academy_exam_classes')
    .select('class_id')
    .eq('exam_id', id);

  if (examClassesError) {
    return c.json({ error: examClassesError.message, code: 'DB_ERROR' }, 400);
  }

  const classIds = (examClasses ?? []).map((row) => row.class_id);

  const { data: enrolledStudents, error: enrolledStudentsError } =
    classIds.length > 0
      ? await supabase
          .from('enrollments')
          .select('student_id, class_id, students(name, grade)')
          .in('class_id', classIds)
          .eq('status', 'active')
      : { data: [], error: null };

  if (enrolledStudentsError) {
    return c.json({ error: enrolledStudentsError.message, code: 'DB_ERROR' }, 400);
  }

  const { data: scoredRows, error: scoredRowsError } = await supabase
    .from('academy_scores')
    .select('student_id, score, status, notes, updated_at, students(name, grade)')
    .eq('exam_id', id)
    .order('updated_at', { ascending: false });

  if (scoredRowsError) {
    return c.json({ error: scoredRowsError.message, code: 'DB_ERROR' }, 400);
  }

  const data = buildAcademyScoreRows(enrolledStudents ?? [], scoredRows ?? []);

  return c.json({ data }, 200);
});

const upsertScoresRoute = createRoute({
  method: 'post',
  path: '/{id}/scores',
  tags: ['AcademyExams'],
  summary: '批次登錄/更新成績',
  request: {
    params: z.object({ id: DbUuidSchema }),
    body: {
      content: {
        'application/json': {
          schema: BatchUpsertScoresSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '登錄成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean(), affected: z.number().int().min(0) }),
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
  },
});

app.openapi(upsertScoresRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const scope = await loadExamScope(supabase, {
    orgId,
    userId,
    roles: c.get('roles') ?? [],
  });
  if ('forbidden' in scope) {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }
  if (!(await examInScope(supabase, id, scope))) {
    return c.json({ error: '沒有這場考試的權限', code: 'EXAM_OUT_OF_SCOPE' }, 403);
  }

  const exam = await ensureExamOwnedByOrg(supabase, id, orgId);
  if (!exam) {
    return c.json({ error: '找不到考試事件', code: 'NOT_FOUND' }, 404);
  }

  if (exam.status === 'closed') {
    return c.json({ error: '考試已結束，無法登錄成績', code: 'EXAM_CLOSED' }, 400);
  }

  const studentIds = Array.from(new Set(body.scores.map((item) => item.studentId)));

  // 老師只能登錄自己任課班的學生。這場考試可能跨班，其中有他不任課的班 ——
  // 「看得到這場考試」不等於「可以碰這場考試的每一個學生」
  if (!scope.isAdmin) {
    const { data: allowedRows } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('org_id', orgId)
      .in('class_id', scope.taught)
      .in('student_id', studentIds);
    const allowed = new Set(
      (allowedRows ?? []).map((row: { student_id: string }) => row.student_id),
    );
    const outOfScope = studentIds.filter((studentId) => !allowed.has(studentId));
    if (outOfScope.length > 0) {
      return c.json({ error: '包含非自己任課班的學生', code: 'STUDENT_OUT_OF_SCOPE' }, 403);
    }
  }

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id')
    .eq('org_id', orgId)
    .in('id', studentIds);

  if (studentsError) {
    return c.json({ error: studentsError.message, code: 'DB_ERROR' }, 400);
  }

  if ((students ?? []).length !== studentIds.length) {
    return c.json({ error: '存在不屬於此機構的 studentId', code: 'INVALID_STUDENT_IDS' }, 400);
  }

  const payload = body.scores.map((item) => ({
    exam_id: id,
    student_id: item.studentId,
    score: item.score,
    status: item.status,
    notes: item.notes ?? null,
    created_by: userId,
  }));

  const { error: upsertError } = await supabase
    .from('academy_scores')
    .upsert(payload, { onConflict: 'exam_id,student_id' });

  if (upsertError) {
    return c.json({ error: upsertError.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'academy_exam',
      resourceId: id,
      resourceName: exam.name,
      action: 'academy_exam.scores.upsert',
      details: {
        affected: payload.length,
      },
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true, affected: payload.length }, 200);
});

const closeRoute = createRoute({
  method: 'patch',
  path: '/{id}/close',
  tags: ['AcademyExams'],
  summary: '結束考試（active -> closed）',
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
  },
});

app.openapi(closeRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const existing = await ensureExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到考試事件', code: 'NOT_FOUND' }, 404);
  }

  // A3：只能動自己建的考試（管理員不受限）
  if (
    !canManageAcademyExam({
      roles: c.get('roles') ?? [],
      userId,
      createdBy: existing.created_by,
    })
  ) {
    return c.json({ error: '只能修改自己建立的考試', code: 'NOT_EXAM_OWNER' }, 403);
  }

  if (existing.status !== 'active') {
    return c.json({ error: '僅 active 可結束', code: 'INVALID_STATUS' }, 400);
  }

  const { error } = await supabase
    .from('academy_exams')
    .update({ status: 'closed' })
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'academy_exam',
      resourceId: id,
      resourceName: existing.name,
      action: 'academy_exam.close',
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
});

const reopenRoute = createRoute({
  method: 'patch',
  path: '/{id}/reopen',
  tags: ['AcademyExams'],
  summary: '重新開啟考試（closed -> active）',
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
  },
});

app.openapi(reopenRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const existing = await ensureExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到考試事件', code: 'NOT_FOUND' }, 404);
  }

  // A3：只能動自己建的考試（管理員不受限）
  if (
    !canManageAcademyExam({
      roles: c.get('roles') ?? [],
      userId,
      createdBy: existing.created_by,
    })
  ) {
    return c.json({ error: '只能修改自己建立的考試', code: 'NOT_EXAM_OWNER' }, 403);
  }

  if (existing.status !== 'closed') {
    return c.json({ error: '僅 closed 可重新開啟', code: 'INVALID_STATUS' }, 400);
  }

  const { error } = await supabase
    .from('academy_exams')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'academy_exam',
      resourceId: id,
      resourceName: existing.name,
      action: 'academy_exam.reopen',
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
});

export default app;
