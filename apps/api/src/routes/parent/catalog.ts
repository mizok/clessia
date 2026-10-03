import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { countEnrolledOn, type EnrollmentRange } from '../../lib/session-roster';
import { getCurrentTaipeiDateString } from '../../lib/taipei-date';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 家長端課程／開課班目錄 —— 加選、試聽、首頁推薦共用。見 kb/wiki/architecture/parent-catalog-read.md。
 *
 * 班級是**機構參考資料**：走 `childDb.orgRef('classes')`（只帶 `org_id`、不套孩子 scope），
 * 課程／分校／時段／老師名以 embed 帶出；名額走 `activeEnrollmentCounts`（只拿數字）。
 * 裁定（#1152）：全機構所有分校、年級只標 `matchesGrade` 不過濾、推薦不帶欄位。
 * 費用（#1175）：取自班級的預設範本，只是參考價 —— 實際報名價以報名時選的範本為準。
 */

const CLASS_SELECT = `
  id, name, grade_levels, max_students, is_active, end_date,
  courses(id, name, description, is_active, subjects(name)),
  campuses(name),
  schedules(weekday, start_time, end_time, effective_to, teacher:staff!teacher_id(display_name)),
  fee_template:fee_templates!default_fee_template_id(amount, billing_mode, is_active)
`;

const ParentCatalogClassSchema = z
  .object({
    classId: DbUuidSchema,
    className: z.string(),
    gradeLevels: z.array(z.string()),
    courseId: z.string().nullable(),
    courseName: z.string().nullable(),
    /** 科目名（`courses.subject_id → subjects.name`） */
    subject: z.string().nullable(),
    courseDescription: z.string().nullable(),
    campusName: z.string().nullable(),
    /** 今天仍有效的每週時段（1=週一 … 7=週日） */
    slots: z.array(
      z.object({ weekday: z.number().int(), startTime: z.string(), endTime: z.string() }),
    ),
    teacherNames: z.array(z.string()),
    maxStudents: z.number().int(),
    remainingSeats: z.number().int().min(0),
    /** 孩子的年級在 `gradeLevels` 裡，或 `gradeLevels` 為空（不限）。前端預設篩、可切換顯示全部 */
    matchesGrade: z.boolean(),
    /** 目錄參考價（班級的預設範本，#1175）。沒設、或範本已停用 → null（停用的價目表不再對外報價） */
    fee: z
      .object({
        amount: z.number().int(),
        billingMode: z.enum(['monthly', 'period', 'session_pack']),
      })
      .nullable(),
  })
  .openapi('ParentCatalogClass');

const ListResponseSchema = z
  .object({ data: z.array(ParentCatalogClassSchema) })
  .openapi('ParentCatalogResponse');

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('ParentCatalogError');

type Row = Record<string, any>;
const one = (value: unknown): Row | null => (Array.isArray(value) ? value[0] : value) ?? null;
const many = (value: unknown): Row[] =>
  Array.isArray(value) ? value : value ? [value as Row] : [];

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
      (row) =>
        (!row['end_date'] || row['end_date'] >= today) &&
        // #1243：課程停用＝正在收掉（不能再開新班、排未來課），加選頁不推它底下的班
        one(row['courses'])?.['is_active'] !== false &&
        countEnrolledOn(ranges, row['id'], today) === 0,
    );

    const { counts, error: countError } = await childDb.activeEnrollmentCounts(
      classes.map((row) => row['id'] as string),
    );
    if (countError) return failed();

    const data = classes
      .map((row) => {
        const course = one(row['courses']);
        const schedules = many(row['schedules'])
          .filter((s) => !s['effective_to'] || s['effective_to'] >= today)
          .sort(
            (a, b) => a['weekday'] - b['weekday'] || a['start_time'].localeCompare(b['start_time']),
          );
        const gradeLevels = (row['grade_levels'] ?? []) as string[];
        const maxStudents = row['max_students'] as number;
        const feeTemplate = one(row['fee_template']);
        return {
          classId: row['id'] as string,
          className: row['name'] as string,
          gradeLevels,
          courseId: (course?.['id'] as string | undefined) ?? null,
          courseName: (course?.['name'] as string | undefined) ?? null,
          subject: (one(course?.['subjects'])?.['name'] as string | undefined) ?? null,
          courseDescription: (course?.['description'] as string | null | undefined) ?? null,
          campusName: (one(row['campuses'])?.['name'] as string | undefined) ?? null,
          slots: schedules.map((s) => ({
            weekday: s['weekday'] as number,
            startTime: (s['start_time'] as string).slice(0, 5),
            endTime: (s['end_time'] as string).slice(0, 5),
          })),
          teacherNames: [
            ...new Set(
              schedules
                .map((s) => one(s['teacher'])?.['display_name'] as string | undefined)
                .filter((name): name is string => !!name),
            ),
          ],
          maxStudents,
          remainingSeats: Math.max(0, maxStudents - (counts.get(row['id']) ?? 0)),
          matchesGrade: gradeLevels.length === 0 || (!!grade && gradeLevels.includes(grade)),
          fee: feeTemplate?.['is_active']
            ? {
                amount: Number(feeTemplate['amount']),
                billingMode: feeTemplate['billing_mode'] as 'monthly' | 'period' | 'session_pack',
              }
            : null,
        };
      })
      .sort(
        (a, b) =>
          (a.courseName ?? '').localeCompare(b.courseName ?? '') ||
          a.className.localeCompare(b.className),
      );

    return c.json({ data }, 200);
  },
);

export default app;
