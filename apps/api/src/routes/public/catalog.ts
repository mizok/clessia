import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../index';
import {
  CatalogClassSchema,
  byCourseThenClass,
  catalogClassSelect,
  isOpenClass,
  liveSchedules,
  one,
  takenSeats,
  toCatalogClass,
  type Row,
} from '../../lib/catalog-class';
import { getCurrentTaipeiDateString } from '../../lib/taipei-date';

/**
 * 公開課程目錄（#1125，免登入）—— 公開報名／試聽表單選班用（`specs/public/enrollment.md`：
 * 班名、上課時間、學費、剩餘名額，以課程分類）。org 由 `publicOrgMiddleware` 從部署設定解析。
 *
 * 跟家長目錄共用 `lib/catalog-class.ts` 的映射；名額只算 active＋pending_payment ——
 * `public_applications`（公開申請）是審核前，不佔名額。
 *
 * #1665（#1637 Q5、Q6）：
 * - 只列 `is_public_enrollment` 的班（行政可以把班藏起來；家長目錄不受影響）
 * - 老師只露**暱稱**：沒設暱稱的老師不出現，**絕不退回本名**。select 字串裡就沒有 `display_name` ——
 *   從查詢那一步就拿不到本名，而不是拿到再濾掉（`catalog.spec.ts` 兩層都守）
 * - `campuses`：有開放班的分校的對外聯絡資訊，成功畫面與失敗訊息要用
 */

/** ⚠️ 只准選 `nickname`。改這行之前讀上面的註解 */
const CLASS_SELECT = catalogClassSelect(', teacher:staff!teacher_id(nickname)');

const PublicCatalogClassSchema = CatalogClassSchema.extend({
  /** 目前有效時段的任課老師暱稱（去重）；沒設暱稱的老師不列 —— 可能是空陣列 */
  teacherNicknames: z.array(z.string()),
}).openapi('PublicCatalogClass');

const CampusContactSchema = z
  .object({ name: z.string(), phone: z.string().nullable(), address: z.string().nullable() })
  .openapi('PublicCatalogCampus');

const ListResponseSchema = z
  .object({ data: z.array(PublicCatalogClassSchema), campuses: z.array(CampusContactSchema) })
  .openapi('PublicCatalogResponse');
const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('PublicCatalogError');

const app = new OpenAPIHono<AppEnv>();

// GET /api/public/catalog
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Public'],
    summary: '公開課程目錄（免登入；報名／試聽表單選班用）',
    responses: {
      200: { description: '成功', content: { 'application/json': { schema: ListResponseSchema } } },
      404: {
        description: '這個部署沒有開放公開頁（PUBLIC_ORG_SLUG 未設定）',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '伺服器錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const today = getCurrentTaipeiDateString();
    const failed = () => c.json({ error: '讀取課程目錄失敗', code: 'FETCH_CATALOG_FAILED' }, 500);

    const { data, error } = await supabase
      .from('classes')
      .select(CLASS_SELECT)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .eq('is_public_enrollment', true);
    if (error) return failed();

    // ponytail: 結束日與課程停用在記憶體濾 —— 一間補習班的開課班是幾十到幾百班
    const classes = ((data ?? []) as Row[]).filter((row) => isOpenClass(row, today));

    const { taken, error: countError } = await takenSeats(
      supabase,
      orgId,
      classes.map((row) => row['id'] as string),
    );
    if (countError) return failed();

    // 名額晚一分鐘可接受；免登入讀取最便宜的防刷（正式的防濫用在 #1126）
    c.header('Cache-Control', 'public, max-age=60');
    const campuses = new Map<
      string,
      { name: string; phone: string | null; address: string | null }
    >();
    for (const row of classes) {
      const campus = one(row['campuses']);
      if (campus?.['name'] && !campuses.has(campus['name'])) {
        campuses.set(campus['name'], {
          name: campus['name'],
          phone: campus['phone'] ?? null,
          address: campus['address'] ?? null,
        });
      }
    }

    return c.json(
      {
        data: classes
          .map((row) => ({
            ...toCatalogClass(row, taken.get(row['id']) ?? 0, today),
            teacherNicknames: [
              ...new Set(
                liveSchedules(row, today)
                  // 只取 nickname；沒有就是沒有，不看任何其他欄位
                  .map((s) => one(s['teacher'])?.['nickname'] as string | null | undefined)
                  .map((n) => n?.trim())
                  .filter((n): n is string => !!n),
              ),
            ],
          }))
          .sort(byCourseThenClass),
        campuses: [...campuses.values()].sort((a, b) => a.name.localeCompare(b.name)),
      },
      200,
    );
  },
);

export default app;
