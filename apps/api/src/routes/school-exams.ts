import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { DbUuidSchema } from '../lib/validation';
import { logAudit } from '../utils/audit';

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
    id: z.uuid(),
    academicYear: z.number().int(),
    semester: z.union([z.literal(1), z.literal(2)]),
    examType: SchoolExamTypeSchema,
    name: z.string().nullable(),
    label: z.string(),
    examDate: z.string().nullable(),
    status: SchoolExamStatusSchema,
    schoolId: z.uuid(),
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
    subjectId: z.uuid(),
    subjectName: z.string(),
    averageScore: z.number().nullable(),
    recordedCount: z.number().int(),
  })
  .openapi('SchoolExamSubjectSummary');

const SchoolExamDetailSchema = z
  .object({
    id: z.uuid(),
    academicYear: z.number().int(),
    semester: z.union([z.literal(1), z.literal(2)]),
    examType: SchoolExamTypeSchema,
    name: z.string().nullable(),
    label: z.string(),
    examDate: z.string().nullable(),
    status: SchoolExamStatusSchema,
    schoolId: z.uuid(),
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
    name: z.string().trim().max(100).nullable().optional(),
    schoolId: DbUuidSchema.optional(),
    examDate: z.string().date().nullable().optional(),
  })
  .openapi('UpdateSchoolExam');

const RecentSchoolExamStudentSchema = z
  .object({
    studentId: z.uuid(),
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
    studentId: z.uuid(),
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
      .min(1),
  })
  .openapi('BatchUpsertSchoolScores');

const StudentSchoolScoreSchema = z
  .object({
    schoolExamId: z.uuid(),
    label: z.string(),
    academicYear: z.number().int(),
    semester: z.union([z.literal(1), z.literal(2)]),
    examType: SchoolExamTypeSchema,
    name: z.string().nullable(),
    subjectId: z.uuid(),
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
      'id, academic_year, semester, exam_type, name, label, exam_date, status, school_id, created_at, updated_at',
    )
    .eq('id', schoolExamId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as SchoolExamRow;
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
    .from('school_exams')
    .select(
      'id, academic_year, semester, exam_type, name, label, exam_date, status, school_id, schools(id, name), created_at, updated_at, school_scores(count)',
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
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });

  const { data, error, count } = await query;

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const rows = (
    (data ?? []) as Array<
      SchoolExamRow & {
        school_scores?: SchoolScoreCountRow[] | null;
        schools?: SchoolRelation | SchoolRelation[] | null;
      }
    >
  ).map((row) => {
    const school = pickRelationFirst(row.schools);
    return {
      id: row.id,
      academicYear: row.academic_year,
      semester: row.semester,
      examType: row.exam_type,
      name: row.name,
      label: row.label,
      examDate: row.exam_date,
      status: row.status,
      schoolId: row.school_id,
      schoolName: school?.name ?? '',
      scoreCount: row.school_scores?.[0]?.count ?? 0,
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
  const { campusId, grade } = c.req.valid('query');

  const { data: schoolExamData, error: schoolExamError } = await supabase
    .from('school_exams')
    .select(
      'id, academic_year, semester, exam_type, name, label, exam_date, status, school_id, schools(id, name), created_at, updated_at',
    )
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (schoolExamError) {
    return c.json({ error: schoolExamError.message, code: 'DB_ERROR' }, 400);
  }

  if (!schoolExamData) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  const schoolExam = schoolExamData as SchoolExamDetailRow;
  const school = pickRelationFirst(schoolExam.schools);
  const schoolName = school?.name ?? '';

  let studentIdFilter: string[] | null = null;

  if (campusId || grade) {
    let studentQuery = supabase
      .from('students')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_active', true);

    if (grade) {
      studentQuery = studentQuery.eq('grade', grade);
    }

    if (campusId) {
      const { data: enrollmentRows } = await supabase
        .from('enrollments')
        .select('student_id, classes!inner(campus_id)')
        .eq('classes.campus_id', campusId);

      const campusStudentIds = Array.from(
        new Set(
          ((enrollmentRows ?? []) as Array<{ student_id: string | null }>)
            .map((row) => row.student_id)
            .filter((sid): sid is string => !!sid),
        ),
      );

      if (campusStudentIds.length === 0) {
        studentIdFilter = [];
      } else {
        studentQuery = studentQuery.in('id', campusStudentIds);
      }
    }

    if (studentIdFilter === null) {
      const { data: studentRows } = await studentQuery;
      studentIdFilter = (studentRows ?? []).map((r) => (r as { id: string }).id);
    }
  }

  let scoreQuery = supabase
    .from('school_scores')
    .select('student_id, subject_id, score, subjects(id, name)')
    .eq('school_exam_id', id);

  if (studentIdFilter !== null && studentIdFilter.length > 0) {
    scoreQuery = scoreQuery.in('student_id', studentIdFilter);
  } else if (studentIdFilter !== null && studentIdFilter.length === 0) {
    return c.json(
      {
        data: {
          id: schoolExam.id,
          academicYear: schoolExam.academic_year,
          semester: schoolExam.semester,
          examType: schoolExam.exam_type,
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

  const { data: scoreRows, error: scoreError } = await scoreQuery;

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
        id: schoolExam.id,
        academicYear: schoolExam.academic_year,
        semester: schoolExam.semester,
        examType: schoolExam.exam_type,
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
      description: '重複學校考試',
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

  const trimmedName = body.name?.trim() ?? null;
  const normalizedName = trimmedName && trimmedName.length > 0 ? trimmedName : null;

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
    return c.json({ error: schoolError.message, code: 'DB_ERROR' }, 400);
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
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
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
        name: normalizedName,
        schoolId: body.schoolId,
      },
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
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
      return c.json({ error: schoolError.message, code: 'DB_ERROR' }, 400);
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
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
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
        name: nextName,
        schoolId: nextSchoolId,
      },
    },
    c.executionCtx.waitUntil.bind(c.executionCtx),
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

  const existing = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!existing) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  const { count, error: countError } = await supabase
    .from('school_scores')
    .select('id', { count: 'exact', head: true })
    .eq('school_exam_id', id);

  if (countError) {
    return c.json({ error: countError.message, code: 'DB_ERROR' }, 400);
  }

  if ((count ?? 0) > 0) {
    return c.json({ error: '已有成績紀錄，無法刪除', code: 'HAS_SCORES' }, 400);
  }

  const { error } = await supabase.from('school_exams').delete().eq('id', id).eq('org_id', orgId);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
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
    c.executionCtx.waitUntil.bind(c.executionCtx),
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

  const schoolExam = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!schoolExam) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  let query = supabase
    .from('school_scores')
    .select('student_id, subject_id, score, status, notes, updated_at, students(name, grade), subjects(id, name)')
    .eq('school_exam_id', id);

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

  const schoolExam = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!schoolExam) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  if (schoolExam.status === 'closed') {
    return c.json({ error: '學校考試已結束，無法登錄成績', code: 'EXAM_CLOSED' }, 400);
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
    school_exam_id: id,
    student_id: item.studentId,
    subject_id: item.subjectId,
    score: item.score,
    status: item.status,
    notes: item.notes ?? null,
    created_by: userId,
  }));

  const { error } = await supabase
    .from('school_scores')
    .upsert(payload, { onConflict: 'school_exam_id,student_id,subject_id' });

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId,
      resourceType: 'school_exam',
      resourceId: id,
      resourceName: schoolExam.label,
      action: 'school_exam.scores.upsert',
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
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
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
    c.executionCtx.waitUntil.bind(c.executionCtx),
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
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
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
    c.executionCtx.waitUntil.bind(c.executionCtx),
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

  const schoolExam = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!schoolExam) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  const { data, error } = await supabase
    .from('school_scores')
    .select('student_id, updated_at, students(name, grade)')
    .eq('school_exam_id', id);

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

