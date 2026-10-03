import { z } from '@hono/zod-openapi';
import type { SupabaseClient } from '@supabase/supabase-js';

import { DbUuidSchema } from './validation';

/**
 * 開課班目錄的「班 → 卡片」映射。**家長目錄（#1152）與公開目錄（#1125）共用** ——
 * 時段過濾、費用（停用範本回 null）、名額下限 0 只有一份，兩邊各寫一份遲早會漂。
 *
 * 各自加的東西留在各自的路由：家長目錄加老師名與 `matchesGrade`；公開目錄不回老師名。
 */

/** 兩邊都要的欄位。老師名只有家長目錄要，所以 `schedules` 的 teacher 由呼叫端決定要不要接 */
export const catalogClassSelect = (scheduleExtra = '') => `
  id, name, grade_levels, max_students, is_active, end_date,
  courses(id, name, description, is_active, subjects(name)),
  campuses(name),
  schedules(weekday, start_time, end_time, effective_to${scheduleExtra}),
  fee_template:fee_templates!default_fee_template_id(amount, billing_mode, is_active)
`;

export const CatalogClassSchema = z.object({
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
  maxStudents: z.number().int(),
  remainingSeats: z.number().int().min(0),
  /** 目錄參考價（班級的預設範本，#1175）。沒設、或範本已停用 → null（停用的價目表不再對外報價） */
  fee: z
    .object({
      amount: z.number().int(),
      billingMode: z.enum(['monthly', 'period', 'session_pack']),
    })
    .nullable(),
});

export type Row = Record<string, any>;
export const one = (value: unknown): Row | null =>
  (Array.isArray(value) ? value[0] : value) ?? null;
export const many = (value: unknown): Row[] =>
  Array.isArray(value) ? value : value ? [value as Row] : [];

/** 今天仍有效的時段，依星期、開始時間排 */
export function liveSchedules(row: Row, today: string): Row[] {
  return many(row['schedules'])
    .filter((s) => !s['effective_to'] || s['effective_to'] >= today)
    .sort((a, b) => a['weekday'] - b['weekday'] || a['start_time'].localeCompare(b['start_time']));
}

/** 開放中的班：班啟用、還沒結束（`end_date` 當天仍算）、課程沒停用。家長目錄與公開目錄同一條 */
export const isOpenClass = (row: Row, today: string): boolean =>
  row['is_active'] === true &&
  (!row['end_date'] || row['end_date'] >= today) &&
  // 課程停用＝正在收掉（不能再開新班、排未來課），目錄不推它底下的班（#1243）
  one(row['courses'])?.['is_active'] !== false;

export function toCatalogClass(row: Row, takenSeats: number, today: string) {
  const course = one(row['courses']);
  const feeTemplate = one(row['fee_template']);
  const maxStudents = row['max_students'] as number;
  return {
    classId: row['id'] as string,
    className: row['name'] as string,
    gradeLevels: (row['grade_levels'] ?? []) as string[],
    courseId: (course?.['id'] as string | undefined) ?? null,
    courseName: (course?.['name'] as string | undefined) ?? null,
    subject: (one(course?.['subjects'])?.['name'] as string | undefined) ?? null,
    courseDescription: (course?.['description'] as string | null | undefined) ?? null,
    campusName: (one(row['campuses'])?.['name'] as string | undefined) ?? null,
    slots: liveSchedules(row, today).map((s) => ({
      weekday: s['weekday'] as number,
      startTime: (s['start_time'] as string).slice(0, 5),
      endTime: (s['end_time'] as string).slice(0, 5),
    })),
    maxStudents,
    remainingSeats: Math.max(0, maxStudents - takenSeats),
    fee: feeTemplate?.['is_active']
      ? {
          amount: Number(feeTemplate['amount']),
          billingMode: feeTemplate['billing_mode'] as 'monthly' | 'period' | 'session_pack',
        }
      : null,
  };
}

/**
 * 各班佔名額人數（active＋pending_payment）。**公開目錄顯示的名額與公開申請判定的額滿用同一支**，
 * 不然會出現「目錄說還有位子、送出卻變候補」。`enrollment_requests`／`public_applications` 不佔名額。
 */
export async function takenSeats(
  supabase: SupabaseClient,
  orgId: string,
  classIds: readonly string[],
): Promise<{ taken: Map<string, number>; error: unknown }> {
  const taken = new Map<string, number>();
  if (classIds.length === 0) return { taken, error: null };
  const { data, error } = await supabase
    .from('enrollments')
    .select('class_id')
    .eq('org_id', orgId)
    .in('class_id', [...classIds])
    .in('status', ['active', 'pending_payment']);
  for (const row of (data ?? []) as Array<{ class_id: string }>) {
    taken.set(row.class_id, (taken.get(row.class_id) ?? 0) + 1);
  }
  return { taken, error };
}

/** 課程名 → 班名 */
export const byCourseThenClass = (
  a: { courseName: string | null; className: string },
  b: { courseName: string | null; className: string },
) =>
  (a.courseName ?? '').localeCompare(b.courseName ?? '') || a.className.localeCompare(b.className);
