import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../index';
import {
  CatalogClassSchema,
  byCourseThenClass,
  catalogClassSelect,
  isOpenClass,
  takenSeats,
  toCatalogClass,
  type Row,
} from '../../lib/catalog-class';
import { getCurrentTaipeiDateString } from '../../lib/taipei-date';

/**
 * 公開課程目錄（#1125，免登入）—— 公開報名／試聽表單選班用（`specs/public/enrollment.md`：
 * 班名、上課時間、學費、剩餘名額，以課程分類）。org 由 `publicOrgMiddleware` 從部署設定解析。
 *
 * 跟家長目錄共用 `lib/catalog-class.ts` 的映射；**不回老師名**（公開頁是任何人，計畫席裁）。
 * 名額只算 active＋pending_payment —— `enrollment_requests`（公開報名的申請）是審核前，不佔名額。
 */

const ListResponseSchema = z
  .object({ data: z.array(CatalogClassSchema.openapi('PublicCatalogClass')) })
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
      .select(catalogClassSelect())
      .eq('org_id', orgId)
      .eq('is_active', true);
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
    return c.json(
      {
        data: classes
          .map((row) => toCatalogClass(row, taken.get(row['id']) ?? 0, today))
          .sort(byCourseThenClass),
      },
      200,
    );
  },
);

export default app;