app.openapi(studentsRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');
  const {
    campusId,
    status = 'all',
    search,
    grade,
    page = 1,
    pageSize = 50,
  } = c.req.valid('query');

  const schoolExam = await ensureSchoolExamOwnedByOrg(supabase, id, orgId);
  if (!schoolExam) {
    return c.json({ error: '找不到學校考試', code: 'NOT_FOUND' }, 404);
  }

  const { count: subjectCount } = await supabase
    .from('subjects')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId);

  let studentsQuery = supabase
    .from('students')
    .select(
      'id, name, grade, is_active, enrollments(id, classes(campus_id, campuses(name)))',
    )
    .eq('org_id', orgId)
    .eq('is_active', true)
    .eq('school_id', schoolExam.school_id)
    .order('name');

  if (grade) {
    studentsQuery = studentsQuery.eq('grade', grade);
  }
  if (search) {
    studentsQuery = studentsQuery.ilike('name', `%${search}%`);
  }

  if (campusId) {
    const { data: enrollmentRows, error: enrollmentError } = await supabase
      .from('enrollments')
      .select('student_id, classes!inner(campus_id)')
      .eq('classes.campus_id', campusId);

    if (enrollmentError) {
      return c.json({ error: enrollmentError.message, code: 'DB_ERROR' }, 400);
    }

    const campusStudentIds = Array.from(
      new Set(
        ((enrollmentRows ?? []) as Array<{ student_id: string | null }>)
          .map((row) => row.student_id)
          .filter((studentId): studentId is string => !!studentId),
      ),
    );

    if (campusStudentIds.length === 0) {
      return c.json(
        {
          data: [],
          meta: { total: 0, page, pageSize },
        },
        200,
      );
    }

    studentsQuery = studentsQuery.in('id', campusStudentIds);
  }

  const { data: studentsData, error: studentsError } = await studentsQuery;

  if (studentsError) {
    return c.json({ error: studentsError.message, code: 'DB_ERROR' }, 400);
  }

  const studentRows = (studentsData ?? []) as unknown as Array<{
    id: string;
    name: string | null;
    grade: string | null;
    is_active: boolean;
    enrollments?: Array<{
      id: string;
      classes: { campus_id: string | null; campuses: { name: string } | null } | null;
    }> | null;
  }>;

  const studentIds = studentRows.map((row) => row.id);

  if (studentIds.length === 0) {
    return c.json(
      {
        data: [],
        meta: { total: 0, page, pageSize },
      },
      200,
    );
  }

  const { data: scoreRows, error: scoreError } = await supabase
    .from('school_scores')
    .select('student_id, status, updated_at')
    .eq('school_exam_id', id)
    .in('student_id', studentIds);

  if (scoreError) {
    return c.json({ error: scoreError.message, code: 'DB_ERROR' }, 400);
  }

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
    .from('school_scores')
    .select(
      'score, status, notes, updated_at, school_exams!inner(id, academic_year, semester, exam_type, name, label, exam_date, created_at, org_id), subjects(id, name)',
    )
    .eq('student_id', studentId)
    .eq('school_exams.org_id', orgId);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
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
