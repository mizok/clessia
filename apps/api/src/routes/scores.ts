import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { loadTeachingScope, taughtClassIds, taughtStudentIds } from '../lib/teacher-scope';
import { getCampusScope, type CampusScope } from '../lib/campus-scope';
import { isEnrolledOn } from '../lib/session-roster';
import { classWriteScope, studentWriteScope } from '../lib/campus-write-guard';
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
    /** `pending`＝還沒登錄（#1280；原本沒有成績列的也回 `scored`，「待登錄」篩不出來） */
    status: z.enum(['scored', 'absent', 'makeup', 'pending']),
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
        /**
         * 應登錄人數（#1280）＝考試那天在籍 ∪ 已登錄 —— 跟考試列表的分母同一個定義
         * （`lib/academy-exam-roster.ts`，issue #424），兩邊的 N/M 對得上
         */
        expectedCount: z.number().int(),
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
  const total = pairs.reduce(
    (acc, pair) => ({ sum: acc.sum + pair.score, totalSum: acc.totalSum + pair.totalScore }),
    { sum: 0, totalSum: 0 },
  );
  // 分數是 numeric（可帶小數），浮點相加會冒出 100.66999999999999 —— 跟 averageOrNull 一樣收到兩位
  return { sum: Number(total.sum.toFixed(2)), totalSum: total.totalSum };
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
      /** 開課班（#1115）：校內考要掛在這班、而且學生在這班；段考照學生是不是這班的人 */
      classId: DbUuidSchema.optional(),
      /** 課程（#1115）：展開成它的所有開課班，語意同 classId */
      courseId: DbUuidSchema.optional(),
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

/** PostgREST 的 max_rows（1000）會靜默截斷 —— 範圍解析用的清單要分頁撈齊，少一頁就少一批學生 */
async function fetchAllRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

/**
 * list 用：同 fetchAllRows，但把錯誤收成 `{ error }`（list 既有的錯誤處理是看 error 欄位）。
 *
 * **頂層一定要有穩定排序鍵**（reviewer 二讀）：呼叫端的 `.order(..., { referencedTable })` 排的是
 * **內嵌資源**，頂層列的順序不保證 —— 用 range 跨頁撈時，兩頁之間順序一變就會重複或漏列。
 * 這裡統一補 `order('id')`；最後的顯示順序本來就在 JS 照 examDate 排，DB 的順序只為了分頁穩定。
 */
function fetchAllOrError(
  make: () => {
    order: (column: 'id') => {
      range: (
        from: number,
        to: number,
      ) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>;
    };
  },
): Promise<{ data: any[] | null; error: { message: string } | null }> {
  return fetchAllRows<any>((from, to) => make().order('id').range(from, to)).then(
    (data) => ({ data, error: null }),
    (error: Error) => ({ data: null, error: { message: error.message } }),
  );
}

/**
 * 成績讀取的範圍（#1115）：**可讀學生 = 老師範圍 ∩ 分校範圍 ∩ 班級／課程篩選**，
 * 加上班級篩選時「校內考必須掛在那些班」的考試清單。`null` = 不限。
 *
 * - 分校：學生**任何一筆報名**的班級在範圍內就算（同 `studentWriteScope`、`GET /api/leaves`、#816）
 * - 班級：報名不分狀態 —— 成績是當時考的，退班了不該看不到（同 `taughtStudentIds`）
 *
 * ponytail: 學生 id 清單進 GET URL；分校內學生上千時改成 embed
 * `students!inner(enrollments!inner(classes!inner(campus_id)))` 在 DB 端篩
 */
