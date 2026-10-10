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
    /** 課程名（#1314 PG1）：校內考＝這場考試的班裡**這個孩子在籍過的**那幾個；段考、對不上 → null */
    className: z.string().nullable(),
    score: z.number().nullable(),
    totalScore: z.number().nullable(),
    status: z.enum(['scored', 'absent', 'makeup']),
    /** 這筆成績的登錄時間 —— 逐筆 NEW 標籤要靠它，`recentCount` 這個聚合數字指不出是哪幾筆 */
    createdAt: z.string(),
    /**
     * 及格線，只有校內考（academy）有值，段考一律 `null`。
     *
     * **不是錦上添花，是修一個矛盾**：admin-pages 的 `isFailingScore` 共用函式
     * 沒拿到這個欄位時會退化成比例算（`score < totalScore * 0.6`），跟行政端
     * 用真正及格線判斷的結果可能相反——同一筆資料家長端顯示及格、行政端顯示
     * 不及格，而家長看到的正是比較寬鬆的那個。見 #377 的討論。
     */
    passScore: z.number().nullable(),
    /** 考試描述：校內考的範圍說明（`scope_note`），段考一律 `null`（#1076） */
    description: z.string().nullable(),
  })
  .openapi('ParentScoreRecord');

/**
 * 機構的期（`billing_periods`）。成績頁的「學期」篩選就是它（#1076，使用者裁：全系統只有一條
 * 時間軸）。歸屬在前端用 `examDate` 落在 `startDate`～`endDate` 判；期允許重疊。
 */
const ParentGradePeriodSchema = z
  .object({ id: z.string(), name: z.string(), startDate: z.string(), endDate: z.string() })
  .openapi('ParentGradePeriod');

const ListResponseSchema = z
  .object({
    data: z.array(ParentScoreRecordSchema),
    meta: z.object({
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1),
      /** 過去 7 天內新登錄的成績筆數（登錄時間，不是考試日期） */
      recentCount: z.number().int().min(0),
      /** 機構的期，`startDate` 新到舊 */
      periods: z.array(ParentGradePeriodSchema),
    }),
  })
  .openapi('ParentScoreListResponse');

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('ParentScoreError');

/** 這場考試的班 ∩ 孩子報名過的班 → 班名（去重、用「、」接）；沒有交集 → null */
function academyClassName(row: any, myClassIds: ReadonlySet<string>): string | null {
  const names: string[] = (row.academy_exams?.academy_exam_classes ?? [])
    .filter((x: any) => myClassIds.has(x.class_id) && x.classes?.name)
    .map((x: any) => x.classes.name);
  return names.length > 0 ? [...new Set(names)].join('、') : null;
}

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

    const academyQuery = childDb
      .from('academy_scores', 'student_id')
      .select(ACADEMY_SCORE_SELECT)
      .eq('student_id', childId);

    const schoolQuery = childDb
      .from('school_scores', 'student_id')
      .select(SCHOOL_SCORE_SELECT)
      .eq('student_id', childId);

    const recentSince = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();

    const [academyResult, schoolResult, academyRecent, schoolRecent, periodsResult, myClasses] =
      await Promise.all([
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
        childDb
          .orgRef('billing_periods')
          .select('id, name, start_date, end_date')
          .order('start_date', { ascending: false }),
        // 一場考試可以掛多個班（academy_exam_classes）：只認這個孩子報名過的班，別班的名字不外流
        childDb.from('enrollments', 'student_id').pluck('class_id', 'class_id', childId),
      ]);

    if (
      academyResult.error ||
      schoolResult.error ||
      academyRecent.error ||
      schoolRecent.error ||
      periodsResult.error ||
      myClasses.error
    ) {
      return c.json({ error: '讀取成績失敗', code: 'FETCH_GRADES_FAILED' }, 500);
    }

    const academyRows = (academyResult.data ?? []) as unknown[];
    const schoolRows = (schoolResult.data ?? []) as unknown[];

    // 日期篩選照**回應裡的 examDate** 做，兩種成績同一條規則（#1167）：段考沒填考試日期時
    // examDate 退回建立日（mapSchoolScoreRow），DB 層篩 `school_exams.exam_date` 會把那些整批漏掉。
    // 一個孩子的成績本來就全撈回來在這裡分頁，篩在這裡不多撈。
    const results = [
      ...academyRows.map((row) => ({
        ...mapAcademyScoreRow(row),
        className: academyClassName(row, new Set(myClasses.ids)),
      })),
      ...schoolRows.map((row) => ({ ...mapSchoolScoreRow(row), className: null })),
    ].filter((r) => (!dateFrom || r.examDate >= dateFrom) && (!dateTo || r.examDate <= dateTo));
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
          periods: (
            (periodsResult.data ?? []) as unknown as Array<{
              id: string;
              name: string;
              start_date: string;
              end_date: string;
            }>
          ).map((p) => ({ id: p.id, name: p.name, startDate: p.start_date, endDate: p.end_date })),
        },
      },
      200,
    );
  },
);

export default app;
