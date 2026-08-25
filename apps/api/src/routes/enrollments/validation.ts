import type { SupabaseClient } from '@supabase/supabase-js';

export interface EnrollmentPreconditionInput {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  readonly classId: string;
  readonly studentIds: readonly string[];
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export type EnrollmentPreconditionError =
  | { code: 'CLASS_NOT_FOUND'; message: string }
  | {
      code: 'OVER_QUOTA';
      message: string;
      quota: number;
      currentActive: number;
      adding: number;
    }
  | { code: 'SERVER_ERROR'; message: string };

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
  readonly effective_to: string | null;
}

interface ExistingScheduleRow {
  readonly weekday: number;
  readonly start_time: string;
  readonly end_time: string;
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

export async function checkEnrollmentPreconditions(
  input: EnrollmentPreconditionInput,
): Promise<EnrollmentPreconditionResult> {
  const { supabase, orgId, classId, studentIds, effectiveFrom, effectiveTo } = input;
  const uniqueStudentIds = Array.from(new Set(studentIds));

  if (uniqueStudentIds.length === 0) {
    return { error: null, conflicts: [] };
  }

  const { data: cls, error: classError } = await supabase
    .from('classes')
    .select('id, max_students')
    .eq('id', classId)
    .eq('org_id', orgId)
    .maybeSingle();

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

  const { count: currentActive, error: countError } = await supabase
    .from('enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('class_id', classId)
    .eq('org_id', orgId)
    .in('status', ['active', 'pending_payment']);

  if (countError) {
    return {
      error: { code: 'SERVER_ERROR', message: countError.message },
      conflicts: [],
    };
  }

  const { count: alreadyIn, error: alreadyInError } = await supabase
    .from('enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('class_id', classId)
    .eq('org_id', orgId)
    .in('status', ['active', 'pending_payment'])
    .in('student_id', uniqueStudentIds);

  if (alreadyInError) {
    return {
      error: { code: 'SERVER_ERROR', message: alreadyInError.message },
      conflicts: [],
    };
  }

  const projectedAdd = uniqueStudentIds.length - (alreadyIn ?? 0);
  const quota = cls.max_students ?? Number.MAX_SAFE_INTEGER;

  if ((currentActive ?? 0) + projectedAdd > quota) {
    return {
      error: {
        code: 'OVER_QUOTA',
        message: '班級人數已達上限',
        quota: cls.max_students ?? 0,
        currentActive: currentActive ?? 0,
        adding: projectedAdd,
      },
      conflicts: [],
    };
  }

  const { data: targetSchedules, error: targetSchedulesError } = await supabase
    .from('schedules')
    .select('weekday, start_time, end_time, effective_to')
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
        schedules(weekday, start_time, end_time, effective_to)
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

    for (const existingSchedule of existingClass.schedules) {
      if (existingSchedule.effective_to && existingSchedule.effective_to < effectiveFrom) {
        continue;
      }

      for (const targetSchedule of targetSchedules as TargetScheduleRow[]) {
        if (targetSchedule.effective_to && targetSchedule.effective_to < effectiveFrom) {
          continue;
        }

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
