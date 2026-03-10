export type SessionAssignmentStatus = 'assigned' | 'unassigned';

export interface SessionGenerationSchedule {
  readonly id: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly teacherId: string | null;
  readonly teacherName?: string;
  readonly effectiveTo: string | null;
}

export type SessionPreviewSkipReason = 'exists' | 'no_teacher' | null;

export interface SessionGenerationPreviewItem {
  readonly sessionDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly teacherId: string | null;
  readonly teacherName?: string;
  readonly weekday: number;
  readonly exists: boolean;
  readonly canCreate: boolean;
  readonly willBeUnassigned: boolean;
  readonly skipReason: SessionPreviewSkipReason;
}

export interface SessionGenerationSummary {
  readonly createdAssigned: number;
  readonly createdUnassigned: number;
  readonly skippedExisting: number;
  readonly skippedNoTeacher: number;
  readonly totalPlanned: number;
}

export interface SessionGenerationInsertRow {
  readonly org_id: string;
  readonly class_id: string;
  readonly schedule_id: string;
  readonly session_date: string;
  readonly start_time: string;
  readonly end_time: string;
  readonly teacher_id: string | null;
  readonly status: 'scheduled';
  readonly assignment_status: SessionAssignmentStatus;
}

export interface SessionGenerationPlanInput {
  readonly orgId: string;
  readonly classId: string;
  readonly from: string;
  readonly to: string;
  readonly includeUnassigned: boolean;
  readonly schedules: readonly SessionGenerationSchedule[];
  readonly existingKeys: ReadonlySet<string>;
  readonly excludeDates: ReadonlySet<string>;
}

export interface SessionGenerationPlanOutput {
  readonly preview: SessionGenerationPreviewItem[];
  readonly toInsert: SessionGenerationInsertRow[];
  readonly summary: SessionGenerationSummary;
}

export type BatchAssignMode = 'skip-conflicts' | 'strict' | 'force';

export interface BatchAssignTargetSession {
  readonly id: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: 'scheduled' | 'completed' | 'cancelled';
  readonly assignmentStatus: SessionAssignmentStatus;
}

export interface BatchAssignBusySlot {
  readonly sessionId: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly endTime: string;
}

export interface BatchAssignConflict {
  readonly sessionId: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly conflictWithSessionId: string;
}

export interface BatchAssignPlanInput {
  readonly mode: BatchAssignMode;
  readonly includeAssigned: boolean;
  readonly targetSessions: readonly BatchAssignTargetSession[];
  readonly teacherBusySlots: readonly BatchAssignBusySlot[];
}

export interface BatchAssignPlanOutput {
  readonly updatedIds: string[];
  readonly skippedConflicts: number;
  readonly skippedNotEligible: number;
  readonly conflicts: BatchAssignConflict[];
}
