import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';

const TermExamPeriodSchema = z
  .enum(['midterm_1', 'final_1', 'midterm_2', 'final_2'])
  .openapi('TermExamPeriod');
const TermExamStatusSchema = z.enum(['active', 'closed']).openapi('TermExamStatus');

const ScoreStatusSchema = z.enum(['scored', 'absent', 'makeup']).openapi('TermExamScoreStatus');

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi('TermExamError');

const TermExamListItemSchema = z
  .object({
    id: z.uuid(),
    academicYear: z.number().int(),
    semester: z.union([z.literal(1), z.literal(2)]),
    period: TermExamPeriodSchema,
    label: z.string(),
    examDate: z.string().nullable(),
    status: TermExamStatusSchema,
    scoreCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('TermExamListItem');

const TermExamListResponseSchema = z
  .object({
    data: z.array(TermExamListItemSchema),
    meta: z.object({
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
    }),
  })
  .openapi('TermExamListResponse');

const TermExamSubjectSummarySchema = z
  .object({
    subjectId: z.uuid(),
    subjectName: z.string(),
    averageScore: z.number().nullable(),
    recordedCount: z.number().int(),
  })
  .openapi('TermExamSubjectSummary');

const TermExamDetailSchema = z
  .object({
    id: z.uuid(),
    academicYear: z.number().int(),
    semester: z.union([z.literal(1), z.literal(2)]),
    period: TermExamPeriodSchema,
    label: z.string(),
    examDate: z.string().nullable(),
    status: TermExamStatusSchema,
    summary: z.object({
      bySubject: z.array(TermExamSubjectSummarySchema),
      totalRecordedCount: z.number().int(),
    }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('TermExamDetail');

const CreateTermExamSchema = z
  .object({
    academicYear: z.number().int().min(2000).max(9999),
    semester: z.union([z.literal(1), z.literal(2)]),
    period: TermExamPeriodSchema,
    examDate: z.string().date().optional(),
  })
  .openapi('CreateTermExam');

const UpdateTermExamSchema = z
  .object({
    academicYear: z.number().int().min(2000).max(9999).optional(),
    semester: z.union([z.literal(1), z.literal(2)]).optional(),
    period: TermExamPeriodSchema.optional(),
    examDate: z.string().date().nullable().optional(),
  })
  .openapi('UpdateTermExam');

const RecentTermExamStudentSchema = z
  .object({
    studentId: z.uuid(),
    studentName: z.string(),
    studentGrade: z.string().nullable(),
    scoreCount: z.number().int(),
    lastUpdatedAt: z.string(),
  })
  .openapi('RecentTermExamStudent');

const TermScoreSchema = z
  .object({
    studentId: z.uuid(),
    studentName: z.string(),
    studentGrade: z.string().nullable(),
    subjectId: z.uuid(),
    subjectName: z.string(),
    score: z.number().nullable(),
    status: ScoreStatusSchema,
    notes: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi('TermScore');

const TermScoreListResponseSchema = z
  .object({
    data: z.array(TermScoreSchema),
  })
  .openapi('TermScoreListResponse');

const BatchUpsertTermScoresSchema = z
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
      .min(1),
  })
  .openapi('BatchUpsertTermScores');

const StudentTermScoreSchema = z
  .object({
    termExamId: z.uuid(),
    label: z.string(),
    academicYear: z.number().int(),
    semester: z.union([z.literal(1), z.literal(2)]),
    period: TermExamPeriodSchema,
    subjectId: z.uuid(),
    subjectName: z.string(),
    score: z.number().nullable(),
    status: ScoreStatusSchema,
    notes: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi('StudentTermScore');

const app = new OpenAPIHono<AppEnv>();

interface TermExamRow {
  id: string;
  academic_year: number;
  semester: 1 | 2;
  period: 'midterm_1' | 'final_1' | 'midterm_2' | 'final_2';
  label: string;
  exam_date: string | null;
  status: 'active' | 'closed';
  created_at: string;
  updated_at: string;
}

interface TermScoreCountRow {
  count: number | null;
}

interface SubjectRelation {
  id: string;
  name: string | null;
}

interface StudentRelation {
  name: string | null;
  grade: string | null;
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
  term_exams?:
    | (TermExamRow & { org_id?: string | null })
    | Array<TermExamRow & { org_id?: string | null }>
    | null;
  subjects?: SubjectRelation | SubjectRelation[] | null;
}

function pickRelationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function periodLabel(period: 'midterm_1' | 'final_1' | 'midterm_2' | 'final_2'): string {
  const map: Record<'midterm_1' | 'final_1' | 'midterm_2' | 'final_2', string> = {
    midterm_1: '第一次段考',
    final_1: '第一次期末考',
    midterm_2: '第二次段考',
    final_2: '第二次期末考',
  };

  return map[period];
}

function buildTermExamLabel(input: {
  academicYear: number;
  semester: 1 | 2;
  period: 'midterm_1' | 'final_1' | 'midterm_2' | 'final_2';
}): string {
  const semesterLabel = input.semester === 1 ? '上' : '下';
  return `${input.academicYear} ${semesterLabel}學期 ${periodLabel(input.period)}`;
}

function compareTermPeriod(
  left: 'midterm_1' | 'final_1' | 'midterm_2' | 'final_2',
  right: 'midterm_1' | 'final_1' | 'midterm_2' | 'final_2',
): number {
  const order: Record<'midterm_1' | 'final_1' | 'midterm_2' | 'final_2', number> = {
    midterm_1: 1,
    final_1: 2,
    midterm_2: 3,
    final_2: 4,
  };

  return order[left] - order[right];
}

async function ensureTermExamOwnedByOrg(
  supabase: AppEnv['Variables']['supabase'],
  termExamId: string,
  orgId: string,
): Promise<TermExamRow | null> {
  const { data, error } = await supabase
    .from('term_exams')
    .select('id, academic_year, semester, period, label, exam_date, status, created_at, updated_at')
    .eq('id', termExamId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as TermExamRow;
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['TermExams'],
  summary: '取得段考列表',
  request: {
    query: z.object({
      academic_year: z.coerce.number().int().optional(),
      semester: z.coerce.number().int().min(1).max(2).optional(),
      page: z.coerce.number().int().min(1).default(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).default(20).optional(),
    }),
  },
  responses: {
    200: {
      description: '段考列表',
      content: {
        'application/json': {
          schema: TermExamListResponseSchema,
        },
      },
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
  const { academic_year: academicYear, semester, page = 1, pageSize = 20 } = c.req.valid('query');

  let query = supabase
    .from('term_exams')
    .select(
      'id, academic_year, semester, period, label, exam_date, status, created_at, updated_at, term_scores(count)',
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

  const from = (page - 1) * pageSize;
  query = query
    .range(from, from + pageSize - 1)
    .order('exam_date', { ascending: false, nullsFirst: false })
    .order('academic_year', { ascending: false })
    .order('semester', { ascending: false })
    .order('period', { ascending: true });

  const { data, error, count } = await query;

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const rows = ((data ?? []) as Array<TermExamRow & { term_scores?: TermScoreCountRow[] | null }>).map(
    (row) => ({
      id: row.id,
      academicYear: row.academic_year,
      semester: row.semester,
      period: row.period,
      label: row.label,
      examDate: row.exam_date,
      status: row.status,
      scoreCount: row.term_scores?.[0]?.count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

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

const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['TermExams'],
  summary: '取得段考單筆',
  request: {
    params: z.object({ id: DbUuidSchema }),
  },
  responses: {
    200: {
      description: '段考明細',
      content: {
        'application/json': {
          schema: z.object({ data: TermExamDetailSchema }),
        },
      },
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

  const termExam = await ensureTermExamOwnedByOrg(supabase, id, orgId);
  if (!termExam) {
    return c.json({ error: '找不到段考事件', code: 'NOT_FOUND' }, 404);
  }

  const { data: scoreRows, error: scoreError } = await supabase
    .from('term_scores')
    .select('subject_id, score, subjects(id, name)')
    .eq('term_exam_id', id);

  if (scoreError) {
    return c.json({ error: scoreError.message, code: 'DB_ERROR' }, 400);
  }

  const summaryMap = new Map<
    string,
    { subjectId: string; subjectName: string; scores: number[]; rowCount: number }
  >();

  for (const row of scoreRows ?? []) {
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
        ? Number((item.scores.reduce((sum, score) => sum + score, 0) / item.scores.length).toFixed(2))
        : null,
    recordedCount: item.rowCount,
  }));

  return c.json(
    {
      data: {
        id: termExam.id,
        academicYear: termExam.academic_year,
        semester: termExam.semester,
        period: termExam.period,
        label: termExam.label,
        examDate: termExam.exam_date,
        status: termExam.status,
        summary: {
          bySubject,
          totalRecordedCount: (scoreRows ?? []).length,
        },
        createdAt: termExam.created_at,
        updatedAt: termExam.updated_at,
      },
    },
    200,
  );
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['TermExams'],
  summary: '建立段考事件',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTermExamSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: '建立成功',
      content: {
        'application/json': {
          schema: z.object({ data: z.object({ id: z.uuid(), label: z.string() }) }),
        },
      },
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
      description: '重複段考事件',
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

  const label = buildTermExamLabel({
    academicYear: body.academicYear,
    semester: body.semester,
    period: body.period,
  });

  const { data, error } = await supabase
    .from('term_exams')
    .insert({
      org_id: orgId,
      academic_year: body.academicYear,
      semester: body.semester,
      period: body.period,
      label,
      exam_date: body.examDate ?? null,
    })
    .select('id, label')
    .single();

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '相同學年度/學期/考次已存在', code: 'DUPLICATE' }, 409);
    }
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'term_exam',
      resourceId: data.id,
      resourceName: data.label,
      action: 'term_exam.create',
      details: {
        academicYear: body.academicYear,
        semester: body.semester,
        period: body.period,
      },
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json({ data: { id: data.id, label: data.label } }, 201);
});

const updateRouteDef = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['TermExams'],
  summary: '更新段考事件',
  request: {
    params: z.object({ id: DbUuidSchema }),
    body: {
      content: {
        'application/json': {
          schema: UpdateTermExamSchema,
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

  const existing = await ensureTermExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到段考事件', code: 'NOT_FOUND' }, 404);
  }

  const nextAcademicYear = body.academicYear ?? existing.academic_year;
  const nextSemester = body.semester ?? existing.semester;
  const nextPeriod = body.period ?? existing.period;
  const nextExamDate = body.examDate === undefined ? existing.exam_date : body.examDate;
  const nextLabel = buildTermExamLabel({
    academicYear: nextAcademicYear,
    semester: nextSemester,
    period: nextPeriod,
  });

  const { error } = await supabase
    .from('term_exams')
    .update({
      academic_year: nextAcademicYear,
      semester: nextSemester,
      period: nextPeriod,
      label: nextLabel,
      exam_date: nextExamDate,
    })
    .eq('id', id)
    .eq('org_id', orgId);

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: '相同學年度/學期/考次已存在', code: 'DUPLICATE' }, 400);
    }
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'term_exam',
      resourceId: id,
      resourceName: nextLabel,
      action: 'term_exam.update',
      details: {
        academicYear: nextAcademicYear,
        semester: nextSemester,
        period: nextPeriod,
      },
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json({ success: true, label: nextLabel }, 200);
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['TermExams'],
  summary: '刪除段考事件',
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
  },
});

app.openapi(deleteRouteDef, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');

  const existing = await ensureTermExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到段考事件', code: 'NOT_FOUND' }, 404);
  }

  const { count, error: countError } = await supabase
    .from('term_scores')
    .select('id', { count: 'exact', head: true })
    .eq('term_exam_id', id);

  if (countError) {
    return c.json({ error: countError.message, code: 'DB_ERROR' }, 400);
  }

  if ((count ?? 0) > 0) {
    return c.json({ error: '已有成績紀錄，無法刪除', code: 'HAS_SCORES' }, 400);
  }

  const { error } = await supabase.from('term_exams').delete().eq('id', id).eq('org_id', orgId);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'term_exam',
      resourceId: id,
      resourceName: existing.label,
      action: 'term_exam.delete',
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json({ success: true }, 200);
});

const listScoresRoute = createRoute({
  method: 'get',
  path: '/{id}/scores',
  tags: ['TermExams'],
  summary: '取得段考成績',
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
          schema: TermScoreListResponseSchema,
        },
      },
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
  const { studentId } = c.req.valid('query');

  const termExam = await ensureTermExamOwnedByOrg(supabase, id, orgId);
  if (!termExam) {
    return c.json({ error: '找不到段考事件', code: 'NOT_FOUND' }, 404);
  }

  let query = supabase
    .from('term_scores')
    .select('student_id, subject_id, score, status, notes, updated_at, students(name, grade), subjects(id, name)')
    .eq('term_exam_id', id);

  if (studentId) {
    query = query.eq('student_id', studentId);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const rows = (data ?? []) as ScoreRowWithRelations[];

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
  tags: ['TermExams'],
  summary: '批次登錄/更新段考成績',
  request: {
    params: z.object({ id: DbUuidSchema }),
    body: {
      content: {
        'application/json': {
          schema: BatchUpsertTermScoresSchema,
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

  const termExam = await ensureTermExamOwnedByOrg(supabase, id, orgId);
  if (!termExam) {
    return c.json({ error: '找不到段考事件', code: 'NOT_FOUND' }, 404);
  }

  if (termExam.status === 'closed') {
    return c.json({ error: '段考已結束，無法登錄成績', code: 'EXAM_CLOSED' }, 400);
  }

  const studentIds = Array.from(new Set(body.scores.map((item) => item.studentId)));
  const subjectIds = Array.from(new Set(body.scores.map((item) => item.subjectId)));

  const [{ data: students, error: studentError }, { data: subjects, error: subjectError }] =
    await Promise.all([
      supabase.from('students').select('id').eq('org_id', orgId).in('id', studentIds),
      supabase.from('subjects').select('id').eq('org_id', orgId).in('id', subjectIds),
    ]);

  if (studentError || subjectError) {
    return c.json({ error: studentError?.message ?? subjectError?.message ?? 'DB_ERROR', code: 'DB_ERROR' }, 400);
  }

  if ((students ?? []).length !== studentIds.length) {
    return c.json({ error: '存在不屬於此機構的 studentId', code: 'INVALID_STUDENT_IDS' }, 400);
  }

  if ((subjects ?? []).length !== subjectIds.length) {
    return c.json({ error: '存在不屬於此機構的 subjectId', code: 'INVALID_SUBJECT_IDS' }, 400);
  }

  const payload = body.scores.map((item) => ({
    term_exam_id: id,
    student_id: item.studentId,
    subject_id: item.subjectId,
    score: item.score,
    status: item.status,
    notes: item.notes ?? null,
    created_by: userId,
  }));

  const { error } = await supabase
    .from('term_scores')
    .upsert(payload, { onConflict: 'term_exam_id,student_id,subject_id' });

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'term_exam',
      resourceId: id,
      resourceName: termExam.label,
      action: 'term_exam.scores.upsert',
      details: {
        affected: payload.length,
      },
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json({ success: true, affected: payload.length }, 200);
});

const closeRoute = createRoute({
  method: 'patch',
  path: '/{id}/close',
  tags: ['TermExams'],
  summary: '結束段考（active -> closed）',
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

  const existing = await ensureTermExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到段考事件', code: 'NOT_FOUND' }, 404);
  }

  if (existing.status !== 'active') {
    return c.json({ error: '僅 active 可結束', code: 'INVALID_STATUS' }, 400);
  }

  const { error } = await supabase
    .from('term_exams')
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
      resourceType: 'term_exam',
      resourceId: id,
      resourceName: existing.label,
      action: 'term_exam.close',
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json({ success: true }, 200);
});

const reopenRoute = createRoute({
  method: 'patch',
  path: '/{id}/reopen',
  tags: ['TermExams'],
  summary: '重新開啟段考（closed -> active）',
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

  const existing = await ensureTermExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到段考事件', code: 'NOT_FOUND' }, 404);
  }

  if (existing.status !== 'closed') {
    return c.json({ error: '僅 closed 可重新開啟', code: 'INVALID_STATUS' }, 400);
  }

  const { error } = await supabase
    .from('term_exams')
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
      resourceType: 'term_exam',
      resourceId: id,
      resourceName: existing.label,
      action: 'term_exam.reopen',
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
  );

  return c.json({ success: true }, 200);
});

const recentStudentsRoute = createRoute({
  method: 'get',
  path: '/{id}/recent-students',
  tags: ['TermExams'],
  summary: '該段考已有成績的學生列表（最近登錄優先）',
  request: {
    params: z.object({ id: DbUuidSchema }),
  },
  responses: {
    200: {
      description: '學生列表',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(RecentTermExamStudentSchema),
          }),
        },
      },
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

app.openapi(recentStudentsRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');

  const termExam = await ensureTermExamOwnedByOrg(supabase, id, orgId);
  if (!termExam) {
    return c.json({ error: '找不到段考事件', code: 'NOT_FOUND' }, 404);
  }

  const { data, error } = await supabase
    .from('term_scores')
    .select('student_id, updated_at, students(name, grade)')
    .eq('term_exam_id', id);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const aggregated = new Map<
    string,
    { studentId: string; studentName: string; studentGrade: string | null; scoreCount: number; lastUpdatedAt: string }
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

const byStudentRoute = createRoute({
  method: 'get',
  path: '/by-student/{studentId}',
  tags: ['TermExams'],
  summary: '取得學生段考成績',
  request: {
    params: z.object({ studentId: DbUuidSchema }),
  },
  responses: {
    200: {
      description: '學生段考成績列表',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(StudentTermScoreSchema) }),
        },
      },
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
    return c.json({ error: studentError.message, code: 'DB_ERROR' }, 400);
  }

  if (!student) {
    return c.json({ error: '找不到學生', code: 'NOT_FOUND' }, 404);
  }

  const { data, error } = await supabase
    .from('term_scores')
    .select(
      'score, status, notes, updated_at, term_exams!inner(id, academic_year, semester, period, label, org_id), subjects(id, name)',
    )
    .eq('student_id', studentId)
    .eq('term_exams.org_id', orgId);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const rows = (data ?? []) as StudentScoreRow[];
  const mapped = rows
    .map((row) => {
      const termExam = pickRelationFirst(row.term_exams);
      const subject = pickRelationFirst(row.subjects);

      if (!termExam || !subject) {
        return null;
      }

      return {
        termExamId: termExam.id,
        label: termExam.label,
        academicYear: termExam.academic_year,
        semester: termExam.semester,
        period: termExam.period,
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
      if (a.academicYear !== b.academicYear) return b.academicYear - a.academicYear;
      if (a.semester !== b.semester) return b.semester - a.semester;
      return compareTermPeriod(a.period, b.period);
    });

  return c.json({ data: mapped }, 200);
});

export default app;
