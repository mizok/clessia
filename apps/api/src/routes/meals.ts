import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { summariseMealRecords, type MealAmountRow } from '../lib/meal-summary';
import { DbUuidSchema } from '../lib/validation';

/**
 * 餐務：每日名單。
 *
 * meal-rules 規則 1：**有上課 ≠ 有訂餐**。課表只產生**候選名單**，實際以每日的
 * `meal_records` 為準；`students.meal_default` 決定候選裡誰預設是勾起來的。
 *
 * 規則 3：「收不收費」是**人工開關不是規則** ——「小孩超過下午 N 點才請假，便當已經
 * 送到了」那種狀況是人工裁量，所以**不要自動化 N 點截止邏輯**。
 *
 * 規則 4：這是**管理端**的頁面，操作者是行政，不塞進老師的點名流程。
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const MealRosterRowSchema = z
  .object({
    studentId: DbUuidSchema,
    studentName: z.string(),
    /**
     * 班級脈絡。**是陣列不是單一字串** —— 一個學生同一天可能在兩個有課的班，
     * 而餐記錄是 `UNIQUE (student_id, meal_date)`：一天一筆便當，不分班。
     * 跟 `/api/contact-book/missing` 的 `classes` 同一個道理。
     */
    classNames: z.array(z.string()),
    mealDate: z.string(),
    /** 這個學生預設訂不訂餐（opt-in） */
    mealDefault: z.boolean(),
    /** 已經有記錄的話帶出來，沒有就是 null（還沒處理） */
    recordId: DbUuidSchema.nullable(),
    ordered: z.boolean().nullable(),
    chargeable: z.boolean().nullable(),
    unitPrice: z.number().nullable(),
    note: z.string().nullable(),
    /** 已結算的記錄鎖住，要改走帳單作廢或下期 adjustment（規則 2） */
    settled: z.boolean(),
  })
  .openapi('MealRosterRow');

const MealSummarySchema = z
  .object({
    total: z.number(),
    chargeableCount: z.number(),
    /** 區間內要收費的金額加總。**後端算的** —— 不要抓單頁明細自己加 */
    totalAmount: z.number(),
    settledCount: z.number(),
  })
  .openapi('MealSummary');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('MealError');

const app = new OpenAPIHono<AppEnv>();

