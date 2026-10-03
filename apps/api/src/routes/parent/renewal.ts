import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../../index';
import { isChildAllowed } from '../../lib/child-scope';
import { prorateByDays } from '../../lib/proration';
import { getCurrentTaipeiDateString } from '../../lib/taipei-date';
import { DbUuidSchema } from '../../lib/validation';

/**
 * 家長端續課預覽（#1121）：這個孩子下一期會繼續上哪些課、預估多少錢。
 *
 * **系統沒有「自動續課」也沒有「自動開單」** —— 帳單是行政手動跑 billing-runs 開的
 * （月 run 開月繳、期 run 開期繳）。這支只是**照期 run 會用的同一套規則**先算給家長看。
 * 計畫席 10-04 裁定（#1121 留言）：
 * - 「下期」= 機構 `billing_periods` 裡開始日晚於今天（台北）的最近一期；沒有就回 `nextPeriod: null`
 * - **只列期繳**（`billing_mode = 'period'`）—— 月繳每月照開沒有「續」；堂數制不進 run
 * - 原班在下期開始前就結束、而且有 `next_class_id` → 下期是那個班（`upgraded`）
 * - 預估費用：沿用原班 → `agreed_amount ?? 報名的範本定價` 再 `prorateByDays`（跟期 run 的
 *   `planTuitionItems` 同一條，預覽的數字就是 run 會開的數字）；升班 → 新班的預設範本整期，
 *   沒設就 `null`（前端顯示「待確認」）—— 原報名的議定價不一定適用新班
 * - **不回自動開單日**：系統給不出真的值
 */

const ScheduleSlotSchema = z.object({
  weekday: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
});

const RenewalItemSchema = z
  .object({
    enrollmentId: DbUuidSchema,
    courseName: z.string().nullable(),
    currentClassName: z.string(),
    nextClassName: z.string(),
    /** 下期換到 `next_class_id` 那個班（升班） */
    upgraded: z.boolean(),
    schedules: z.array(ScheduleSlotSchema),
    estimatedAmount: z.number().nullable(),
    /** `enrollment`＝照這筆報名的價格比例試算；`next_class_default`＝新班的預設參考價；`null`＝算不出來 */
    estimateSource: z.enum(['enrollment', 'next_class_default']).nullable(),
  })
  .openapi('ParentRenewalItem');

const ResponseSchema = z
  .object({
    data: z.object({
      nextPeriod: z
        .object({ name: z.string(), startDate: z.string(), endDate: z.string() })
        .nullable(),
      items: z.array(RenewalItemSchema),
    }),
  })
  .openapi('ParentRenewalPreviewResponse');

const ErrorSchema = z.object({ error: z.string(), code: z.string() }).openapi('ParentRenewalError');

type Row = Record<string, any>;
const one = (value: unknown): Row | null => (Array.isArray(value) ? value[0] : value) ?? null;
const many = (value: unknown): Row[] =>
  Array.isArray(value) ? value : value ? [value as Row] : [];

// ⚠️ 下一期的班要用**欄位名** `next_class_id(...)` 嵌入（多對一、回物件或 null）。
// 寫成 `classes!next_class_id(...)` 會被 PostgREST 讀成**反向**（「誰把我當下一班」，回陣列）——
// 本機實打抓到的（#1121），替身不會告訴你方向反了。
const CLASS_SELECT = `
  id, name, end_date,
  courses(name),
  schedules(weekday, start_time, end_time, effective_to),
  next_class:next_class_id(
    id, name,
    schedules(weekday, start_time, end_time, effective_to),
    fee_template:fee_templates!default_fee_template_id(amount, is_active)
  )
`;

const app = new OpenAPIHono<AppEnv>();