async function resolveScoreScope(
  supabase: AppEnv['Variables']['supabase'],
  params: {
    orgId: string;
    userId: string;
    roles: readonly string[];
    campusScope: CampusScope;
    classId?: string;
    courseId?: string;
  },
): Promise<'forbidden' | { studentIds: string[] | null; academyExamIds: string[] | null }> {
  const readable = await readableStudentIds(supabase, params);
  if (readable === 'forbidden') return 'forbidden';

  let studentIds: string[] | null = readable;
  const keep = (ids: Iterable<string>) => {
    const allowed = new Set(ids);
    studentIds = studentIds === null ? [...allowed] : studentIds.filter((id) => allowed.has(id));
  };

  if (params.campusScope !== null) {
    const campusIds = [...params.campusScope];
    const rows = await fetchAllRows<{ student_id: string }>((from, to) =>
      supabase
        .from('enrollments')
        .select('student_id, classes!inner(campus_id)')
        .eq('org_id', params.orgId)
        .in('classes.campus_id', campusIds)
        .order('id')
        .range(from, to),
    );
    keep(rows.map((r) => r.student_id));
  }

  let academyExamIds: string[] | null = null;
  if (params.classId || params.courseId) {
    let classIds: string[];
    if (params.courseId) {
      const courseClasses = await fetchAllRows<{ id: string }>((from, to) =>
        supabase
          .from('classes')
          .select('id')
          .eq('org_id', params.orgId)
          .eq('course_id', params.courseId as string)
          .order('id')
          .range(from, to),
      );
      classIds = courseClasses.map((r) => r.id);
      if (params.classId) classIds = classIds.filter((id) => id === params.classId);
    } else {
      classIds = [params.classId as string];
    }

    const [enrolled, examLinks] = await Promise.all([
      fetchAllRows<{ student_id: string }>((from, to) =>
        supabase
          .from('enrollments')
          .select('student_id')
          .eq('org_id', params.orgId)
          .in('class_id', classIds)
          .order('id')
          .range(from, to),
      ),
      fetchAllRows<{ exam_id: string }>((from, to) =>
        supabase
          .from('academy_exam_classes')
          .select('exam_id')
          .in('class_id', classIds)
          .order('exam_id')
          .range(from, to),
      ),
    ]);
    keep(enrolled.map((r) => r.student_id));
    academyExamIds = [...new Set(examLinks.map((r) => r.exam_id))];
  }

  return { studentIds, academyExamIds };
}