// ============================================================
// ============================================================
// GET /api/meals
//
// **兩種模式，回的是同一種列**：
//   `date=`                    → 當日名單：課表候選 + 既有記錄（候選還沒處理的
//                                recordId 是 null）
//   `dateFrom=` / `dateTo=`    → 區間查詢：只回**實際存在的餐記錄**
//
// 區間模式沒有「候選」的概念 —— 要知道三個月前的某一天誰「應該」訂餐，得把當天的
// 課表重新推導一次，那既昂貴又沒有用（過去的名單就是那些記錄）。這個不對稱是刻意的，
// 列的形狀刻意保持一致，讓前端可以共用同一個 row 元件。
//
// `meta` 的金額與筆數是**整個區間**算的，不是當頁 —— spec 明說「總數取後端的
// meta.total，不要抓單頁明細自己加，量大的月份會悄悄少算而且錯得沒有徵兆」。
// 所以分頁用 DB 的 range，而 summary 另外撈整段（只取三個欄位）。
// ============================================================
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Meals'],
    summary: '訂餐名單（單日）或餐記錄查詢（區間）',
    request: {
      query: z.object({
        date: z.string().regex(DATE).optional(),
        dateFrom: z.string().regex(DATE).optional(),
        dateTo: z.string().regex(DATE).optional(),
        studentId: DbUuidSchema.optional(),
        page: z.string().optional(),
        pageSize: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(MealRosterRowSchema),
              defaultUnitPrice: z.number(),
              meta: MealSummarySchema.extend({ page: z.number(), pageSize: z.number() }),
            }),
          },
        },
      },
      400: { description: '參數錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const params = c.req.valid('query');

    const rangeMode = Boolean(params.dateFrom || params.dateTo);
    if (!params.date && !rangeMode) {
      return c.json({ error: '需要 date 或 dateFrom/dateTo', code: 'MISSING_RANGE' }, 400);
    }

    const from = rangeMode ? (params.dateFrom ?? params.dateTo!) : params.date!;
    const to = rangeMode ? (params.dateTo ?? params.dateFrom!) : params.date!;
    const page = Math.max(1, Number(params.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize ?? 100)));

    const { data: org } = await supabase
      .from('organizations')
      .select('meal_default_price')
      .eq('id', orgId)
      .maybeSingle();
    const defaultUnitPrice = Number(
      (org as { meal_default_price?: number } | null)?.meal_default_price ?? 0,
    );

    // 整段的統計：只取算得到金額的三個欄位，不撈明細
    let summaryQuery = supabase
      .from('meal_records')
      .select('ordered, chargeable, unit_price, invoice_item_id')
      .eq('org_id', orgId)
      .gte('meal_date', from)
      .lte('meal_date', to);
    if (params.studentId) summaryQuery = summaryQuery.eq('student_id', params.studentId);

    // 明細
    let recordQuery = supabase
      .from('meal_records')
      .select('*, students(name)')
      .eq('org_id', orgId)
      .gte('meal_date', from)
      .lte('meal_date', to);
    if (params.studentId) recordQuery = recordQuery.eq('student_id', params.studentId);
    if (rangeMode) recordQuery = recordQuery.range((page - 1) * pageSize, page * pageSize - 1);

    const [{ data: summaryRows }, { data: recordRows }] = await Promise.all([
      summaryQuery,
      recordQuery.order('meal_date', { ascending: false }),
    ]);

    const summary = summariseMealRecords(
      ((summaryRows ?? []) as unknown as Record<string, unknown>[]).map((row): MealAmountRow => ({
        ordered: Boolean(row['ordered']),
        chargeable: Boolean(row['chargeable']),
        unitPrice: Number(row['unit_price']),
        settled: Boolean(row['invoice_item_id']),
      })),
    );

    const records = ((recordRows ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      studentId: row['student_id'] as string,
      studentName: (row['students'] as { name?: string } | null)?.name ?? '',
      mealDate: row['meal_date'] as string,
      recordId: row['id'] as string,
      ordered: row['ordered'] as boolean,
      chargeable: row['chargeable'] as boolean,
      unitPrice: Number(row['unit_price']),
      note: (row['note'] as string | null) ?? null,
      settled: Boolean(row['invoice_item_id']),
    }));

    // ── 區間模式：只回實際記錄 ────────────────────────────────
    if (rangeMode) {
      return c.json(
        {
          data: records.map((record) => ({
            ...record,
            classNames: [],
            mealDefault: false,
          })),
          defaultUnitPrice,
          meta: { ...summary, page, pageSize },
        },
        200,
      );
    }

    // ── 單日模式：課表候選 + 既有記錄 ─────────────────────────
    const { data: sessionRows } = await supabase
      .from('sessions')
      .select('class_id')
      .eq('org_id', orgId)
      .eq('session_date', from);

    const classIds = Array.from(
      new Set(
        (sessionRows ?? []).map((row) => (row as Record<string, unknown>)['class_id'] as string),
      ),
    );

    const candidates = new Map<
      string,
      { studentId: string; studentName: string; mealDefault: boolean; classNames: string[] }
    >();

    if (classIds.length > 0) {
      const { data: enrollmentRows } = await supabase
        .from('enrollments')
        .select('student_id, students(name, meal_default), classes(name)')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .in('class_id', classIds);

      for (const row of (enrollmentRows ?? []) as unknown as Record<string, unknown>[]) {
        const studentId = row['student_id'] as string;
        const student = row['students'] as { name?: string; meal_default?: boolean } | null;
        const className = (row['classes'] as { name?: string } | null)?.name ?? '';

        const existing = candidates.get(studentId);
        if (existing) {
          // 一天可能在兩個有課的班，但便當只有一份 —— 併進同一列的班級脈絡
          if (className && !existing.classNames.includes(className)) {
            existing.classNames.push(className);
          }
          continue;
        }

        candidates.set(studentId, {
          studentId,
          studentName: student?.name ?? '',
          mealDefault: Boolean(student?.meal_default),
          classNames: className ? [className] : [],
        });
      }
    }

    const byStudent = new Map(records.map((record) => [record.studentId, record]));

    const roster = Array.from(candidates.values())
      .sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-Hant'))
      .map((candidate) => {
        const record = byStudent.get(candidate.studentId);
        return {
          ...candidate,
          mealDate: from,
          recordId: record?.recordId ?? null,
          ordered: record ? record.ordered : null,
          chargeable: record ? record.chargeable : null,
          unitPrice: record ? record.unitPrice : null,
          note: record?.note ?? null,
          settled: record?.settled ?? false,
        };
      });

    return c.json({ data: roster, defaultUnitPrice, meta: { ...summary, page, pageSize } }, 200);
  },
);

