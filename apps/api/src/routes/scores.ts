import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { loadTeachingScope, taughtClassIds, taughtStudentIds } from '../lib/teacher-scope';
import { DbUuidSchema } from '../lib/validation';
import {
  ACADEMY_SCORE_SELECT,
  SCHOOL_SCORE_SELECT,
  mapAcademyScoreRow,
  mapSchoolScoreRow,
} from '../lib/score-query';

const ScoreTypeSchema = z.enum(['academy', 'school']).openapi('ScoreType');
const ScoreStatusSchema = z.enum(['scored', 'absent', 'makeup']).openapi('ScoreStatus');

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi('ScoresError');

const ScoreRecordSchema = z
  .object({
    id: z.string(),
    type: ScoreTypeSchema,
    examName: z.string(),
    examDate: z.string(),
    studentId: z.string(),
    studentName: z.string(),
    subjectName: z.string().nullable(),
    score: z.number().nullable(),
    totalScore: z.number().nullable(),
    status: ScoreStatusSchema,
  })
  .openapi('ScoreRecord');

const ScoreListResponseSchema = z
  .object({
    data: z.array(ScoreRecordSchema),
    meta: z.object({
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
    }),
  })
  .openapi('ScoreListResponse');

const StudentSubjectSummarySchema = z
  .object({
    subjectName: z.string(),
    // 補習班小考各場總分不同（見 academy_exams.total_score），平均掉不同滿分的
    // 分數在數學上沒有意義（60/60 跟 60/100 平均起來的「60」是同一個數字，
    // 意義卻天差地遠）。改回「總得分/總滿分」讓消費端自己決定要不要換算成比例，
    // 也保留了原始分數感（見窗口裁決 2026-09-05）。
    academySum: z.number().nullable(),
    academyTotalSum: z.number().nullable(),
    // school_exams 沒有總分欄位（段考慣例上都是 100 分制，但 schema 沒有記錄這個
    // 假設），維持既有的平均 —— 跟及格線 migration 同一個範圍裁決：沒有總分資料
    // 就不做總分換算，是獨立的產品題。
    schoolAvg: z.number().nullable(),
    totalRecords: z.number().int(),
  })
  .openapi('StudentSubjectSummary');

const StudentSummaryResponseSchema = z
  .object({
    data: z.object({
      studentId: DbUuidSchema,
      studentName: z.string(),
      subjects: z.array(StudentSubjectSummarySchema),
    }),
  })
  .openapi('StudentSummaryResponse');

const ClassExamScoreSchema = z
  .object({
    studentId: DbUuidSchema,
    studentName: z.string(),
    score: z.number().nullable(),
    status: ScoreStatusSchema,
    notes: z.string().nullable(),
  })
  .openapi('ClassExamScore');

const ClassExamStatsResponseSchema = z
  .object({
    data: z.object({
      examId: DbUuidSchema,
      examName: z.string(),
      className: z.string(),
      summary: z.object({
        averageScore: z.number().nullable(),
        highestScore: z.number().nullable(),
        lowestScore: z.number().nullable(),
        absentCount: z.number().int(),
        recordedCount: z.number().int(),
      }),
      scores: z.array(ClassExamScoreSchema),
    }),
  })
  .openapi('ClassExamStatsResponse');

interface AcademyScoreRow {
  id: string;
  exam_id: string;
  student_id: string;
  score: number | null;
  status: string;
  exam_name: string;
  exam_date: string;
  subject_name: string | null;
  total_score: number | null;
  student_name: string;
}

interface SchoolScoreRow {
  id: string;
  school_exam_id: string;
  student_id: string;
  score: number | null;
  status: string;
  exam_label: string;
  exam_date: string | null;
  exam_created_at: string;
  subject_name: string;
  student_name: string;
}

interface ScoreRecord {
  id: string;
  type: 'academy' | 'school';
  examName: string;
  examDate: string;
  studentId: string;
  studentName: string;
  subjectName: string | null;
  score: number | null;
  totalScore: number | null;
  status: 'scored' | 'absent' | 'makeup';
}

const app = new OpenAPIHono<AppEnv>();

function averageOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(avg.toFixed(2));
}

