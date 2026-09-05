import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import {
  ACADEMY_SCORE_SELECT,
  SCHOOL_SCORE_SELECT,
  mapAcademyScoreRow,
  mapSchoolScoreRow,
} from '../../lib/score-query';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 家長端的成績列表。複用 `routes/scores.ts`（admin）的 select 與 mapper
 * （`lib/score-query.ts`），換掉查詢用的 client（`supabase` → `childDb`）。
 *
 * **班級排名天生不會出現在這裡** —— 不是靠事後刪欄位擋掉，是因為這支端點
 * 只查單一學生（`isChildAllowed` 通過後 `.eq('student_id', childId)`），
 * 排名活在管理端另一支從不被這裡呼叫的查詢裡（`class-scores-dialog`）。
 * 見 kb/wiki/architecture/parent-read-endpoints.md。
 */

const ParentScoreRecordSchema = z
  .object({
    id: z.string(),
    type: z.enum(['academy', 'school']),
    examName: z.string(),
    examDate: z.string(),
    subjectName: z.string().nullable(),
    score: z.number().nullable(),
    totalScore: z.number().nullable(),
    status: z.enum(['scored', 'absent', 'makeup']),
  })
  .openapi('ParentScoreRecord');

const ListResponseSchema = z
  .object({
    data: z.array(ParentScoreRecordSchema),
    meta: z.object({
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
      /** 過去 7 天內新登錄的成績筆數（登錄時間，不是考試日期） */
      recentCount: z.number().int().min(0),
    }),
  })
  .openapi('ParentScoreListResponse');

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('ParentScoreError');

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/grades
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '這個孩子的成績列表',
    request: {
      query: z.object({
        childId: DbUuidSchema,
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
        page: z.coerce.number().int().min(1).default(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: { description: '成功', content: { 'application/json': { schema: ListResponseSchema } } },
      403: {
        description: '不是家長身分或這個孩子不在範圍內',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(c.get('roles') ?? []).includes('parent')) {
      return c.json({ error: '不是家長身分', code: 'NOT_PARENT' }, 403);
    }

    const { childId, dateFrom, dateTo, page = 1, pageSize = 20 } = c.req.valid('query');

    if (!isChildAllowed(c.get('studentScope'), childId)) {
      return c.json({ error: '沒有這個孩子的權限', code: 'CHILD_OUT_OF_SCOPE' }, 403);
    }

    const childDb = c.get('childDb');

    let academyQuery = childDb
      .from('academy_scores', 'student_id')
      .select(ACADEMY_SCORE_SELECT)
      .eq('student_id', childId);
    if (dateFrom) academyQuery = academyQuery.gte('academy_exams.exam_date', dateFrom);
    if (dateTo) academyQuery = academyQuery.lte('academy_exams.exam_date', dateTo);

    const schoolQuery = childDb
      .from('school_scores', 'student_id')
      .select(SCHOOL_SCORE_SELECT)
      .eq('student_id', childId);

    const recentSince = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();

    const [academyResult, schoolResult, academyRecent, schoolRecent] = await Promise.all([
      academyQuery,
      schoolQuery,
      childDb
        .from('academy_scores', 'student_id')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', childId)
        .gte('created_at', recentSince),
      childDb
        .from('school_scores', 'student_id')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', childId)
        .gte('created_at', recentSince),
    ]);

    if (academyResult.error || schoolResult.error || academyRecent.error || schoolRecent.error) {
      return c.json({ error: '讀取成績失敗', code: 'FETCH_GRADES_FAILED' }, 500);
    }

    const academyRows = (academyResult.data ?? []) as unknown[];
    const schoolRows = (schoolResult.data ?? []) as unknown[];

    const results = [
      ...academyRows.map((row) => mapAcademyScoreRow(row)),
      ...schoolRows.map((row) => mapSchoolScoreRow(row)),
    ];
    results.sort((a, b) => (b.examDate > a.examDate ? 1 : b.examDate < a.examDate ? -1 : 0));

    const total = results.length;
    const offset = (page - 1) * pageSize;
    const paginated = results.slice(offset, offset + pageSize);

    return c.json(
      {
        data: paginated,
        meta: {
          total,
          page,
          pageSize,
          recentCount: (academyRecent.count ?? 0) + (schoolRecent.count ?? 0),
        },
      },
      200,
    );
  },
);

export default app;
