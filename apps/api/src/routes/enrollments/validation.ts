import { applyCampusFilter, type CampusScope } from '../../lib/campus-scope';
import type { SupabaseClient } from '@supabase/supabase-js';

import { scheduleOverlaps, scheduleRangeOf } from '../../lib/schedule-effective';

export interface EnrollmentPreconditionInput {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  readonly classId: string;
  readonly studentIds: readonly string[];
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  /**
   * 分校範圍（#2443）：班在範圍外**跟不存在一樣**（`CLASS_NOT_FOUND`），而且是第一步 ——
   * 先查撞課的話，範圍外的班會回 409 並帶出那班的時段。
   */
  readonly scope: CampusScope;
}

export type EnrollmentPreconditionError =
  { code: 'CLASS_NOT_FOUND'; message: string } | { code: 'SERVER_ERROR'; message: string };

export interface StudentScheduleConflict {
  readonly studentId: string;
  readonly conflictingClassId: string;
  readonly conflictingClassName: string;
  readonly conflictingCourseName: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
}

export interface EnrollmentPreconditionResult {
  readonly error: EnrollmentPreconditionError | null;
  readonly conflicts: readonly StudentScheduleConflict[];
}

interface TargetScheduleRow {
  readonly weekday: number;
  readonly start_time: string;
  readonly end_time: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

interface ExistingScheduleRow {
  readonly weekday: number;
  readonly start_time: string;
  readonly end_time: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

interface ExistingEnrollmentRow {
  readonly student_id: string;
  readonly class_id: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly classes: {
    readonly id: string;
    readonly name: string;
    readonly courses: { readonly name: string } | null;
    readonly schedules: readonly ExistingScheduleRow[] | null;
  } | null;
}

type ClassLookup = {
  in(column: string, values: string[]): ClassLookup;
  maybeSingle(): PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>;
};

/**
 * 查一個班，**範圍外查不到 → 跟不存在一樣**（#2443）。直接報名的前置檢查與 copy-from-class 的
 * 來源／目標班共用。轉成結構型別再套 `applyCampusFilter`：直接套 supabase builder 會 TS2589。
 */
export function findClassInScope(
  supabase: SupabaseClient,
  orgId: string,
  classId: string,
  scope: CampusScope,
) {
  return applyCampusFilter(
    supabase
      .from('classes')
      .select('id')
      .eq('id', classId)
      .eq('org_id', orgId) as unknown as ClassLookup,
    'campus_id',
    scope,
  ).maybeSingle();
}

/**
 * 查一筆報名，**班在範圍外 → 跟不存在一樣**（#2493 W1）。改、改狀態、刪都先過這裡 ——
 * 原本三支只看 org，受限管理員改得到別校報名的議價、退得掉別校學生、刪得掉別校報名。
 */
export function findEnrollmentInScope(
  supabase: SupabaseClient,
  orgId: string,
  enrollmentId: string,
  scope: CampusScope,
) {
  return applyCampusFilter(
    supabase
      .from('enrollments')
      .select('id, classes!inner(campus_id)')
      .eq('id', enrollmentId)
      .eq('org_id', orgId) as unknown as ClassLookup,
    'classes.campus_id',
    scope,
  ).maybeSingle();
}

export async function checkEnrollmentPreconditions(
  input: EnrollmentPreconditionInput,
): Promise<EnrollmentPreconditionResult> {
  const { supabase, orgId, classId, studentIds, effectiveFrom, effectiveTo, scope } = input;
  const uniqueStudentIds = Array.from(new Set(studentIds));

  if (uniqueStudentIds.length === 0) {
    return { error: null, conflicts: [] };
  }

  const { data: cls, error: classError } = await findClassInScope(supabase, orgId, classId, scope);

  if (classError) {
    return {
      error: { code: 'SERVER_ERROR', message: classError.message },
      conflicts: [],
    };
  }

  if (!cls) {
    return {
      error: { code: 'CLASS_NOT_FOUND', message: '班級不存在' },
      conflicts: [],
    };
  }

  // 名額不在這裡判斷：要跟寫入同一個交易、鎖住班級才算數，見 `lib/class-seats.ts`（#1726 Q9）

  const { data: targetSchedules, error: targetSchedulesError } = await supabase
    .from('schedules')
    .select('weekday, start_time, end_time, effective_from, effective_to')
    .eq('class_id', classId);

  if (targetSchedulesError) {
    return {
      error: { code: 'SERVER_ERROR', message: targetSchedulesError.message },
      conflicts: [],
    };
  }

  if (!targetSchedules || targetSchedules.length === 0) {
    return { error: null, conflicts: [] };
  }

  const { data: existingEnrollments, error: existingEnrollmentsError } = await supabase
    .from('enrollments')
    .select(
      `
      student_id,
      class_id,
      effective_from,
      effective_to,
      classes!inner(
        id,
        name,
        courses(name),
        schedules(weekday, start_time, end_time, effective_from, effective_to)
      )
    `,
    )
    .eq('org_id', orgId)
    .in('status', ['active', 'pending_payment'])
    .in('student_id', uniqueStudentIds)
    .neq('class_id', classId);

  if (existingEnrollmentsError) {
    return {
      error: { code: 'SERVER_ERROR', message: existingEnrollmentsError.message },
      conflicts: [],
    };
  }

  const newEffectiveTo = effectiveTo ?? '9999-12-31';
  const conflicts: StudentScheduleConflict[] = [];
  const conflictKeys = new Set<string>();

  for (const enrollment of (existingEnrollments ?? []) as unknown as ExistingEnrollmentRow[]) {
    const existingEffectiveTo = enrollment.effective_to ?? '9999-12-31';
    if (newEffectiveTo < enrollment.effective_from || existingEffectiveTo < effectiveFrom) {
      continue;
    }

    const existingClass = enrollment.classes;
    if (!existingClass?.schedules?.length) {
      continue;
    }

    // 兩筆報名同時在籍的那段期間；兩個時段都要在這段期間裡、而且彼此的生效期間有交集才算撞（#1100 #22：
    // 原本只看 effective_to，下個月才生效的新時段、已經換掉的舊時段都會被當成現在的課）
    const windowFrom = maxDate(effectiveFrom, enrollment.effective_from);
    const windowTo = minDate(effectiveTo, enrollment.effective_to);

    for (const existingSchedule of existingClass.schedules) {
      const existingRange = scheduleRangeOf(existingSchedule as unknown as Record<string, unknown>);
      if (!scheduleOverlaps(existingRange, windowFrom, windowTo)) continue;

      for (const targetSchedule of targetSchedules as TargetScheduleRow[]) {
        const targetRange = scheduleRangeOf(targetSchedule as unknown as Record<string, unknown>);
        // 目標時段 ∩ 同時在籍期間，再跟既有時段比
        const from = maxDate(windowFrom, targetRange.effectiveFrom);
        const to = minDate(windowTo, targetRange.effectiveTo);
        if (to !== null && from > to) continue;
        if (!scheduleOverlaps(existingRange, from, to)) continue;

        if (existingSchedule.weekday !== targetSchedule.weekday) {
          continue;
        }

        if (
          toHM(existingSchedule.start_time) < toHM(targetSchedule.end_time) &&
          toHM(targetSchedule.start_time) < toHM(existingSchedule.end_time)
        ) {
          const key = [
            enrollment.student_id,
            existingClass.id,
            existingSchedule.weekday,
            existingSchedule.start_time,
            existingSchedule.end_time,
          ].join('|');

          if (!conflictKeys.has(key)) {
            conflictKeys.add(key);
            conflicts.push({
              studentId: enrollment.student_id,
              conflictingClassId: existingClass.id,
              conflictingClassName: existingClass.name,
              conflictingCourseName: existingClass.courses?.name ?? '',
              weekday: existingSchedule.weekday,
              startTime: existingSchedule.start_time,
              endTime: existingSchedule.end_time,
            });
          }
        }
      }
    }
  }

  return { error: null, conflicts };
}

function toHM(value: string): string {
  return value.slice(0, 5);
}

// ── 刪除報名前的出勤守門 ────────────────────────────────────────────────────────────────

export type EnrollmentAttendanceCheck =
  | { readonly status: 'none' }
  | { readonly status: 'has-attendance' }
  | { readonly status: 'check-failed'; readonly message: string };

export interface EnrollmentAttendanceCheckInput {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  readonly classId: string;
  readonly studentId: string;
}

/**
 * 這筆報名底下是否已經有出勤紀錄。
 *
 * `attendance_records` 掛在 `(event_id, student_id)` 上，**沒有 `enrollment_id`**，所以要走
 * enrollment → 該班的 sessions → 它們的 `event_id` → 配上 student 去查。
 *
 * 這是資料完整性的守門查詢，任何一段查不到答案都回 `check-failed` 讓呼叫端 **fail closed**。
 * 舊版把錯誤吞掉、用 `count ?? 0` 當 0，於是守門從來沒有生效過。
 */
export async function checkEnrollmentAttendance({
  supabase,
  orgId,
  classId,
  studentId,
}: EnrollmentAttendanceCheckInput): Promise<EnrollmentAttendanceCheck> {
  const { data: sessionRows, error: sessionsError } = await supabase
    .from('sessions')
    .select('event_id')
    .eq('org_id', orgId)
    .eq('class_id', classId);

  if (sessionsError) {
    return { status: 'check-failed', message: sessionsError.message };
  }

  // 在 JS 過濾 null，而不是用 .not('event_id', 'is', null)：存量 session 允許沒有 event，
  // 而且一個班的 session 量有限。ponytail: 真的爆量再改成 RPC/view。
  const eventIds = (sessionRows ?? [])
    .map((row) => (row as { event_id: string | null }).event_id)
    .filter((eventId): eventId is string => Boolean(eventId));

  if (eventIds.length === 0) {
    return { status: 'none' };
  }

  const { count, error: attendanceError } = await supabase
    .from('attendance_records')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('student_id', studentId)
    .in('event_id', eventIds);

  if (attendanceError) {
    return { status: 'check-failed', message: attendanceError.message };
  }

  return (count ?? 0) > 0 ? { status: 'has-attendance' } : { status: 'none' };
}

const maxDate = (a: string, b: string): string => (a > b ? a : b);
/** null＝不限終點 */
const minDate = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a < b ? a : b;
