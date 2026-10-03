import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { countEnrolledOn, type EnrollmentRange } from '../../lib/session-roster';
import { getCurrentTaipeiDateString } from '../../lib/taipei-date';
import { DbUuidSchema } from '../../lib/validation';
import {
  CatalogClassSchema,
  byCourseThenClass,
  catalogClassSelect,
  isOpenClass,
  liveSchedules,
  one,
  toCatalogClass,
  type Row,
} from '../../lib/catalog-class';

/**
 * 家長端課程／開課班目錄 —— 加選、試聽、首頁推薦共用。見 kb/wiki/architecture/parent-catalog-read.md。
 *
 * 班級是**機構參考資料**：走 `childDb.orgRef('classes')`（只帶 `org_id`、不套孩子 scope），
 * 課程／分校／時段／老師名以 embed 帶出；名額走 `activeEnrollmentCounts`（只拿數字）。
 * 裁定（#1152）：全機構所有分校、年級只標 `matchesGrade` 不過濾、推薦不帶欄位。
 * 費用（#1175）：取自班級的預設範本，只是參考價 —— 實際報名價以報名時選的範本為準。
 */

/** 共用欄位（`lib/catalog-class.ts`）＋家長目錄才要的老師名 */
const CLASS_SELECT = catalogClassSelect(', teacher:staff!teacher_id(display_name)');

const ParentCatalogClassSchema = CatalogClassSchema.extend({
  teacherNames: z.array(z.string()),
  /** 孩子的年級在 `gradeLevels` 裡，或 `gradeLevels` 為空（不限）。前端預設篩、可切換顯示全部 */
  matchesGrade: z.boolean(),
}).openapi('ParentCatalogClass');

const ListResponseSchema = z
  .object({ data: z.array(ParentCatalogClassSchema) })
  .openapi('ParentCatalogResponse');

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('ParentCatalogError');

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/catalog
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '這個孩子可以加選／試聽的開課班目錄',
    request: { query: z.object({ childId: DbUuidSchema }) },
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
    const { childId } = c.req.valid('query');
    if (!isChildAllowed(c.get('studentScope'), childId)) {
      return c.json({ error: '沒有這個孩子的權限', code: 'CHILD_OUT_OF_SCOPE' }, 403);
    }

    const failed = () => c.json({ error: '讀取課程目錄失敗', code: 'FETCH_CATALOG_FAILED' }, 500);
    const childDb = c.get('childDb');
    const today = getCurrentTaipeiDateString();

    const [classResult, studentResult, enrollmentResult] = await Promise.all([
      childDb.orgRef('classes').select(CLASS_SELECT).eq('is_active', true),
      childDb.from('students', 'id').select('grade').eq('id', childId),
      childDb
        .from('enrollments', 'student_id')
        .select('class_id, effective_from, effective_to')
        .eq('student_id', childId),
    ]);
    if (classResult.error || studentResult.error || enrollmentResult.error) return failed();

    const grade = (one(studentResult.data)?.['grade'] as string | undefined) ?? null;
    const ranges: EnrollmentRange[] = ((enrollmentResult.data ?? []) as Row[]).map((r) => ({
      classId: r['class_id'],
      effectiveFrom: r['effective_from'],
      effectiveTo: r['effective_to'] ?? null,
    }));

    // ponytail: 結束日與「今天在籍」在記憶體濾 —— 一間補習班的開課班是幾十到幾百班
    const classes = ((classResult.data ?? []) as Row[]).filter(
      (row) => isOpenClass(row, today) && countEnrolledOn(ranges, row['id'], today) === 0,
    );

    const { counts, error: countError } = await childDb.activeEnrollmentCounts(
      classes.map((row) => row['id'] as string),
    );
    if (countError) return failed();

    const data = classes
      .map((row) => {
        const gradeLevels = (row['grade_levels'] ?? []) as string[];
        return {
          ...toCatalogClass(row, counts.get(row['id']) ?? 0, today),
          teacherNames: [
            ...new Set(
              liveSchedules(row, today)
                .map((s) => one(s['teacher'])?.['display_name'] as string | undefined)
                .filter((name): name is string => !!name),
            ),
          ],
          matchesGrade: gradeLevels.length === 0 || (!!grade && gradeLevels.includes(grade)),
        };
      })
      .sort(byCourseThenClass);

    return c.json({ data }, 200);
  },
);

export default app;