// ============================================================
// POST /api/meals/batch —— 批次確認當日名單
//
// **已結算的記錄不動。** 結算後改「收不收費」會讓已開出的帳單金額對不上，要改得走
// 帳單作廢（item 刪除 → FK SET NULL 自動解除標記）或下期 adjustment（規則 2）。
// 這裡不是靜靜跳過 —— 被擋下來的會列在回應裡，行政要知道哪幾筆沒改到。
// ============================================================
app.openapi(
  createRoute({
    method: 'post',
    path: '/batch',
    tags: ['Meals'],
    summary: '批次寫入當日訂餐記錄',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              date: z.string().regex(DATE),
              rows: z
                .array(
                  z.object({
                    studentId: DbUuidSchema,
                    ordered: z.boolean(),
                    chargeable: z.boolean().optional(),
                    unitPrice: z.number().int().min(0).optional(),
                    note: z.string().nullable().optional(),
                  }),
                )
                .min(1)
                .max(300),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              updated: z.number(),
              /** 已結算、因此沒有被改動的學生 */
              lockedStudentIds: z.array(DbUuidSchema),
            }),
          },
        },
      },
      400: { description: '錯誤', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { date, rows } = c.req.valid('json');

    const { data: org } = await supabase
      .from('organizations')
      .select('meal_default_price')
      .eq('id', orgId)
      .maybeSingle();
    const defaultPrice = Number(
      (org as { meal_default_price?: number } | null)?.meal_default_price ?? 0,
    );

    // 已結算的先撈出來，它們不參與這次寫入
    const { data: settledRows } = await supabase
      .from('meal_records')
      .select('student_id')
      .eq('org_id', orgId)
      .eq('meal_date', date)
      .not('invoice_item_id', 'is', null);

    const locked = new Set(
      (settledRows ?? []).map((row) => (row as Record<string, unknown>)['student_id'] as string),
    );

    const writable = rows.filter((row) => !locked.has(row.studentId));

    if (writable.length > 0) {
      const { error } = await supabase.from('meal_records').upsert(
        writable.map((row) => ({
          org_id: orgId,
          student_id: row.studentId,
          meal_date: date,
          ordered: row.ordered,
          chargeable: row.chargeable ?? true,
          unit_price: row.unitPrice ?? defaultPrice,
          note: row.note ?? null,
          created_by: userId,
        })),
        { onConflict: 'student_id,meal_date' },
      );

      if (error) {
        return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
      }
    }

    return c.json(
      {
        updated: writable.length,
        lockedStudentIds: rows
          .filter((row) => locked.has(row.studentId))
          .map((row) => row.studentId),
      },
      200,
    );
  },
);

export default app;
