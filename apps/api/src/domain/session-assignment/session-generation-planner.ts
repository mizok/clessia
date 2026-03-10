import {
  type SessionGenerationPlanInput,
  type SessionGenerationPlanOutput,
  type SessionGenerationPreviewItem,
} from './session-assignment.types';
import { deriveAssignmentStatus, validateAssignmentState } from './session-assignment.rules';
import { normalizeTime, toWeekdayFromDate } from './time-utils';

function toUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function buildSessionGenerationPlan(
  input: SessionGenerationPlanInput,
): SessionGenerationPlanOutput {
  const from = toUtcDate(input.from);
  const to = toUtcDate(input.to);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return {
      preview: [],
      toInsert: [],
      summary: {
        createdAssigned: 0,
        createdUnassigned: 0,
        skippedExisting: 0,
        skippedNoTeacher: 0,
        totalPlanned: 0,
      },
    };
  }

  const preview: SessionGenerationPreviewItem[] = [];
  const toInsert: SessionGenerationPlanOutput['toInsert'] = [];

  let createdAssigned = 0;
  let createdUnassigned = 0;
  let skippedExisting = 0;
  let skippedNoTeacher = 0;

  const cursor = new Date(from);
  while (cursor <= to) {
    const sessionDate = toDateKey(cursor);
    const weekday = toWeekdayFromDate(cursor);

    if (input.excludeDates.has(sessionDate)) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      continue;
    }

    for (const schedule of input.schedules) {
      if (schedule.weekday !== weekday) continue;
      if (schedule.effectiveTo && sessionDate > schedule.effectiveTo) continue;

      const startTime = normalizeTime(schedule.startTime);
      const endTime = normalizeTime(schedule.endTime);
      const exists = input.existingKeys.has(`${sessionDate}|${startTime}`);
      const canCreate = !exists && (Boolean(schedule.teacherId) || input.includeUnassigned);
      const willBeUnassigned = canCreate && !schedule.teacherId;
      const skipReason = exists
        ? 'exists'
        : !schedule.teacherId && !input.includeUnassigned
          ? 'no_teacher'
          : null;

      preview.push({
        sessionDate,
        startTime,
        endTime,
        teacherId: schedule.teacherId,
        teacherName: schedule.teacherName,
        weekday,
        exists,
        canCreate,
        willBeUnassigned,
        skipReason,
      });

      if (exists) {
        skippedExisting += 1;
        continue;
      }

      if (!schedule.teacherId && !input.includeUnassigned) {
        skippedNoTeacher += 1;
        continue;
      }

      const assignmentStatus = deriveAssignmentStatus(schedule.teacherId);
      validateAssignmentState({ assignmentStatus, teacherId: schedule.teacherId });

      if (assignmentStatus === 'unassigned') {
        createdUnassigned += 1;
      } else {
        createdAssigned += 1;
      }

      toInsert.push({
        org_id: input.orgId,
        class_id: input.classId,
        schedule_id: schedule.id,
        session_date: sessionDate,
        start_time: startTime,
        end_time: endTime,
        teacher_id: schedule.teacherId,
        status: 'scheduled',
        assignment_status: assignmentStatus,
      });
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  preview.sort(
    (a, b) => a.sessionDate.localeCompare(b.sessionDate) || a.startTime.localeCompare(b.startTime),
  );

  return {
    preview,
    toInsert,
    summary: {
      createdAssigned,
      createdUnassigned,
      skippedExisting,
      skippedNoTeacher,
      totalPlanned: preview.length,
    },
  };
}