/** 總得分／總滿分 —— 不做除法，讓消費端自己決定要不要換算成比例。 */
export function sumPairsOrNull(
  pairs: ReadonlyArray<{ score: number; totalScore: number }>,
): { sum: number; totalSum: number } | null {
  if (pairs.length === 0) return null;
  return pairs.reduce(
    (acc, pair) => ({ sum: acc.sum + pair.score, totalSum: acc.totalSum + pair.totalScore }),
    { sum: 0, totalSum: 0 },
  );
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Scores'],
  summary: '統一成績查詢',
  request: {
    query: z.object({
      studentId: DbUuidSchema.optional(),
      type: ScoreTypeSchema.optional(),
      subjectId: DbUuidSchema.optional(),
      dateFrom: z.string().date().optional(),
      dateTo: z.string().date().optional(),
      search: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).default(20).optional(),
    }),
  },
  responses: {
    200: {
      description: '成績列表',
      content: {
        'application/json': {
          schema: ScoreListResponseSchema,
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

/**
 * 老師只讀得到自己固定任課班的學生成績。回 `null` 代表不受限（管理員）。
 *
 * 空陣列跟 `null` 是**不同的意思**：空陣列＝這位老師沒有任何班，該回空結果；
 * `null`＝不必縮限。混在一起的話「沒有班的老師」會看到全校成績。
 */
async function readableStudentIds(
  supabase: AppEnv['Variables']['supabase'],
  params: { orgId: string; userId: string; roles: readonly string[] },
): Promise<string[] | null | 'forbidden'> {
  if (params.roles.includes('admin')) return null;

  const scope = await loadTeachingScope(supabase, params);
  if ('forbidden' in scope || !scope.teacherStaffId) return 'forbidden';

  return taughtStudentIds(supabase, params.orgId, scope.teacherStaffId);
}

app.openapi(listRoute, async (c) => {
  const orgId = c.get('orgId');
  const supabase = c.get('supabase');
  const {
    studentId,
    type,
    subjectId,
    dateFrom,
    dateTo,
    search,
    page = 1,
    pageSize = 20,
  } = c.req.valid('query');

  const searchKeyword = search?.trim() ? `%${search.trim()}%` : null;
  const offset = (page - 1) * pageSize;

  // 老師只讀得到自己任課班的學生成績
  const readable = await readableStudentIds(supabase, {
    orgId,
    userId: c.get('userId'),
    roles: c.get('roles') ?? [],
  });
  if (readable === 'forbidden') {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }
  // 空陣列 = 這位老師沒有任何班。回空結果而不是不縮限 —— 「沒有班」不是通行證
  if (readable !== null && readable.length === 0) {
    return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
  }

  try {
    const results: ScoreRecord[] = [];
    let totalAcademy = 0;
    let totalSchool = 0;

    // Fetch academy scores (unless type is explicitly 'school')
    if (!type || type === 'academy') {
      const buildAcademyQuery = () =>
        supabase
          .from('academy_scores')
          .select(`${ACADEMY_SCORE_SELECT}, students!inner ( name )`, { count: 'exact' })
          .eq('academy_exams.org_id', orgId);

      const applyAcademyFilters = (query: ReturnType<typeof buildAcademyQuery>) => {
        let next = query;
        if (readable !== null) {
          next = next.in('student_id', readable);
        }
        if (studentId) {
          next = next.eq('student_id', studentId);
        }
        if (subjectId) {
          next = next.eq('academy_exams.subject_id', subjectId);
        }
        if (dateFrom) {
          next = next.gte('academy_exams.exam_date', dateFrom);
        }
        if (dateTo) {
          next = next.lte('academy_exams.exam_date', dateTo);
        }
        return next;
      };

      const academyRowMap = new Map<string, any>();
      let academyCount = 0;
      let academyError: { message: string } | null = null;

      if (searchKeyword) {
        const [studentResult, examResult] = await Promise.all([
          supabase.from('students').select('id').eq('org_id', orgId).ilike('name', searchKeyword),
          (() => {
            let query = supabase
              .from('academy_exams')
              .select('id')
              .eq('org_id', orgId)
              .ilike('name', searchKeyword);
            if (subjectId) query = query.eq('subject_id', subjectId);
            if (dateFrom) query = query.gte('exam_date', dateFrom);
            if (dateTo) query = query.lte('exam_date', dateTo);
            return query;
          })(),
        ]);

        if (studentResult.error || examResult.error) {
          academyError = {
            message: studentResult.error?.message ?? examResult.error?.message ?? 'DB_ERROR',
          };
        } else {
          const matchedStudentIds = (studentResult.data ?? []).map((row) => row.id);
          const matchedExamIds = (examResult.data ?? []).map((row) => row.id);

          const candidateQueries: any[] = [];
          if (matchedStudentIds.length > 0) {
            candidateQueries.push(
              applyAcademyFilters(buildAcademyQuery())
                .in('student_id', matchedStudentIds)
                .order('exam_date', {
                  referencedTable: 'academy_exams',
                  ascending: false,
                }),
            );
          }
          if (matchedExamIds.length > 0) {
            candidateQueries.push(
              applyAcademyFilters(buildAcademyQuery())
                .in('exam_id', matchedExamIds)
                .order('exam_date', {
                  referencedTable: 'academy_exams',
                  ascending: false,
                }),
            );
          }

          if (candidateQueries.length > 0) {
            const queryResults = await Promise.all(candidateQueries);
            for (const result of queryResults) {
              if (result.error) {
                academyError = { message: result.error.message };
                break;
              }
              for (const row of result.data ?? []) {
                academyRowMap.set(row.id, row);
              }
            }
          }
        }
      } else {
        const { data, count, error } = await applyAcademyFilters(buildAcademyQuery()).order(
          'exam_date',
          { referencedTable: 'academy_exams', ascending: false },
        );
        if (error) {
          academyError = { message: error.message };
        } else {
          academyCount = count ?? 0;
          for (const row of data ?? []) {
            academyRowMap.set(row.id, row);
          }
        }
      }

      const academyRows = Array.from(academyRowMap.values());
      if (searchKeyword) {
        academyCount = academyRows.length;
      }

      if (academyError) {
        console.error('Academy scores query error:', academyError);
      } else {
        totalAcademy = academyCount;
        for (const row of academyRows ?? []) {
          const student = row.students as any;
          results.push({
            ...mapAcademyScoreRow(row),
            studentId: row.student_id,
            studentName: student.name,
          });
        }
      }
    }

    // Fetch school scores (unless type is explicitly 'academy')
    if (!type || type === 'school') {
      const buildSchoolQuery = () =>
        supabase
          .from('school_scores')
          .select(`${SCHOOL_SCORE_SELECT}, students!inner ( name )`, { count: 'exact' })
          .eq('school_exams.org_id', orgId);

      const applySchoolFilters = (query: ReturnType<typeof buildSchoolQuery>) => {
        let next = query;
        if (readable !== null) {
          next = next.in('student_id', readable);
        }
        if (studentId) {
          next = next.eq('student_id', studentId);
        }
        if (subjectId) {
          next = next.eq('subject_id', subjectId);
        }
        return next;
      };

      const schoolRowMap = new Map<string, any>();
      let schoolCount = 0;
      let schoolError: { message: string } | null = null;

      if (searchKeyword) {
        const [studentResult, examResult] = await Promise.all([
          supabase.from('students').select('id').eq('org_id', orgId).ilike('name', searchKeyword),
          supabase
            .from('school_exams')
            .select('id')
            .eq('org_id', orgId)
            .ilike('label', searchKeyword),
        ]);

        if (studentResult.error || examResult.error) {
          schoolError = {
            message: studentResult.error?.message ?? examResult.error?.message ?? 'DB_ERROR',
          };
        } else {
          const matchedStudentIds = (studentResult.data ?? []).map((row) => row.id);
          const matchedExamIds = (examResult.data ?? []).map((row) => row.id);
          const candidateQueries: any[] = [];

          if (matchedStudentIds.length > 0) {
            candidateQueries.push(
              applySchoolFilters(buildSchoolQuery())
                .in('student_id', matchedStudentIds)
                .order('created_at', {
                  referencedTable: 'school_exams',
                  ascending: false,
                }),
            );
          }
          if (matchedExamIds.length > 0) {
            candidateQueries.push(
              applySchoolFilters(buildSchoolQuery())
                .in('school_exam_id', matchedExamIds)
                .order('created_at', {
                  referencedTable: 'school_exams',
                  ascending: false,
                }),
            );
          }

          if (candidateQueries.length > 0) {
            const queryResults = await Promise.all(candidateQueries);
            for (const result of queryResults) {
              if (result.error) {
                schoolError = { message: result.error.message };
                break;
              }
              for (const row of result.data ?? []) {
                schoolRowMap.set(row.id, row);
              }
            }
          }
        }
      } else {
        const { data, count, error } = await applySchoolFilters(buildSchoolQuery()).order(
          'created_at',
          {
            referencedTable: 'school_exams',
            ascending: false,
          },
        );
        if (error) {
          schoolError = { message: error.message };
        } else {
          schoolCount = count ?? 0;
          for (const row of data ?? []) {
            schoolRowMap.set(row.id, row);
          }
        }
      }

      const schoolRows = Array.from(schoolRowMap.values());
      if (searchKeyword) {
        schoolCount = schoolRows.length;
      }

      if (schoolError) {
        console.error('School scores query error:', schoolError);
      } else {
        totalSchool = schoolCount;
        for (const row of schoolRows ?? []) {
          const student = row.students as any;
          results.push({
            ...mapSchoolScoreRow(row),
            studentId: row.student_id,
            studentName: student.name,
          });
        }
      }
    }

    // Sort combined results by examDate descending
    results.sort((a, b) => (b.examDate > a.examDate ? 1 : b.examDate < a.examDate ? -1 : 0));

    // Paginate in-memory (since we're merging two sources)
    const total = totalAcademy + totalSchool;
    const paginated = results.slice(offset, offset + pageSize);

    return c.json(
      {
        data: paginated,
        meta: {
          total,
          page,
          pageSize,
        },
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '查詢失敗';
    console.error('Scores query error:', error);
    return c.json({ error: message, code: 'DB_ERROR' }, 400);
  }
});

const studentSummaryRoute = createRoute({
  method: 'get',
  path: '/student/{studentId}/summary',
  tags: ['Scores'],
  summary: '取得學生成績摘要（各科平均）',
  request: {
    params: z.object({
      studentId: DbUuidSchema,
    }),
  },
  responses: {
    200: {
      description: '摘要資料',
      content: {
        'application/json': {
          schema: StudentSummaryResponseSchema,
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
  },
});

app.openapi(studentSummaryRoute, async (c) => {
  const orgId = c.get('orgId');
  const supabase = c.get('supabase');
  const { studentId } = c.req.valid('param');

  const readable = await readableStudentIds(supabase, {
    orgId,
    userId: c.get('userId'),
    roles: c.get('roles') ?? [],
  });
  if (readable === 'forbidden') {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }
  if (readable !== null && !readable.includes(studentId)) {
    return c.json({ error: '這位學生不在你的任課班級', code: 'STUDENT_OUT_OF_SCOPE' }, 403);
  }

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, name, school_id')
    .eq('id', studentId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (studentError) {
    return c.json({ error: studentError.message, code: 'DB_ERROR' }, 400);
  }
  if (!student) {
    return c.json({ error: '找不到學生', code: 'NOT_FOUND' }, 404);
  }

  const studentSchoolId = (student as { school_id: string | null }).school_id ?? null;

  const [academyResult, schoolResult] = await Promise.all([
    supabase
      .from('academy_scores')
      .select(
        'score, status, academy_exams!inner(subject_id, org_id, exam_date, total_score, subjects(name))',
      )
      .eq('student_id', studentId)
      .eq('academy_exams.org_id', orgId),
    (() => {
      let query = supabase
        .from('school_scores')
        .select(
          'score, status, subject_id, subjects(name), school_exams!inner(org_id, exam_date, academic_year, semester, exam_type, school_id)',
        )
        .eq('student_id', studentId)
        .eq('school_exams.org_id', orgId);
      if (studentSchoolId) {
        query = query.eq('school_exams.school_id', studentSchoolId);
      }
      return query;
    })(),
  ]);

  if (academyResult.error || schoolResult.error) {
    return c.json(
      {
        error: academyResult.error?.message ?? schoolResult.error?.message ?? 'DB_ERROR',
        code: 'DB_ERROR',
      },
      400,
    );
  }

  const summaryMap = new Map<
    string,
    {
      subjectName: string;
      academyScores: Array<{ score: number; totalScore: number }>;
      schoolScores: number[];
      totalRecords: number;
    }
  >();

  const schoolRows = (schoolResult.data ?? []).map((rawRow) => {
    const row = rawRow as any;
    const exam = Array.isArray(row.school_exams) ? row.school_exams[0] : row.school_exams;
    const subject = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;

    return {
      subjectName: subject?.name ?? `科目-${row.subject_id ?? 'unknown'}`,
      score: row.score as number | null,
      status: row.status as string,
      examDate: (exam?.exam_date ?? null) as string | null,
      academicYear: exam?.academic_year as number,
      semester: exam?.semester as number,
    };
  });

  const latestSchoolExamKey = schoolRows.reduce<string | null>((best, r) => {
    const key = `${r.academicYear}-${r.semester}-${r.examDate ?? ''}`;
    if (!best) return key;
    return key > best ? key : best;
  }, null);

  // 補習班成績以「最近段考之後」為範圍；若學生從未參加過段考則取全部
  const cycleStartDate = schoolRows.reduce<string | null>((best, r) => {
    if (!r.examDate) return best;
    if (!best || r.examDate > best) return r.examDate;
    return best;
  }, null);

  for (const row of schoolRows) {
    if (!summaryMap.has(row.subjectName)) {
      summaryMap.set(row.subjectName, {
        subjectName: row.subjectName,
        academyScores: [],
        schoolScores: [],
        totalRecords: 0,
      });
    }
    const bucket = summaryMap.get(row.subjectName)!;
    bucket.totalRecords += 1;
    const key = `${row.academicYear}-${row.semester}-${row.examDate ?? ''}`;
    if (
      key === latestSchoolExamKey &&
      row.status !== 'absent' &&
      typeof row.score === 'number' &&
      Number.isFinite(row.score)
    ) {
      bucket.schoolScores.push(row.score);
    }
  }

  for (const rawRow of academyResult.data ?? []) {
    const row = rawRow as any;
    const exam = Array.isArray(row.academy_exams) ? row.academy_exams[0] : row.academy_exams;
    const subject = exam?.subjects;
    const subjectName =
      (Array.isArray(subject) ? subject[0]?.name : subject?.name) ??
      `科目-${exam?.subject_id ?? 'unknown'}`;
    const examDate = exam?.exam_date as string | null;
    // 只取最近段考之後的成績；無段考紀錄則全部計入
    if (cycleStartDate && (!examDate || examDate <= cycleStartDate)) {
      continue;
    }
    if (!summaryMap.has(subjectName)) {
      summaryMap.set(subjectName, {
        subjectName,
        academyScores: [],
        schoolScores: [],
        totalRecords: 0,
      });
    }
    const bucket = summaryMap.get(subjectName)!;
    bucket.totalRecords += 1;
    // total_score 理論上一定有（academy_exams.total_score 是 NOT NULL），
    // 防禦性檢查是為了不讓一筆型別異常的資料把整個 totalSum 弄成 NaN
    const examTotalScore = typeof exam?.total_score === 'number' ? exam.total_score : null;
    if (
      row.status !== 'absent' &&
      typeof row.score === 'number' &&
      Number.isFinite(row.score) &&
      examTotalScore !== null
    ) {
      bucket.academyScores.push({ score: row.score, totalScore: examTotalScore });
    }
  }

  const subjects = Array.from(summaryMap.values())
    .map((item) => {
      const academySummary = sumPairsOrNull(item.academyScores);
      return {
        subjectName: item.subjectName,
        academySum: academySummary?.sum ?? null,
        academyTotalSum: academySummary?.totalSum ?? null,
        schoolAvg: averageOrNull(item.schoolScores),
        totalRecords: item.totalRecords,
      };
    })
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'zh-Hant'));

  return c.json(
    {
      data: {
        studentId: student.id,
        studentName: student.name,
        subjects,
      },
    },
    200,
  );
});

const classExamStatsRoute = createRoute({
  method: 'get',
  path: '/class/{classId}/exam/{examId}',
  tags: ['Scores'],
  summary: '取得班級某場補習班考試統計',
  request: {
    params: z.object({
      classId: DbUuidSchema,
      examId: DbUuidSchema,
    }),
  },
  responses: {
    200: {
      description: '班級考試統計',
      content: {
        'application/json': {
          schema: ClassExamStatsResponseSchema,
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

app.openapi(classExamStatsRoute, async (c) => {
  const orgId = c.get('orgId');
  const supabase = c.get('supabase');
  const { classId, examId } = c.req.valid('param');

  const roles = c.get('roles') ?? [];
  if (!roles.includes('admin')) {
    const scope = await loadTeachingScope(supabase, {
      orgId,
      userId: c.get('userId'),
      roles,
    });
    if ('forbidden' in scope || !scope.teacherStaffId) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }
    const taught = await taughtClassIds(supabase, orgId, scope.teacherStaffId);
    if (!taught.includes(classId)) {
      return c.json({ error: '這個班不在你的任課範圍', code: 'CLASS_OUT_OF_SCOPE' }, 403);
    }
  }

  const [{ data: classRow, error: classError }, { data: examClassRow, error: examClassError }] =
    await Promise.all([
      supabase
        .from('classes')
        .select('id, name')
        .eq('id', classId)
        .eq('org_id', orgId)
        .maybeSingle(),
      supabase
        .from('academy_exam_classes')
        .select('exam_id, academy_exams!inner(id, name, org_id)')
        .eq('class_id', classId)
        .eq('exam_id', examId)
        .eq('academy_exams.org_id', orgId)
        .maybeSingle(),
    ]);

  if (classError || examClassError) {
    return c.json(
      { error: classError?.message ?? examClassError?.message ?? 'DB_ERROR', code: 'DB_ERROR' },
      400,
    );
  }
  if (!classRow) {
    return c.json({ error: '找不到班級', code: 'NOT_FOUND' }, 404);
  }
  if (!examClassRow) {
    return c.json({ error: '找不到該班級關聯考試', code: 'NOT_FOUND' }, 404);
  }

  const exam = Array.isArray(examClassRow.academy_exams)
    ? examClassRow.academy_exams[0]
    : examClassRow.academy_exams;
  if (!exam) {
    return c.json({ error: '找不到考試事件', code: 'NOT_FOUND' }, 404);
  }

  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('enrollments')
    .select('student_id, students(name)')
    .eq('class_id', classId)
    .eq('status', 'active');

  if (enrollmentsError) {
    return c.json({ error: enrollmentsError.message, code: 'DB_ERROR' }, 400);
  }

  const studentIds = Array.from(new Set((enrollments ?? []).map((row) => row.student_id)));
  const { data: scoreRows, error: scoreError } =
    studentIds.length > 0
      ? await supabase
          .from('academy_scores')
          .select('student_id, score, status, notes')
          .eq('exam_id', examId)
          .in('student_id', studentIds)
      : { data: [], error: null };

  if (scoreError) {
    return c.json({ error: scoreError.message, code: 'DB_ERROR' }, 400);
  }

  const scoreMap = new Map<
    string,
    { score: number | null; status: 'scored' | 'absent' | 'makeup'; notes: string | null }
  >();
  for (const row of scoreRows ?? []) {
    scoreMap.set(row.student_id, {
      score: row.score,
      status: row.status as 'scored' | 'absent' | 'makeup',
      notes: row.notes,
    });
  }

  const scores = (enrollments ?? []).map((row) => {
    const student = Array.isArray(row.students) ? row.students[0] : row.students;
    const matched = scoreMap.get(row.student_id);
    return {
      studentId: row.student_id,
      studentName: student?.name ?? '',
      score: matched?.score ?? null,
      status: matched?.status ?? 'scored',
      notes: matched?.notes ?? null,
    };
  });

  const recordedRows = Array.from(scoreMap.values());
  const scoredValues = recordedRows
    .filter(
      (row) =>
        row.status === 'scored' && typeof row.score === 'number' && Number.isFinite(row.score),
    )
    .map((row) => row.score as number);

  const summary = {
    averageScore: averageOrNull(scoredValues),
    highestScore: scoredValues.length > 0 ? Math.max(...scoredValues) : null,
    lowestScore: scoredValues.length > 0 ? Math.min(...scoredValues) : null,
    absentCount: recordedRows.filter((row) => row.status === 'absent').length,
    recordedCount: recordedRows.length,
  };

  return c.json(
    {
      data: {
        examId,
        examName: exam.name,
        className: classRow.name,
        summary,
        scores,
      },
    },
    200,
  );
});

export default app;
