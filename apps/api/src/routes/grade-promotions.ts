import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import { getAuth } from '../lib/get-auth';
import { getCampusScope } from '../lib/campus-scope';
import { DbUuidSchema } from '../lib/validation';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import { logAudit } from '../utils/audit';
import { waitUntilFrom } from '../lib/wait-until';
import {
  REVERT_WINDOW_DAYS,
  academicYearOf,
  promoteGrades,
  promotionPlan,
  revertPromotion,
  type Grade,
  type PlanStudent,
  type SchoolLevel,
} from '../lib/grade-promotion';

/**
 * 學年升級（#1820，**保留類**：批次改寫學生資料）。設計稿 `kb/wiki/specs/admin/system/grade-promotion.md`。
 *
 * 掛載層要 `manage_students`（`index.ts`），這裡再擋**受分校範圍限制的管理員**（要 `all_campuses`，計畫席裁 E）：
 * 升級是整個機構一次，只管某些分校的人不能代表全機構按；預覽也會列出全機構的學生名。
 */

const GradeSchema = z.enum([
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'J1',
  'J2',
  'J3',
  'S1',
  'S2',
  'S3',
]);

const PreviewSchema = z
  .object({
    academicYear: z.number().int(),
    /** 這一學年已經升過、還沒復原 —— 前端不給執行鈕 */
    alreadyPromoted: z.boolean(),
    transitions: z.array(
      z.object({ from: GradeSchema, to: GradeSchema.nullable(), count: z.number().int() }),
    ),
    promotedCount: z.number().int(),
    graduatedCount: z.number().int(),
    schoolMismatch: z.array(
      z.object({
        studentId: DbUuidSchema,
        name: z.string(),
        schoolName: z.string(),
        newGrade: GradeSchema,
      }),
    ),
    graduatesWithEnrollments: z.array(
      z.object({ studentId: DbUuidSchema, name: z.string(), classNames: z.array(z.string()) }),
    ),
  })
  .openapi('GradePromotionPreview');

const HistorySchema = z
  .object({
    data: z.array(
      z.object({
        id: DbUuidSchema,
        academicYear: z.number().int(),
        executedAt: z.string(),
        revertedAt: z.string().nullable(),
        /** 還在復原期限內、也還沒復原 */
        revertible: z.boolean(),
        studentCount: z.number().int(),
      }),
    ),
  })
  .openapi('GradePromotionHistory');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string() })
  .openapi('GradePromotionError');

const app = new OpenAPIHono<AppEnv>();

/** 受分校範圍限制（沒有 all_campuses）的管理員一律 403 —— 讀寫都擋 */
function campusRestricted(c: Context<AppEnv>) {
  return getCampusScope(c) !== null
    ? c.json(
        { error: '學年升級是全機構一次，需要「所有分校」權限', code: 'REQUIRES_ALL_CAMPUSES' },
        403,
      )
    : null;
}

type Row = Record<string, unknown>;
const one = (v: unknown): Row | null => (Array.isArray(v) ? (v[0] ?? null) : (v as Row | null));

