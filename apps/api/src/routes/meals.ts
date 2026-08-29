import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

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
    studentId: z.uuid(),
    studentName: z.string(),
    /** 這個學生預設訂不訂餐（opt-in） */
    mealDefault: z.boolean(),
    /** 已經有記錄的話帶出來，沒有就是 null（還沒處理） */
    recordId: z.uuid().nullable(),
    ordered: z.boolean().nullable(),
    chargeable: z.boolean().nullable(),
    unitPrice: z.number().nullable(),
    /** 已結算的記錄鎖住，要改走帳單作廢或下期 adjustment（規則 2） */
    settled: z.boolean(),
  })
  .openapi('MealRosterRow');

const ErrorSchema = z
  .object({ error: z.string(), code: z.string().optional() })
  .openapi('MealError');

const app = new OpenAPIHono<AppEnv>();

// ============================================================
// GET /api/meals?date=YYYY-MM-DD —— 當日名單
// ============================================================
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Meals'],
    summary: '某一天的訂餐名單（課表候選 + 既有記錄）',
    request: { query: z.object({ date: z.string().regex(DATE) }) },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(MealRosterRowSchema),
              defaultUnitPrice: z.number(),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { date } = c.req.valid('query');

    const [{ data: org }, { data: sessionRows }, { data: recordRows }] = await Promise.all([
      supabase.from('organizations').select('meal_default_price').eq('id', orgId).maybeSingle(),
      supabase.from('sessions').select('class_id').eq('org_id', orgId).eq('session_date', date),
      supabase.from('meal_records').select('*').eq('org_id', orgId).eq('meal_date', date),
    ]);

    const defaultUnitPrice = Number(
      (org as { meal_default_price?: number } | null)?.meal_default_price ?? 0,
    );

    const classIds = Array.from(
      new Set(
        (sessionRows ?? []).map((row) => (row as Record<string, unknown>)['class_id'] as string),
      ),
    );

    // 候選名單 = 當天有課的班裡，還在讀的學生
    let candidates: Array<{ studentId: string; studentName: string; mealDefault: boolean }> = [];
    if (classIds.length > 0) {
      const { data: enrollmentRows } = await supabase
        .from('enrollments')
        .select('student_id, students(name, meal_default)')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .in('class_id', classIds);

      const seen = new Set<string>();
      for (const row of enrollmentRows ?? []) {
        const record = row as Record<string, unknown>;
        const studentId = record['student_id'] as string;
        if (seen.has(studentId)) continue;
        seen.add(studentId);
        const student = record['students'] as { name?: string; meal_default?: boolean } | null;
        candidates.push({
          studentId,
          studentName: student?.name ?? '',
          mealDefault: Boolean(student?.meal_default),
        });
      }
      candidates = candidates.sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-Hant'));
    }

    const byStudent = new Map<string, Record<string, unknown>>();
    for (const row of recordRows ?? []) {
      const record = row as Record<string, unknown>;
      byStudent.set(record['student_id'] as string, record);
    }

    return c.json(
      {
        data: candidates.map((candidate) => {
          const record = byStudent.get(candidate.studentId);
          return {
            ...candidate,
            recordId: (record?.['id'] as string | undefined) ?? null,
            ordered: record ? (record['ordered'] as boolean) : null,
            chargeable: record ? (record['chargeable'] as boolean) : null,
            unitPrice: record ? Number(record['unit_price']) : null,
            settled: Boolean(record?.['invoice_item_id']),
          };
        }),
        defaultUnitPrice,
      },
      200,
    );
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
                    studentId: z.uuid(),
                    ordered: z.boolean(),
                    chargeable: z.boolean().optional(),
                    unitPrice: z.number().int().min(0).optional(),
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
              lockedStudentIds: z.array(z.uuid()),
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