app.openapi(listRoute, async (c) => {
  const orgId = c.get('orgId');
  const supabase = c.get('supabase');
  const {
    studentId,
    type,
    subjectId,
    classId,
    courseId,
    dateFrom,
    dateTo,
    search,
    page = 1,
    pageSize = 20,
  } = c.req.valid('query');

  const searchKeyword = search?.trim() ? `%${search.trim()}%` : null;
  const offset = (page - 1) * pageSize;

  // 老師範圍 ∩ 分校範圍 ∩ 班級／課程篩選（#1115）
  const scope = await resolveScoreScope(supabase, {
    orgId,
    userId: c.get('userId'),
    roles: c.get('roles') ?? [],
    campusScope: getCampusScope(c),
    classId,
    courseId,
  });
  if (scope === 'forbidden') {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }
  const readable = scope.studentIds;
  const academyExamIds = scope.academyExamIds;
  // 空陣列 = 範圍內沒有任何學生（沒有班的老師、沒被指派分校的管理員、空的班）。
  // 回空結果而不是不縮限 —— 「沒有」不是通行證
  if (readable !== null && readable.length === 0) {
    return c.json({ data: [], meta: { total: 0, page, pageSize } }, 200);
  }

  try {
    const results: ScoreRecord[] = [];

    // Fetch academy scores (unless type is explicitly 'school')
    // 篩了班但那些班沒掛任何校內考 → 校內考這半是空的（段考照學生篩，照常查）
    if ((!type || type === 'academy') && (academyExamIds === null || academyExamIds.length > 0)) {
      const buildAcademyQuery = () =>
        supabase
          .from('academy_scores')
          .select(`${ACADEMY_SCORE_SELECT}, students!inner ( name )`)
          .eq('academy_exams.org_id', orgId);

      const applyAcademyFilters = (query: ReturnType<typeof buildAcademyQuery>) => {
        let next = query;
        if (readable !== null) {
          next = next.in('student_id', readable);
        }
        if (academyExamIds !== null) {
          next = next.in('exam_id', academyExamIds);
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
            candidateQueries.push(() =>
              applyAcademyFilters(buildAcademyQuery())
                .in('student_id', matchedStudentIds)
                .order('exam_date', {
                  referencedTable: 'academy_exams',
                  ascending: false,
                }),
            );
          }
          if (matchedExamIds.length > 0) {
            candidateQueries.push(() =>
              applyAcademyFilters(buildAcademyQuery())
                .in('exam_id', matchedExamIds)
                .order('exam_date', {
                  referencedTable: 'academy_exams',
                  ascending: false,
                }),
            );
          }

          if (candidateQueries.length > 0) {
            const queryResults = await Promise.all(candidateQueries.map(fetchAllOrError));
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
        const { data, error } = await fetchAllOrError(() =>
          applyAcademyFilters(buildAcademyQuery()).order('exam_date', {
            referencedTable: 'academy_exams',
            ascending: false,
          }),
        );
        if (error) {
          academyError = { message: error.message };
        } else {
          for (const row of data ?? []) {
            academyRowMap.set(row.id, row);
          }
        }
      }

      const academyRows = Array.from(academyRowMap.values());

      if (academyError) {
        console.error('Academy scores query error:', academyError);
      } else {
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
          .select(`${SCHOOL_SCORE_SELECT}, students!inner ( name )`)
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
            candidateQueries.push(() =>
              applySchoolFilters(buildSchoolQuery())
                .in('student_id', matchedStudentIds)
                .order('created_at', {
                  referencedTable: 'school_exams',
                  ascending: false,
                }),
            );
          }
          if (matchedExamIds.length > 0) {
            candidateQueries.push(() =>
              applySchoolFilters(buildSchoolQuery())
                .in('school_exam_id', matchedExamIds)
                .order('created_at', {
                  referencedTable: 'school_exams',
                  ascending: false,
                }),
            );
          }

          if (candidateQueries.length > 0) {
            const queryResults = await Promise.all(candidateQueries.map(fetchAllOrError));
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
        const { data, error } = await fetchAllOrError(() =>
          applySchoolFilters(buildSchoolQuery()).order('created_at', {
            referencedTable: 'school_exams',
            ascending: false,
          }),
        );
        if (error) {
          schoolError = { message: error.message };
        } else {
          for (const row of data ?? []) {
            schoolRowMap.set(row.id, row);
          }
        }
      }

      const schoolRows = Array.from(schoolRowMap.values());

      if (schoolError) {
        console.error('School scores query error:', schoolError);
      } else {
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
    // 日期篩選照回應的 examDate 再做一次（#1253）：段考的查詢沒有日期條件，而段考沒填考試日期時
    // examDate 退回建立日，DB 層篩 school_exams.exam_date 會漏掉那些（同 #1167 家長端）
    const inRange = results.filter(
      (r) => (!dateFrom || r.examDate >= dateFrom) && (!dateTo || r.examDate <= dateTo),
    );
    inRange.sort((a, b) => (b.examDate > a.examDate ? 1 : b.examDate < a.examDate ? -1 : 0));

    // 兩個來源合併後在記憶體分頁 —— 所以上面每支查詢都分頁撈齊（#1253：max_rows 1000 會靜默截斷）
    // ponytail: 全撈；全機構上萬筆時改成 DB 端合併分頁（view＋range）
    const total = inRange.length;
    const paginated = inRange.slice(offset, offset + pageSize);

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

// ============================================================
// GET /api/scores/students —— 每生聚合（#1115）
// ============================================================
//
// 成績頁「依學生分組」用：同一組篩選下，每個學生一列。計算口徑跟 `/student/{id}/summary`
// 一致 —— 校內考是總得分／總滿分（不平均不同滿分的分數，窗口 2026-09-05），段考是平均。
//
// **必帶 classId／courseId／studentId 其一**（計畫席 10-04 裁）：聚合要撈齊符合條件的每一列，
// 而 PostgREST 的 max_rows（1000）會**靜默截斷** —— 數字錯了也看不出來。範圍縮到一個班的量級，
// 再加一道：實際筆數比撈回來的多就 400 `TOO_MANY_ROWS`，寧可叫人縮小條件也不回錯的數字。
const StudentAggregateSchema = z
  .object({
    studentId: DbUuidSchema,
    studentName: z.string(),
    academySum: z.number().nullable(),
    academyTotalSum: z.number().nullable(),
    schoolAvg: z.number().nullable(),
    scoredCount: z.number().int(),
    absentCount: z.number().int(),
    makeupCount: z.number().int(),
    latestExamDate: z.string().nullable(),
  })
  .openapi('ScoreStudentAggregate');

const studentAggregatesRoute = createRoute({
  method: 'get',
  path: '/students',
  tags: ['Scores'],
  summary: '每生成績聚合（必帶 classId／courseId／studentId 其一）',
  request: {
    query: z.object({
      type: ScoreTypeSchema.optional(),
      subjectId: DbUuidSchema.optional(),
      classId: DbUuidSchema.optional(),
      courseId: DbUuidSchema.optional(),
      studentId: DbUuidSchema.optional(),
      dateFrom: z.string().date().optional(),
      dateTo: z.string().date().optional(),
      /** 學生姓名 */
      search: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).default(50).optional(),
    }),
  },
  responses: {
    200: {
      description: '每生一列',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(StudentAggregateSchema),
            meta: z.object({
              total: z.number().int().min(0),
              page: z.number().int().min(1),
              pageSize: z.number().int().min(1),
            }),
          }),
        },
      },
    },
    400: {
      description: '沒帶範圍、或筆數超過上限',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: { description: '權限不足', content: { 'application/json': { schema: ErrorSchema } } },
    500: { description: '查詢失敗', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

app.openapi(studentAggregatesRoute, async (c) => {
  const orgId = c.get('orgId');
  const supabase = c.get('supabase');
  const q = c.req.valid('query');
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 50;

  if (!q.classId && !q.courseId && !q.studentId) {
    return c.json({ error: '請先選開課班、課程或學生', code: 'SCOPE_REQUIRED' }, 400);
  }

  const scope = await resolveScoreScope(supabase, {
    orgId,
    userId: c.get('userId'),
    roles: c.get('roles') ?? [],
    campusScope: getCampusScope(c),
    classId: q.classId,
    courseId: q.courseId,
  });
  if (scope === 'forbidden') {
    return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
  }
  const { studentIds, academyExamIds } = scope;
  const empty = { data: [], meta: { total: 0, page, pageSize } };
  if (studentIds !== null && studentIds.length === 0) return c.json(empty, 200);

  const wantAcademy = (!q.type || q.type === 'academy') && (academyExamIds?.length ?? 1) > 0;
  const wantSchool = !q.type || q.type === 'school';

  const academyPromise = wantAcademy
    ? (() => {
        let query = supabase
          .from('academy_scores')
          .select(`${ACADEMY_SCORE_SELECT}, students!inner ( name )`, { count: 'exact' })
          .eq('academy_exams.org_id', orgId);
        if (studentIds !== null) query = query.in('student_id', studentIds);
        if (academyExamIds !== null) query = query.in('exam_id', academyExamIds);
        if (q.studentId) query = query.eq('student_id', q.studentId);
        if (q.subjectId) query = query.eq('academy_exams.subject_id', q.subjectId);
        if (q.dateFrom) query = query.gte('academy_exams.exam_date', q.dateFrom);
        if (q.dateTo) query = query.lte('academy_exams.exam_date', q.dateTo);
        return query;
      })()
    : Promise.resolve({ data: [], count: 0, error: null });
  const schoolPromise = wantSchool
    ? (() => {
        let query = supabase
          .from('school_scores')
          .select(`${SCHOOL_SCORE_SELECT}, students!inner ( name )`, { count: 'exact' })
          .eq('school_exams.org_id', orgId);
        if (studentIds !== null) query = query.in('student_id', studentIds);
        if (q.studentId) query = query.eq('student_id', q.studentId);
        if (q.subjectId) query = query.eq('subject_id', q.subjectId);
        return query;
      })()
    : Promise.resolve({ data: [], count: 0, error: null });

  const [academyResult, schoolResult] = await Promise.all([academyPromise, schoolPromise]);
  if (academyResult.error || schoolResult.error) {
    return c.json(
      {
        error: (academyResult.error ?? schoolResult.error)?.message ?? '查詢失敗',
        code: 'DB_ERROR',
      },
      500,
    );
  }
  const academyRows = (academyResult.data ?? []) as any[];
  const schoolRows = (schoolResult.data ?? []) as any[];
  if (
    (academyResult.count ?? 0) > academyRows.length ||
    (schoolResult.count ?? 0) > schoolRows.length
  ) {
    return c.json(
      {
        error: '符合條件的成績太多，請縮小範圍（例如選單一開課班或日期區間）',
        code: 'TOO_MANY_ROWS',
      },
      400,
    );
  }

  // 段考的日期照回應的 examDate 篩（沒填考試日期時退回建立日，同 #1167）
  const inRange = (date: string) =>
    (!q.dateFrom || date >= q.dateFrom) && (!q.dateTo || date <= q.dateTo);
  const keyword = q.search?.trim().toLowerCase() ?? '';

  interface Acc {
    studentName: string;
    academyPairs: Array<{ score: number; totalScore: number }>;
    schoolScores: number[];
    scoredCount: number;
    absentCount: number;
    makeupCount: number;
    latestExamDate: string | null;
  }
  const byStudent = new Map<string, Acc>();
  const add = (row: any, record: ReturnType<typeof mapAcademyScoreRow>) => {
    const acc = byStudent.get(row.student_id) ?? {
      studentName: (row.students?.name as string) ?? '',
      academyPairs: [],
      schoolScores: [],
      scoredCount: 0,
      absentCount: 0,
      makeupCount: 0,
      latestExamDate: null,
    };
    if (record.status === 'scored') acc.scoredCount += 1;
    if (record.status === 'absent') acc.absentCount += 1;
    if (record.status === 'makeup') acc.makeupCount += 1;
    if (record.status === 'scored' && record.score !== null) {
      if (record.type === 'academy' && record.totalScore !== null) {
        acc.academyPairs.push({ score: Number(record.score), totalScore: record.totalScore });
      }
      if (record.type === 'school') acc.schoolScores.push(Number(record.score));
    }
    if (record.examDate && (!acc.latestExamDate || record.examDate > acc.latestExamDate)) {
      acc.latestExamDate = record.examDate;
    }
    byStudent.set(row.student_id, acc);
  };
  for (const row of academyRows) add(row, mapAcademyScoreRow(row));
  for (const row of schoolRows) {
    const record = mapSchoolScoreRow(row);
    if (inRange(record.examDate)) add(row, record);
  }

  const rows = [...byStudent]
    .filter(([, acc]) => !keyword || acc.studentName.toLowerCase().includes(keyword))
    .map(([studentId, acc]) => {
      const pairs = sumPairsOrNull(acc.academyPairs);
      return {
        studentId,
        studentName: acc.studentName,
        academySum: pairs?.sum ?? null,
        academyTotalSum: pairs?.totalSum ?? null,
        schoolAvg: averageOrNull(acc.schoolScores),
        scoredCount: acc.scoredCount,
        absentCount: acc.absentCount,
        makeupCount: acc.makeupCount,
        latestExamDate: acc.latestExamDate,
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-Hant'));

  return c.json(
    {
      data: rows.slice((page - 1) * pageSize, page * pageSize),
      meta: { total: rows.length, page, pageSize },
    },
    200,
  );
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
  // 分校範圍（#1250）：學生任一筆報名在範圍內就算，同 list（#1115）。不在本 org 的交給下面的 404
  if ((await studentWriteScope(supabase, orgId, getCampusScope(c), studentId)) === 'out-of-scope') {
    return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
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
  // 分校範圍（#1250）。不在本 org 的交給下面的 404
  if ((await classWriteScope(supabase, orgId, getCampusScope(c), classId)) === 'out-of-scope') {
    return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
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
        .select('exam_id, academy_exams!inner(id, name, org_id, exam_date)')
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

  // 名單＝**考試那天**在籍 ∪ 已登錄（#1280，跟考試列表的分母同一個定義，issue #424）。
  // 原本用「現在 status='active'」：考完才轉入的會永遠掛在名單上，考試日在籍、後來退班的卻消失。
  // 排除 void、保留 withdrawal —— 同 loadAcademyExamCounts
  const { data: enrollments, error: enrollmentsError } = await supabase
    .from('enrollments')
    .select('student_id, effective_from, effective_to, students(name)')
    .eq('org_id', orgId)
    .eq('class_id', classId)
    .neq('status', 'void');

  if (enrollmentsError) {
    return c.json({ error: enrollmentsError.message, code: 'DB_ERROR' }, 400);
  }

  const studentIds = Array.from(new Set((enrollments ?? []).map((row) => row.student_id)));
  const examDate = (exam as { exam_date?: string | null }).exam_date ?? null;
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

  // 一個學生在這班可能有多筆報名（退了又回來）—— 依學生去重
  const roster = new Map<string, string>();
  for (const row of enrollments ?? []) {
    const onExamDay = isEnrolledOn(
      { effectiveFrom: row.effective_from, effectiveTo: row.effective_to },
      examDate,
    );
    if (!onExamDay && !scoreMap.has(row.student_id)) continue;
    const student = Array.isArray(row.students) ? row.students[0] : row.students;
    roster.set(row.student_id, student?.name ?? '');
  }

  const scores = [...roster].map(([studentId, studentName]) => {
    const matched = scoreMap.get(studentId);
    return {
      studentId,
      studentName,
      score: matched?.score ?? null,
      status: matched?.status ?? ('pending' as const),
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
    expectedCount: roster.size,
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
