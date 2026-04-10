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

  for (const enrollment of ((existingEnrollments ?? []) as unknown as ExistingEnrollmentRow[])) {
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