// GET /api/me/renewal-preview
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Me'],
    summary: '這個孩子下一期的續課預覽（只列期繳）',
    request: { query: z.object({ childId: DbUuidSchema }) },
    responses: {
      200: { description: '續課預覽', content: { 'application/json': { schema: ResponseSchema } } },
      403: {
        description: '不是家長，或這個孩子不在家長範圍內',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: { description: '讀取失敗', content: { 'application/json': { schema: ErrorSchema } } },
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
    const failed = () => c.json({ error: '讀取續課預覽失敗', code: 'FETCH_RENEWAL_FAILED' }, 500);

    const childDb = c.get('childDb');
    const today = getCurrentTaipeiDateString();

    const { data: periodRows, error: periodError } = await childDb
      .orgRef('billing_periods')
      .select('name, start_date, end_date')
      .gt('start_date', today)
      .order('start_date', { ascending: true })
      .limit(1);
    if (periodError) return failed();
    const period = ((periodRows ?? []) as unknown as Row[])[0];
    if (!period) return c.json({ data: { nextPeriod: null, items: [] } }, 200);
    const nextPeriod = {
      name: period['name'] as string,
      startDate: period['start_date'] as string,
      endDate: period['end_date'] as string,
    };

    // scope 是這個家長的所有孩子 —— eq 這一個（charter 1155 §一）
    const { data: enrollmentRows, error: enrollmentError } = await childDb
      .from('enrollments', 'student_id')
      .select('id, class_id, effective_from, effective_to, agreed_amount, fee_templates(amount)')
      .eq('student_id', childId)
      .eq('status', 'active')
      .eq('billing_mode', 'period');
    if (enrollmentError) return failed();
    const enrollments = ((enrollmentRows ?? []) as unknown as Row[]).filter(
      (row) => !row['effective_to'] || row['effective_to'] >= nextPeriod.startDate,
    );
    if (enrollments.length === 0) return c.json({ data: { nextPeriod, items: [] } }, 200);

    const { data: classRows, error: classError } = await childDb
      .orgRef('classes')
      .select(CLASS_SELECT)
      .in(
        'id',
        enrollments.map((row) => row['class_id'] as string),
      );
    if (classError) return failed();
    const classById = new Map(
      ((classRows ?? []) as unknown as Row[]).map((row) => [row['id'] as string, row]),
    );

    const slotsInPeriod = (classRow: Row | null) =>
      many(classRow?.['schedules'])
        .filter((s) => !s['effective_to'] || s['effective_to'] >= nextPeriod.startDate)
        .sort(
          (a, b) => a['weekday'] - b['weekday'] || a['start_time'].localeCompare(b['start_time']),
        )
        .map((s) => ({
          weekday: s['weekday'] as number,
          startTime: (s['start_time'] as string).slice(0, 5),
          endTime: (s['end_time'] as string).slice(0, 5),
        }));

    const items = enrollments.flatMap((enrollment) => {
      const current = classById.get(enrollment['class_id'] as string);
      if (!current) return [];
      const nextClass = one(current['next_class']);
      const endsBefore = !!current['end_date'] && current['end_date'] < nextPeriod.startDate;
      const upgraded = endsBefore && !!nextClass;
      const target = upgraded ? nextClass : current;

      let estimatedAmount: number | null = null;
      let estimateSource: 'enrollment' | 'next_class_default' | null = null;
      if (upgraded) {
        const template = one(nextClass?.['fee_template']);
        if (template?.['is_active']) {
          estimatedAmount = Number(template['amount']);
          estimateSource = 'next_class_default';
        }
      } else {
        // 跟期 run 同一條（billing-runs.ts：agreed_amount 優先，沒有才用範本定價）
        const full = Number(
          enrollment['agreed_amount'] ?? one(enrollment['fee_templates'])?.['amount'] ?? 0,
        );
        const { amount } = prorateByDays(
          full,
          { start: nextPeriod.startDate, end: nextPeriod.endDate },
          {
            from: enrollment['effective_from'] as string,
            to: (enrollment['effective_to'] as string | null) ?? null,
          },
        );
        if (amount > 0) {
          estimatedAmount = amount;
          estimateSource = 'enrollment';
        }
      }

      return [
        {
          enrollmentId: enrollment['id'] as string,
          courseName: (one(current['courses'])?.['name'] as string | undefined) ?? null,
          currentClassName: current['name'] as string,
          nextClassName: (target?.['name'] as string) ?? (current['name'] as string),
          upgraded,
          schedules: slotsInPeriod(target),
          estimatedAmount,
          estimateSource,
        },
      ];
    });

    return c.json({ data: { nextPeriod, items } }, 200);
  },
);

export default app;