// GET /api/grade-promotions/preview
app.openapi(
  createRoute({
    method: 'get',
    path: '/preview',
    tags: ['GradePromotions'],
    summary: '學年升級預覽（只算、不寫）',
    responses: {
      200: { description: '預覽', content: { 'application/json': { schema: PreviewSchema } } },
      403: {
        description: '需要所有分校權限',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '讀取失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const denied = campusRestricted(c);
    if (denied) return denied;
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const academicYear = academicYearOf(getCurrentTaipeiDateString());
    const fail = () => c.json({ error: '讀取學年升級預覽失敗', code: 'FETCH_FAILED' }, 500);

    const [students, existing] = await Promise.all([
      supabase
        .from('students')
        .select('id, name, grade, schools(name, level)')
        .eq('org_id', orgId)
        .eq('is_active', true),
      supabase
        .from('grade_promotions')
        .select('id')
        .eq('org_id', orgId)
        .eq('academic_year', academicYear)
        .is('reverted_at', null),
    ]);
    if (students.error || existing.error) return fail();

    const rows = (students.data ?? []) as Row[];
    const seniorIds = rows.filter((r) => r['grade'] === 'S3').map((r) => r['id'] as string);
    const enrollments =
      seniorIds.length === 0
        ? { data: [] as Row[], error: null }
        : await supabase
            .from('enrollments')
            .select('student_id, classes(name)')
            .eq('org_id', orgId)
            .eq('status', 'active')
            .in('student_id', seniorIds);
    if (enrollments.error) return fail();

    const classNamesOf = new Map<string, string[]>();
    for (const e of (enrollments.data ?? []) as Row[]) {
      const id = e['student_id'] as string;
      const name = (one(e['classes'])?.['name'] as string | undefined) ?? '';
      classNamesOf.set(id, [...(classNamesOf.get(id) ?? []), name]);
    }

    const plan = promotionPlan(
      rows.map((r): PlanStudent => ({
        id: r['id'] as string,
        name: r['name'] as string,
        grade: r['grade'] as Grade,
        schoolName: (one(r['schools'])?.['name'] as string | undefined) ?? null,
        schoolLevel: (one(r['schools'])?.['level'] as SchoolLevel | null | undefined) ?? null,
        activeClassNames: classNamesOf.get(r['id'] as string) ?? [],
      })),
    );

    return c.json(
      { academicYear, alreadyPromoted: (existing.data ?? []).length > 0, ...plan },
      200,
    );
  },
);

// POST /api/grade-promotions —— 執行
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['GradePromotions'],
    summary: '執行學年升級（整批一個交易）',
    responses: {
      201: {
        description: '已升級',
        content: {
          'application/json': {
            schema: z.object({
              promotionId: DbUuidSchema,
              academicYear: z.number().int(),
              promotedCount: z.number().int(),
              graduatedCount: z.number().int(),
            }),
          },
        },
      },
      403: {
        description: '需要所有分校權限',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '這一學年已經升過',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: '寫入失敗（整批已回滾）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const denied = campusRestricted(c);
    if (denied) return denied;
    const pool = getAuth(c).pool;
    // 池不在就 500，不退回沒有交易的逐筆寫法（pg-pool-writes.md 規則 6）
    if (!pool) return c.json({ error: '學年升級失敗', code: 'DB_POOL_UNAVAILABLE' }, 500);
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const academicYear = academicYearOf(getCurrentTaipeiDateString());

    let result;
    try {
      result = await promoteGrades(pool, { orgId, userId, academicYear });
    } catch (err) {
      console.error('[grade-promotions] promote failed:', err);
      return c.json({ error: '學年升級失敗，沒有任何學生被改動', code: 'DB_ERROR' }, 500);
    }
    if (result.status === 'already-promoted') {
      return c.json({ error: `${academicYear} 學年已經升級過了`, code: 'ALREADY_PROMOTED' }, 409);
    }

    logAudit(
      c.get('supabase'),
      {
        orgId,
        userId,
        resourceType: 'grade_promotion',
        resourceId: result.promotionId,
        resourceName: `${academicYear} 學年`,
        action: 'create',
        details: {
          academicYear,
          promotedCount: result.promotedCount,
          graduatedCount: result.graduatedCount,
        },
      },
      waitUntilFrom(c),
    );

    return c.json(
      {
        promotionId: result.promotionId,
        academicYear,
        promotedCount: result.promotedCount,
        graduatedCount: result.graduatedCount,
      },
      201,
    );
  },
);

// POST /api/grade-promotions/{id}/revert —— 復原（30 天內）
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/revert',
    tags: ['GradePromotions'],
    summary: '復原學年升級（30 天內，手改過的學生跳過）',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '已復原',
        content: {
          'application/json': {
            schema: z.object({
              revertedCount: z.number().int(),
              skipped: z.array(z.object({ studentId: DbUuidSchema, name: z.string() })),
            }),
          },
        },
      },
      403: {
        description: '需要所有分校權限',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: '找不到', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: '已復原或超過期限',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: '寫入失敗（整批已回滾）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const denied = campusRestricted(c);
    if (denied) return denied;
    const pool = getAuth(c).pool;
    if (!pool) return c.json({ error: '復原失敗', code: 'DB_POOL_UNAVAILABLE' }, 500);
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    let result;
    try {
      result = await revertPromotion(pool, { orgId, userId, promotionId: id, now: new Date() });
    } catch (err) {
      console.error('[grade-promotions] revert failed:', err);
      return c.json({ error: '復原失敗，沒有任何學生被改動', code: 'DB_ERROR' }, 500);
    }
    switch (result.status) {
      case 'not-found':
        return c.json({ error: '找不到這次升級', code: 'NOT_FOUND' }, 404);
      case 'already-reverted':
        return c.json({ error: '這次升級已經復原過了', code: 'ALREADY_REVERTED' }, 409);
      case 'expired':
        return c.json(
          { error: `升級超過 ${REVERT_WINDOW_DAYS} 天，不能復原`, code: 'REVERT_EXPIRED' },
          409,
        );
      case 'done':
        logAudit(
          c.get('supabase'),
          {
            orgId,
            userId,
            resourceType: 'grade_promotion',
            resourceId: id,
            resourceName: null,
            action: 'revert',
            details: { revertedCount: result.revertedCount, skippedCount: result.skipped.length },
          },
          waitUntilFrom(c),
        );
        return c.json({ revertedCount: result.revertedCount, skipped: result.skipped }, 200);
    }
  },
);

// GET /api/grade-promotions —— 歷史（最近 10 次）
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['GradePromotions'],
    summary: '學年升級紀錄',
    responses: {
      200: { description: '紀錄', content: { 'application/json': { schema: HistorySchema } } },
      403: {
        description: '需要所有分校權限',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '讀取失敗', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const denied = campusRestricted(c);
    if (denied) return denied;
    const { data, error } = await c
      .get('supabase')
      .from('grade_promotions')
      .select('id, academic_year, executed_at, reverted_at, grade_promotion_items(count)')
      .eq('org_id', c.get('orgId'))
      .order('executed_at', { ascending: false })
      .limit(10);
    if (error) return c.json({ error: '讀取學年升級紀錄失敗', code: 'FETCH_FAILED' }, 500);
    const now = Date.now();
    return c.json(
      {
        data: ((data ?? []) as Row[]).map((r) => {
          const executedAt = r['executed_at'] as string;
          const revertedAt = (r['reverted_at'] as string | null) ?? null;
          return {
            id: r['id'] as string,
            academicYear: r['academic_year'] as number,
            executedAt,
            revertedAt,
            revertible:
              !revertedAt && now - Date.parse(executedAt) <= REVERT_WINDOW_DAYS * 86_400_000,
            studentCount: (one(r['grade_promotion_items'])?.['count'] as number | undefined) ?? 0,
          };
        }),
      },
      200,
    );
  },
);

export default app;
