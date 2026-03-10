import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import {
  assertSessionOperable,
  SessionCancelledError,
  SessionCompletedError,
  SessionUnassignedError,
} from '../domain/session-assignment/session-operation-guard';
import { planBatchUpdateTime } from '../domain/session-assignment/batch-update-time-planner';

// ============================================================
// Schemas
// ============================================================

const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ description: '日期（YYYY-MM-DD）', example: '2026-02-24' });

const TimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .openapi({ description: '時間（HH:mm）', example: '14:30' });

const SessionStatusSchema = z
  .enum(['scheduled', 'completed', 'cancelled'])
  .openapi('SessionStatus');

const SessionAssignmentStatusSchema = z
  .enum(['assigned', 'unassigned'])
  .openapi('SessionAssignmentStatus');

const SessionChangeTypeSchema = z
  .enum(['reschedule', 'substitute', 'cancellation', 'uncancel'])
  .openapi('SessionChangeType');

const SessionListQuerySchema = z
  .object({
    from: DateSchema.optional(),
    to: DateSchema.optional(),
    campusId: z.uuid().optional().openapi({ description: '分校 ID（單一，舊版）' }),
    campusIds: z.string().optional().openapi({ description: '分校 ID（逗號分隔，多選）' }),
    courseId: z.uuid().optional().openapi({ description: '課程 ID（單一，舊版）' }),
    courseIds: z.string().optional().openapi({ description: '課程 ID（逗號分隔，多選）' }),
    teacherId: z.uuid().optional().openapi({ description: '教師 ID（單一）' }),
    teacherIds: z.string().optional().openapi({ description: '教師 ID（逗號分隔，多選）' }),
    classId: z.uuid().optional().openapi({ description: '班級 ID' }),
    page: z.coerce.number().optional().openapi({ description: '頁碼' }),
    pageSize: z.coerce.number().optional().openapi({ description: '每頁筆數' }),
  })
  .openapi('SessionListQuery');

const SessionIdParamsSchema = z
  .object({
    id: z.uuid().openapi({ description: '課堂 ID' }),
  })
  .openapi('SessionIdParams');

const SessionListItemSchema = z
  .object({
    id: z.uuid(),
    sessionDate: DateSchema,
    startTime: TimeSchema,
    endTime: TimeSchema,
    status: SessionStatusSchema,
    classId: z.uuid(),
    className: z.string(),
    courseId: z.uuid(),
    courseName: z.string(),
    campusId: z.uuid(),
    campusName: z.string(),
    teacherId: z.uuid().nullable(),
    teacherName: z.string().nullable(),
    assignmentStatus: SessionAssignmentStatusSchema,
    hasChanges: z.boolean(),
  })
  .openapi('SessionListItem');

const SessionListResponseSchema = z
  .object({
    data: z.array(SessionListItemSchema),
  })
  .openapi('SessionListResponse');

const SessionChangeItemSchema = z
  .object({
    id: z.uuid(),
    changeType: SessionChangeTypeSchema,
    originalSessionDate: DateSchema.nullable(),
    originalStartTime: TimeSchema.nullable(),
    originalEndTime: TimeSchema.nullable(),
    newSessionDate: DateSchema.nullable(),
    newStartTime: TimeSchema.nullable(),
    newEndTime: TimeSchema.nullable(),
    originalTeacherId: z.uuid().nullable(),
    originalTeacherName: z.string().nullable(),
    substituteTeacherId: z.uuid().nullable(),
    substituteTeacherName: z.string().nullable(),
    operationSource: z.enum(['single', 'batch']),
    reason: z.string().nullable(),
    createdByName: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('SessionChangeItem');

const SessionChangesResponseSchema = z
  .object({
    data: z.array(SessionChangeItemSchema),
  })
  .openapi('SessionChangesResponse');

const CancelSessionBodySchema = z
  .object({
    reason: z.string().max(500).optional().openapi({ description: '停課原因' }),
  })
  .openapi('CancelSessionBody');

const SubstituteSessionBodySchema = z
  .object({
    substituteTeacherId: z.uuid().openapi({ description: '代課老師 ID' }),
    reason: z.string().max(500).optional().openapi({ description: '代課原因' }),
  })
  .openapi('SubstituteSessionBody');

const RescheduleSessionBodySchema = z
  .object({
    newSessionDate: DateSchema,
    newStartTime: TimeSchema,
    newEndTime: TimeSchema,
    reason: z.string().max(500).optional().openapi({ description: '調課原因' }),
  })
  .openapi('RescheduleSessionBody');

const BatchSessionTargetSchema = z
  .object({
    sessionIds: z.array(z.uuid()).min(1).max(1000),
    dryRun: z.boolean().optional(),
  })
  .openapi('BatchSessionTarget');

const BatchAssignTeacherBodySchema = z
  .object({
    sessionIds: z.array(z.uuid()).min(1).max(1000),
    teacherId: z.uuid(),
    includeAssigned: z.boolean().default(false),
    dryRun: z.boolean().default(false),
  })
  .openapi('SessionBatchAssignTeacherBody');

const BatchAssignConflictSchema = z
  .object({
    sessionId: z.uuid(),
    sessionDate: DateSchema,
    startTime: TimeSchema,
    endTime: TimeSchema,
    conflictWithSessionId: z.uuid(),
  })
  .openapi('SessionBatchAssignConflict');

const BatchAssignTeacherResultSchema = z
  .object({
    updated: z.number(),
    skippedConflicts: z.number(),
    skippedNotEligible: z.number(),
    conflicts: z.array(BatchAssignConflictSchema),
    dryRun: z.boolean(),
  })
  .openapi('SessionBatchAssignTeacherResult');

const BatchUpdateTimeBodySchema = BatchSessionTargetSchema.extend({
  startTime: TimeSchema,
  endTime: TimeSchema,
}).openapi('SessionBatchUpdateTimeBody');

const BatchCancelBodySchema = BatchSessionTargetSchema.extend({
  reason: z.string().max(500).optional(),
}).openapi('SessionBatchCancelBody');

const BatchUncancelBodySchema = BatchSessionTargetSchema.openapi('SessionBatchUncancelBody');

const BatchSessionConflictSchema = z
  .object({
    sessionId: z.uuid(),
    sessionDate: DateSchema,
    reason: z.enum([
      'status_not_editable',
      'status_not_cancellable',
      'status_not_reopenable',
      'class_conflict',
      'teacher_conflict',
    ]),
    detail: z.string(),
    conflictingSessionId: z.uuid().optional(),
  })
  .openapi('SessionBatchConflict');

const BatchSessionActionResultSchema = z
  .object({
    updated: z.number(),
    skipped: z.number(),
    processableIds: z.array(z.uuid()),
    conflicts: z.array(BatchSessionConflictSchema),
    dryRun: z.boolean(),
  })
  .openapi('SessionBatchActionResult');

const SuccessResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .openapi('SessionSuccessResponse');

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi('SessionError');

// ============================================================
// Helpers
// ============================================================

function toHHmm(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 5);
}

function normalizeTime(value: string): string {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function toMinutes(value: string): number {
  const [h = '0', m = '0'] = normalizeTime(value).split(':');
  return Number(h) * 60 + Number(m);
}

function isTimeOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA);
}

type BatchSessionConflictReason =
  | 'status_not_editable'
  | 'status_not_cancellable'
  | 'status_not_reopenable'
  | 'class_conflict'
  | 'teacher_conflict';

interface BatchSessionConflictItem {
  readonly sessionId: string;
  readonly sessionDate: string;
  readonly reason: BatchSessionConflictReason;
  readonly detail: string;
  readonly conflictingSessionId?: string;
}

interface SessionOperationState {
  readonly assignmentStatus: 'assigned' | 'unassigned';
  readonly status: 'scheduled' | 'completed' | 'cancelled';
  readonly classId: string;
  readonly sessionDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly teacherId: string | null;
  readonly teacherName: string | null;
}

interface SingleSessionChangeInsertInput {
  readonly orgId: string;
  readonly sessionId: string;
  readonly changeType: 'cancellation' | 'substitute' | 'reschedule' | 'uncancel';
  readonly sessionState: SessionOperationState;
  readonly createdByName: string | null;
  readonly reason?: string | null;
  readonly substituteTeacherId?: string | null;
  readonly newSessionDate?: string | null;
  readonly newStartTime?: string | null;
  readonly newEndTime?: string | null;
}

function mapSession(row: Record<string, unknown>, hasChanges: boolean) {
  const classRow = row['classes'] as Record<string, unknown> | null;
  const courseRow = classRow?.['courses'] as Record<string, unknown> | null;
  const campusRow = classRow?.['campuses'] as Record<string, unknown> | null;
  const teacherRow = row['staff'] as Record<string, unknown> | null;

  return {
    id: row['id'] as string,
    sessionDate: row['session_date'] as string,
    startTime: toHHmm(row['start_time'] as string | null) ?? '',
    endTime: toHHmm(row['end_time'] as string | null) ?? '',
    status: row['status'] as 'scheduled' | 'completed' | 'cancelled',
    classId: row['class_id'] as string,
    className: (classRow?.['name'] as string | undefined) ?? '',
    courseId: (courseRow?.['id'] as string | undefined) ?? '',
    courseName: (courseRow?.['name'] as string | undefined) ?? '',
    campusId: (campusRow?.['id'] as string | undefined) ?? '',
    campusName: (campusRow?.['name'] as string | undefined) ?? '',
    teacherId: (row['teacher_id'] as string | null) ?? null,
    teacherName: (teacherRow?.['display_name'] as string | undefined) ?? null,
    assignmentStatus: (row['assignment_status'] as 'assigned' | 'unassigned' | null) ?? 'assigned',
    hasChanges,
  };
}

export const SESSION_CHANGES_SELECT = `
      id, change_type,
      original_session_date, original_start_time, original_end_time,
      new_session_date, new_start_time, new_end_time,
      original_teacher_id, original_teacher_name,
      operation_source,
      reason, created_by_name, created_at,
      staff!substitute_teacher_id ( id, display_name )
    `;

export function mapSessionChange(row: Record<string, unknown>) {
  const substituteRaw = row['staff'] as Record<string, unknown> | Record<string, unknown>[] | null;
  const substituteTeacher = Array.isArray(substituteRaw)
    ? (substituteRaw[0] as Record<string, unknown> | undefined)
    : substituteRaw;

  return {
    id: row['id'] as string,
    changeType: row['change_type'] as 'reschedule' | 'substitute' | 'cancellation' | 'uncancel',
    originalSessionDate: (row['original_session_date'] as string | null) ?? null,
    originalStartTime: toHHmm(row['original_start_time'] as string | null),
    originalEndTime: toHHmm(row['original_end_time'] as string | null),
    newSessionDate: (row['new_session_date'] as string | null) ?? null,
    newStartTime: toHHmm(row['new_start_time'] as string | null),
    newEndTime: toHHmm(row['new_end_time'] as string | null),
    originalTeacherId: (row['original_teacher_id'] as string | null) ?? null,
    originalTeacherName: (row['original_teacher_name'] as string | null) ?? null,
    substituteTeacherId: (substituteTeacher?.['id'] as string | undefined) ?? null,
    substituteTeacherName: (substituteTeacher?.['display_name'] as string | undefined) ?? null,
    operationSource: ((row['operation_source'] as 'single' | 'batch' | null) ?? 'single') as
      | 'single'
      | 'batch',
    reason: (row['reason'] as string | null) ?? null,
    createdByName: (row['created_by_name'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
  };
}

async function loadSessionOperationState(
  supabase: AppEnv['Variables']['supabase'],
  orgId: string,
  id: string,
): Promise<SessionOperationState | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select(
      'status, assignment_status, teacher_id, class_id, session_date, start_time, end_time, teacher:staff!teacher_id(display_name)',
    )
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;

  const teacherRow = data.teacher as Record<string, unknown> | null;

  const assignmentStatus =
    (data.assignment_status as 'assigned' | 'unassigned' | null) ??
    ((data.teacher_id as string | null) ? 'assigned' : 'unassigned');

  return {
    assignmentStatus,
    status: data.status as 'scheduled' | 'completed' | 'cancelled',
    classId: data.class_id as string,
    sessionDate: data.session_date as string,
    startTime: data.start_time as string,
    endTime: data.end_time as string,
    teacherId: (data.teacher_id as string | null) ?? null,
    teacherName: (teacherRow?.['display_name'] as string | null | undefined) ?? null,
  };
}

export function buildSingleSessionChangeInsert(input: SingleSessionChangeInsertInput) {
  return {
    org_id: input.orgId,
    session_id: input.sessionId,
    change_type: input.changeType,
    original_session_date: input.changeType === 'reschedule' ? input.sessionState.sessionDate : null,
    original_start_time: input.changeType === 'reschedule' ? input.sessionState.startTime : null,
    original_end_time: input.changeType === 'reschedule' ? input.sessionState.endTime : null,
    new_session_date: input.changeType === 'reschedule' ? (input.newSessionDate ?? null) : null,
    new_start_time: input.changeType === 'reschedule' ? (input.newStartTime ?? null) : null,
    new_end_time: input.changeType === 'reschedule' ? (input.newEndTime ?? null) : null,
    original_teacher_id:
      input.changeType === 'substitute' ? (input.sessionState.teacherId ?? null) : null,
    original_teacher_name:
      input.changeType === 'substitute' ? (input.sessionState.teacherName ?? null) : null,
    substitute_teacher_id:
      input.changeType === 'substitute' ? (input.substituteTeacherId ?? null) : null,
    reason: input.reason ?? null,
    created_by_name: input.createdByName,
    operation_source: 'single' as const,
  };
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Sessions'],
  summary: '查詢課堂列表',
  request: {
    query: SessionListQuerySchema,
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: SessionListResponseSchema,
        },
      },
    },
    400: {
      description: '查詢失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(listSessionsRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { from, to, campusId, campusIds, courseId, courseIds, teacherId, teacherIds, classId, page, pageSize } = c.req.valid('query');

  let dbQuery = supabase
    .from('sessions')
    .select(
      `
      id, session_date, start_time, end_time, status, assignment_status,
      class_id, teacher_id,
      classes!inner (
        name,
        courses!inner ( id, name ),
        campuses!inner ( id, name )
      ),
      staff ( display_name )
    `,
    )
    .eq('org_id', orgId)
    .order('session_date')
    .order('start_time');

  if (from) {
    dbQuery = dbQuery.gte('session_date', from);
  }
  if (to) {
    dbQuery = dbQuery.lte('session_date', to);
  }

  if (campusIds) {
    const ids = campusIds.split(',').filter(Boolean);
    if (ids.length > 0) dbQuery = dbQuery.in('classes.campus_id', ids);
  } else if (campusId) {
    dbQuery = dbQuery.eq('classes.campus_id', campusId);
  }
  if (courseIds) {
    const ids = courseIds.split(',').filter(Boolean);
    if (ids.length > 0) dbQuery = dbQuery.in('classes.course_id', ids);
  } else if (courseId) {
    dbQuery = dbQuery.eq('classes.course_id', courseId);
  }
  if (teacherIds) {
    const ids = teacherIds.split(',').filter(Boolean);
    if (ids.length > 0) {
      dbQuery = dbQuery.in('teacher_id', ids);
    }
  } else if (teacherId) {
    dbQuery = dbQuery.eq('teacher_id', teacherId);
  }
  if (classId) {
    dbQuery = dbQuery.eq('class_id', classId);
  }

  // Pagination
  if (page && pageSize) {
    const fromOffset = (page - 1) * pageSize;
    const toOffset = fromOffset + pageSize - 1;
    dbQuery = dbQuery.range(fromOffset, toOffset);
  } else if (pageSize) {
    dbQuery = dbQuery.limit(pageSize);
  }

  const { data, error } = await dbQuery;
  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const sessionIds = rows.map((row) => row['id'] as string);

  const changedIds = new Set<string>();
  if (sessionIds.length > 0) {
    const { data: changes, error: changesError } = await supabase
      .from('schedule_changes')
      .select('session_id')
      .in('session_id', sessionIds);

    if (changesError) {
      return c.json({ error: changesError.message, code: 'DB_ERROR' }, 400);
    }

    for (const change of changes ?? []) {
      changedIds.add(change.session_id as string);
    }
  }

  return c.json(
    {
      data: rows.map((row) => mapSession(row, changedIds.has(row['id'] as string))),
    },
    200,
  );
});

const getSessionChangesRoute = createRoute({
  method: 'get',
  path: '/{id}/changes',
  tags: ['Sessions'],
  summary: '查詢單一課堂異動紀錄',
  request: {
    params: SessionIdParamsSchema,
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: SessionChangesResponseSchema,
        },
      },
    },
    400: {
      description: '查詢失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(getSessionChangesRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');

  const { data, error } = await supabase
    .from('schedule_changes')
    .select(SESSION_CHANGES_SELECT)
    .eq('org_id', orgId)
    .eq('session_id', id)
    .order('created_at', { ascending: false });

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  return c.json(
    {
      data: (data ?? []).map((row) => mapSessionChange(row as Record<string, unknown>)),
    },
    200,
  );
});

const cancelSessionRoute = createRoute({
  method: 'post',
  path: '/{id}/cancel',
  tags: ['Sessions'],
  summary: '停課',
  request: {
    params: SessionIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: CancelSessionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
    },
    404: {
      description: '課堂不存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: '課堂狀態不可停課',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    400: {
      description: '操作失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(cancelSessionRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const sessionState = await loadSessionOperationState(supabase, orgId, id);
  if (!sessionState) {
    return c.json({ error: '課堂不存在', code: 'NOT_FOUND' }, 404);
  }
  if (sessionState.status !== 'scheduled') {
    return c.json({ error: '僅可停課狀態為「scheduled」的課堂', code: 'STATUS_NOT_CANCELLABLE' }, 409);
  }

  const { data: updatedSession, error: updateError } = await supabase
    .from('sessions')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id')
    .maybeSingle();

  if (updateError) {
    return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
  }
  if (!updatedSession) {
    return c.json({ error: '課堂不存在', code: 'NOT_FOUND' }, 404);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    return c.json({ error: profileError.message, code: 'DB_ERROR' }, 400);
  }

  const { error: insertError } = await supabase.from('schedule_changes').insert(
    buildSingleSessionChangeInsert({
      orgId,
      sessionId: id,
      changeType: 'cancellation',
      sessionState,
      createdByName: profile?.display_name ?? null,
      reason: body.reason ?? null,
    }),
  );

  if (insertError) {
    return c.json({ error: insertError.message, code: 'DB_ERROR' }, 400);
  }

  return c.json({ success: true }, 200);
});

const substituteSessionRoute = createRoute({
  method: 'post',
  path: '/{id}/substitute',
  tags: ['Sessions'],
  summary: '代課',
  request: {
    params: SessionIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: SubstituteSessionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
    },
    400: {
      description: '操作失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '課堂不存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: '課堂未指派老師',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(substituteSessionRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const sessionState = await loadSessionOperationState(supabase, orgId, id);
  if (!sessionState) {
    return c.json({ error: '課堂不存在', code: 'NOT_FOUND' }, 404);
  }
  try {
    assertSessionOperable(sessionState);
  } catch (error) {
    if (error instanceof SessionUnassignedError) {
      return c.json({ error: error.message, code: error.code }, 409);
    }
    if (error instanceof SessionCancelledError || error instanceof SessionCompletedError) {
      return c.json({ error: error.message, code: error.code }, 409);
    }
    throw error;
  }

  if (sessionState.teacherId === body.substituteTeacherId) {
    return c.json({ error: '代課老師不可與原老師相同', code: 'INVALID_SUBSTITUTE_TEACHER' }, 400);
  }

  const [
    { data: classRow, error: classRowError },
    { data: teacherSubjectRows, error: teacherSubjectRowsError },
    { data: teacherCampusRows, error: teacherCampusRowsError },
    { data: teacherRow, error: teacherRowError },
  ] = await Promise.all([
    supabase
      .from('classes')
      .select('course_id, campus_id')
      .eq('org_id', orgId)
      .eq('id', sessionState.classId)
      .maybeSingle(),
    supabase
      .from('staff_subjects')
      .select('subject_id')
      .eq('staff_id', body.substituteTeacherId),
    supabase
      .from('staff_campuses')
      .select('campus_id')
      .eq('staff_id', body.substituteTeacherId),
    supabase
      .from('staff')
      .select('id, user_id, is_active')
      .eq('org_id', orgId)
      .eq('id', body.substituteTeacherId)
      .maybeSingle(),
  ]);

  if (classRowError) {
    return c.json({ error: classRowError.message, code: 'DB_ERROR' }, 400);
  }
  if (teacherSubjectRowsError) {
    return c.json({ error: teacherSubjectRowsError.message, code: 'DB_ERROR' }, 400);
  }
  if (teacherCampusRowsError) {
    return c.json({ error: teacherCampusRowsError.message, code: 'DB_ERROR' }, 400);
  }
  if (teacherRowError) {
    return c.json({ error: teacherRowError.message, code: 'DB_ERROR' }, 400);
  }

  const classCourseId = classRow?.['course_id'] as string | undefined;
  const classCampusId = classRow?.['campus_id'] as string | undefined;
  if (!classCourseId || !classCampusId || !teacherRow) {
    return c.json({ error: '代課老師不符合課程科目或分校資格', code: 'TEACHER_NOT_ELIGIBLE' }, 409);
  }

  const substituteTeacherUserId = teacherRow['user_id'] as string | undefined;
  const substituteTeacherActive = (teacherRow['is_active'] as boolean | null) ?? false;
  if (!substituteTeacherUserId || !substituteTeacherActive) {
    return c.json({ error: '代課老師不符合課程科目或分校資格', code: 'TEACHER_NOT_ELIGIBLE' }, 409);
  }

  const { data: substituteTeacherRole, error: substituteTeacherRoleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', substituteTeacherUserId)
    .eq('role', 'teacher')
    .maybeSingle();

  if (substituteTeacherRoleError) {
    return c.json({ error: substituteTeacherRoleError.message, code: 'DB_ERROR' }, 400);
  }

  if (!substituteTeacherRole) {
    return c.json({ error: '代課老師不符合課程科目或分校資格', code: 'TEACHER_NOT_ELIGIBLE' }, 409);
  }

  const { data: courseRow, error: courseRowError } = await supabase
    .from('courses')
    .select('subject_id')
    .eq('org_id', orgId)
    .eq('id', classCourseId)
    .maybeSingle();

  if (courseRowError) {
    return c.json({ error: courseRowError.message, code: 'DB_ERROR' }, 400);
  }

  const courseSubjectId = courseRow?.['subject_id'] as string | undefined;
  if (!courseSubjectId) {
    return c.json({ error: '代課老師不符合課程科目或分校資格', code: 'TEACHER_NOT_ELIGIBLE' }, 409);
  }

  const teacherSubjectIds = new Set<string>();
  for (const row of teacherSubjectRows ?? []) {
    const subjectId = row['subject_id'] as string | undefined;
    if (subjectId) {
      teacherSubjectIds.add(subjectId);
    }
  }
  const teacherCampusIds = new Set<string>();
  for (const row of teacherCampusRows ?? []) {
    const campusId = row['campus_id'] as string | undefined;
    if (campusId) {
      teacherCampusIds.add(campusId);
    }
  }

  if (!teacherSubjectIds.has(courseSubjectId) || !teacherCampusIds.has(classCampusId)) {
    return c.json({ error: '代課老師不符合課程科目或分校資格', code: 'TEACHER_NOT_ELIGIBLE' }, 409);
  }

  const { data: teacherConflictRows, error: teacherConflictError } = await supabase
    .from('sessions')
    .select('id, start_time, end_time')
    .eq('org_id', orgId)
    .eq('teacher_id', body.substituteTeacherId)
    .eq('session_date', sessionState.sessionDate)
    .eq('status', 'scheduled')
    .neq('id', id);

  if (teacherConflictError) {
    return c.json({ error: teacherConflictError.message, code: 'DB_ERROR' }, 400);
  }

  const substituteStartTime = normalizeTime(sessionState.startTime);
  const substituteEndTime = normalizeTime(sessionState.endTime);
  const teacherConflict = (teacherConflictRows ?? []).find((peer) =>
    isTimeOverlap(
      substituteStartTime,
      substituteEndTime,
      normalizeTime(peer.start_time as string),
      normalizeTime(peer.end_time as string),
    ),
  );
  if (teacherConflict) {
    return c.json({ error: '老師於此時段已有其他課堂', code: 'TEACHER_CONFLICT' }, 409);
  }

  const { data: updatedSession, error: updateError } = await supabase
    .from('sessions')
    .update({
      teacher_id: body.substituteTeacherId,
      assignment_status: 'assigned',
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id')
    .maybeSingle();

  if (updateError) {
    return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
  }
  if (!updatedSession) {
    return c.json({ error: '更新失敗', code: 'UPDATE_FAILED' }, 400);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    return c.json({ error: profileError.message, code: 'DB_ERROR' }, 400);
  }

  const { error: insertError } = await supabase.from('schedule_changes').insert(
    buildSingleSessionChangeInsert({
      orgId,
      sessionId: id,
      changeType: 'substitute',
      sessionState,
      createdByName: profile?.display_name ?? null,
      reason: body.reason ?? null,
      substituteTeacherId: body.substituteTeacherId,
    }),
  );

  if (insertError) {
    return c.json({ error: insertError.message, code: 'DB_ERROR' }, 400);
  }

  return c.json({ success: true }, 200);
});

const rescheduleSessionRoute = createRoute({
  method: 'post',
  path: '/{id}/reschedule',
  tags: ['Sessions'],
  summary: '調課',
  request: {
    params: SessionIdParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: RescheduleSessionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
    },
    400: {
      description: '操作失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '課堂不存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: '課堂狀態不可調整或發生排程衝突',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(rescheduleSessionRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const sessionState = await loadSessionOperationState(supabase, orgId, id);
  if (!sessionState) {
    return c.json({ error: '課堂不存在', code: 'NOT_FOUND' }, 404);
  }

  if (sessionState.status !== 'scheduled') {
    return c.json({ error: '僅可調整狀態為「scheduled」的課堂', code: 'STATUS_NOT_EDITABLE' }, 409);
  }

  const newStartTime = normalizeTime(body.newStartTime);
  const newEndTime = normalizeTime(body.newEndTime);

  if (toMinutes(newStartTime) >= toMinutes(newEndTime)) {
    return c.json({ error: '開始時間需早於結束時間', code: 'INVALID_TIME_RANGE' }, 400);
  }

  const classSessionsPromise = supabase
    .from('sessions')
    .select('id, start_time, end_time')
    .eq('org_id', orgId)
    .eq('class_id', sessionState.classId)
    .eq('session_date', body.newSessionDate)
    .eq('status', 'scheduled')
    .neq('id', id);

  const teacherSessionsPromise = sessionState.teacherId
    ? supabase
        .from('sessions')
        .select('id, start_time, end_time')
        .eq('org_id', orgId)
        .eq('teacher_id', sessionState.teacherId)
        .eq('session_date', body.newSessionDate)
        .eq('status', 'scheduled')
        .neq('id', id)
    : Promise.resolve({ data: [], error: null });

  const [classSessionsResult, teacherSessionsResult] = await Promise.all([
    classSessionsPromise,
    teacherSessionsPromise,
  ]);

  if (classSessionsResult.error) {
    return c.json({ error: classSessionsResult.error.message, code: 'DB_ERROR' }, 400);
  }

  if (teacherSessionsResult.error) {
    return c.json({ error: teacherSessionsResult.error.message, code: 'DB_ERROR' }, 400);
  }

  const classConflict = (classSessionsResult.data ?? []).find((peer) =>
    isTimeOverlap(
      newStartTime,
      newEndTime,
      normalizeTime(peer.start_time as string),
      normalizeTime(peer.end_time as string),
    ),
  );

  if (classConflict) {
    return c.json({ error: '同班級於此時段已有課堂', code: 'CLASS_CONFLICT' }, 409);
  }

  const teacherConflict = (teacherSessionsResult.data ?? []).find((peer) =>
    isTimeOverlap(
      newStartTime,
      newEndTime,
      normalizeTime(peer.start_time as string),
      normalizeTime(peer.end_time as string),
    ),
  );

  if (teacherConflict) {
    return c.json({ error: '老師於此時段已有其他課堂', code: 'TEACHER_CONFLICT' }, 409);
  }

  const { data: updatedSession, error: updateError } = await supabase
    .from('sessions')
    .update({
      session_date: body.newSessionDate,
      start_time: newStartTime,
      end_time: newEndTime,
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .select('id')
    .maybeSingle();

  if (updateError) {
    return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
  }
  if (!updatedSession) {
    return c.json({ error: '更新失敗', code: 'UPDATE_FAILED' }, 400);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    return c.json({ error: profileError.message, code: 'DB_ERROR' }, 400);
  }

  const { error: insertError } = await supabase.from('schedule_changes').insert(
    buildSingleSessionChangeInsert({
      orgId,
      sessionId: id,
      changeType: 'reschedule',
      sessionState,
      createdByName: profile?.display_name ?? null,
      reason: body.reason ?? null,
      newSessionDate: body.newSessionDate,
      newStartTime,
      newEndTime,
    }),
  );

  if (insertError) {
    return c.json({ error: insertError.message, code: 'DB_ERROR' }, 400);
  }

  return c.json({ success: true }, 200);
});

const batchAssignTeacherRoute = createRoute({
  method: 'patch',
  path: '/batch-assign-teacher',
  tags: ['Sessions'],
  summary: '批次指派老師（sessionIds）',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BatchAssignTeacherBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: BatchAssignTeacherResultSchema,
        },
      },
    },
    400: {
      description: '參數或資料錯誤',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(batchAssignTeacherRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const uniqueSessionIds = [...new Set(body.sessionIds)];
  const includeAssigned = body.includeAssigned ?? false;
  const dryRun = body.dryRun ?? false;

  const { data: sessionRows, error: sessionRowsError } = await supabase
    .from('sessions')
    .select('id, class_id, session_date, start_time, end_time, status, assignment_status, teacher_id')
    .eq('org_id', orgId)
    .in('id', uniqueSessionIds);

  if (sessionRowsError) {
    return c.json({ error: sessionRowsError.message, code: 'DB_ERROR' }, 400);
  }

  const targetSessions = (sessionRows ?? []) as Array<{
    id: string;
    class_id: string;
    session_date: string;
    start_time: string;
    end_time: string;
    status: 'scheduled' | 'completed' | 'cancelled';
    assignment_status: 'assigned' | 'unassigned' | null;
    teacher_id: string | null;
  }>;

  if (targetSessions.length === 0) {
    return c.json(
      {
        updated: 0,
        skippedConflicts: 0,
        skippedNotEligible: uniqueSessionIds.length,
        conflicts: [],
        dryRun,
      },
      200,
    );
  }

  const targetClassIds = [...new Set(targetSessions.map((session) => session.class_id))];
  const [
    { data: classRows, error: classRowsError },
    { data: teacherSubjectRows, error: teacherSubjectRowsError },
    { data: teacherCampusRows, error: teacherCampusRowsError },
    { data: teacherRow, error: teacherRowError },
  ] =
    await Promise.all([
      supabase
        .from('classes')
        .select('id, course_id, campus_id')
        .eq('org_id', orgId)
        .in('id', targetClassIds),
      supabase
        .from('staff_subjects')
        .select('subject_id')
        .eq('staff_id', body.teacherId),
      supabase
        .from('staff_campuses')
        .select('campus_id')
        .eq('staff_id', body.teacherId),
      supabase
        .from('staff')
        .select('id, user_id, is_active')
        .eq('org_id', orgId)
        .eq('id', body.teacherId)
        .maybeSingle(),
    ]);

  if (classRowsError) {
    return c.json({ error: classRowsError.message, code: 'DB_ERROR' }, 400);
  }
  if (teacherSubjectRowsError) {
    return c.json({ error: teacherSubjectRowsError.message, code: 'DB_ERROR' }, 400);
  }
  if (teacherCampusRowsError) {
    return c.json({ error: teacherCampusRowsError.message, code: 'DB_ERROR' }, 400);
  }
  if (teacherRowError) {
    return c.json({ error: teacherRowError.message, code: 'DB_ERROR' }, 400);
  }
  if (!teacherRow) {
    return c.json(
      {
        updated: 0,
        skippedConflicts: 0,
        skippedNotEligible: uniqueSessionIds.length,
        conflicts: [],
        dryRun,
      },
      200,
    );
  }

  const batchTeacherUserId = teacherRow['user_id'] as string | undefined;
  const batchTeacherActive = (teacherRow['is_active'] as boolean | null) ?? false;
  if (!batchTeacherUserId || !batchTeacherActive) {
    return c.json(
      {
        updated: 0,
        skippedConflicts: 0,
        skippedNotEligible: uniqueSessionIds.length,
        conflicts: [],
        dryRun,
      },
      200,
    );
  }

  const { data: batchTeacherRole, error: batchTeacherRoleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', batchTeacherUserId)
    .eq('role', 'teacher')
    .maybeSingle();

  if (batchTeacherRoleError) {
    return c.json({ error: batchTeacherRoleError.message, code: 'DB_ERROR' }, 400);
  }
  if (!batchTeacherRole) {
    return c.json(
      {
        updated: 0,
        skippedConflicts: 0,
        skippedNotEligible: uniqueSessionIds.length,
        conflicts: [],
        dryRun,
      },
      200,
    );
  }

  const classCourseMap = new Map<string, string>();
  const classCampusMap = new Map<string, string>();
  for (const row of classRows ?? []) {
    const classId = row['id'] as string | undefined;
    const courseId = row['course_id'] as string | undefined;
    const campusId = row['campus_id'] as string | undefined;
    if (classId && courseId) {
      classCourseMap.set(classId, courseId);
    }
    if (classId && campusId) {
      classCampusMap.set(classId, campusId);
    }
  }

  const courseIds = [...new Set([...classCourseMap.values()])];
  const courseSubjectMap = new Map<string, string>();
  if (courseIds.length > 0) {
    const { data: courseRows, error: courseRowsError } = await supabase
      .from('courses')
      .select('id, subject_id')
      .eq('org_id', orgId)
      .in('id', courseIds);

    if (courseRowsError) {
      return c.json({ error: courseRowsError.message, code: 'DB_ERROR' }, 400);
    }

    for (const row of courseRows ?? []) {
      const courseId = row['id'] as string | undefined;
      const subjectId = row['subject_id'] as string | null | undefined;
      if (courseId && subjectId) {
        courseSubjectMap.set(courseId, subjectId);
      }
    }
  }

  const teacherSubjectIds = new Set<string>();
  for (const row of teacherSubjectRows ?? []) {
    const subjectId = row['subject_id'] as string | undefined;
    if (subjectId) {
      teacherSubjectIds.add(subjectId);
    }
  }
  const teacherCampusIds = new Set<string>();
  for (const row of teacherCampusRows ?? []) {
    const campusId = row['campus_id'] as string | undefined;
    if (campusId) {
      teacherCampusIds.add(campusId);
    }
  }

  const sessionDates = targetSessions.map((session) => session.session_date);
  const sortedDates = [...sessionDates].sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];

  const { data: teacherBusyRows, error: teacherBusyError } = await supabase
    .from('sessions')
    .select('id, session_date, start_time, end_time')
    .eq('org_id', orgId)
    .eq('teacher_id', body.teacherId)
    .eq('status', 'scheduled')
    .gte('session_date', minDate)
    .lte('session_date', maxDate);

  if (teacherBusyError) {
    return c.json({ error: teacherBusyError.message, code: 'DB_ERROR' }, 400);
  }

  const teacherBusySlots = (teacherBusyRows ?? []).map((row) => ({
    sessionId: row.id as string,
    sessionDate: row.session_date as string,
    startTime: normalizeTime(row.start_time as string),
    endTime: normalizeTime(row.end_time as string),
  }));

  const sortedTargets = [...targetSessions].sort((a, b) => {
    const dateCompare = a.session_date.localeCompare(b.session_date);
    if (dateCompare !== 0) return dateCompare;
    return normalizeTime(a.start_time).localeCompare(normalizeTime(b.start_time));
  });

  let skippedNotEligible = uniqueSessionIds.length - targetSessions.length;
  let skippedConflicts = 0;
  const updatedIds: string[] = [];
  const conflicts: Array<{
    sessionId: string;
    sessionDate: string;
    startTime: string;
    endTime: string;
    conflictWithSessionId: string;
  }> = [];
  const plannedSlots: Array<{
    sessionId: string;
    sessionDate: string;
    startTime: string;
    endTime: string;
  }> = [];

  for (const session of sortedTargets) {
    const assignmentStatus =
      session.assignment_status ?? (session.teacher_id ? 'assigned' : 'unassigned');
    if (session.status !== 'scheduled') {
      skippedNotEligible += 1;
      continue;
    }
    if (!includeAssigned && assignmentStatus === 'assigned') {
      skippedNotEligible += 1;
      continue;
    }

    const courseId = classCourseMap.get(session.class_id);
    const subjectId = courseId ? courseSubjectMap.get(courseId) : undefined;
    const campusId = classCampusMap.get(session.class_id);
    if (!subjectId || !teacherSubjectIds.has(subjectId) || !campusId || !teacherCampusIds.has(campusId)) {
      skippedNotEligible += 1;
      continue;
    }

    const sessionStart = normalizeTime(session.start_time);
    const sessionEnd = normalizeTime(session.end_time);
    const conflict = [...teacherBusySlots, ...plannedSlots].find(
      (slot) =>
        slot.sessionId !== session.id &&
        slot.sessionDate === session.session_date &&
        isTimeOverlap(sessionStart, sessionEnd, slot.startTime, slot.endTime),
    );

    if (conflict) {
      skippedConflicts += 1;
      conflicts.push({
        sessionId: session.id,
        sessionDate: session.session_date,
        startTime: toHHmm(sessionStart) ?? sessionStart,
        endTime: toHHmm(sessionEnd) ?? sessionEnd,
        conflictWithSessionId: conflict.sessionId,
      });
      continue;
    }

    updatedIds.push(session.id);
    plannedSlots.push({
      sessionId: session.id,
      sessionDate: session.session_date,
      startTime: sessionStart,
      endTime: sessionEnd,
    });
  }

  if (!dryRun && updatedIds.length > 0) {
    const { error: updateError } = await supabase
      .from('sessions')
      .update({ teacher_id: body.teacherId, assignment_status: 'assigned' })
      .eq('org_id', orgId)
      .in('id', updatedIds);

    if (updateError) {
      return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
    }
  }

  if (!dryRun) {
    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceName: 'sessions',
        action: 'batch_assign_teacher',
        details: {
          requested: uniqueSessionIds.length,
          updated: updatedIds.length,
          skippedConflicts,
          skippedNotEligible,
          teacherId: body.teacherId,
        },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );
  }

  return c.json(
    {
      updated: updatedIds.length,
      skippedConflicts,
      skippedNotEligible,
      conflicts,
      dryRun,
    },
    200,
  );
});

const batchUpdateTimeRoute = createRoute({
  method: 'patch',
  path: '/batch-update-time',
  tags: ['Sessions'],
  summary: '批次修改課堂時間（sessionIds）',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BatchUpdateTimeBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: BatchSessionActionResultSchema,
        },
      },
    },
    400: {
      description: '參數或資料錯誤',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(batchUpdateTimeRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const uniqueSessionIds = [...new Set(body.sessionIds)];
  const dryRun = body.dryRun ?? true;
  const newStartTime = normalizeTime(body.startTime);
  const newEndTime = normalizeTime(body.endTime);

  if (toMinutes(newStartTime) >= toMinutes(newEndTime)) {
    return c.json({ error: '開始時間需早於結束時間', code: 'INVALID_TIME_RANGE' }, 400);
  }

  const { data: sessionRows, error: sessionRowsError } = await supabase
    .from('sessions')
    .select('id, class_id, session_date, start_time, end_time, status, teacher_id')
    .eq('org_id', orgId)
    .in('id', uniqueSessionIds);

  if (sessionRowsError) {
    return c.json({ error: sessionRowsError.message, code: 'DB_ERROR' }, 400);
  }

  const targetSessions = (sessionRows ?? []) as Array<{
    id: string;
    class_id: string;
    session_date: string;
    start_time: string;
    end_time: string;
    status: 'scheduled' | 'completed' | 'cancelled';
    teacher_id: string | null;
  }>;

  if (targetSessions.length === 0) {
    return c.json(
      {
        updated: 0,
        skipped: uniqueSessionIds.length,
        processableIds: [],
        conflicts: [],
        dryRun,
      },
      200,
    );
  }

  const targetDates = [...new Set(targetSessions.map((session) => session.session_date))];
  const targetClassIds = [...new Set(targetSessions.map((session) => session.class_id))];
  const targetTeacherIds = [
    ...new Set(
      targetSessions
        .map((session) => session.teacher_id)
        .filter((teacherId): teacherId is string => !!teacherId),
    ),
  ];

  const { data: classDateRows, error: classDateError } = await supabase
    .from('sessions')
    .select('id, class_id, session_date, start_time, end_time')
    .eq('org_id', orgId)
    .eq('status', 'scheduled')
    .in('class_id', targetClassIds)
    .in('session_date', targetDates);

  if (classDateError) {
    return c.json({ error: classDateError.message, code: 'DB_ERROR' }, 400);
  }

  const teacherDateResult =
    targetTeacherIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('sessions')
          .select('id, session_date, start_time, end_time, teacher_id')
          .eq('org_id', orgId)
          .eq('status', 'scheduled')
          .in('teacher_id', targetTeacherIds)
          .in('session_date', targetDates);

  if (teacherDateResult.error) {
    return c.json({ error: teacherDateResult.error.message, code: 'DB_ERROR' }, 400);
  }

  const classPeers = (classDateRows ?? []) as Array<{
    id: string;
    class_id: string;
    session_date: string;
    start_time: string;
    end_time: string;
  }>;
  const teacherPeers = (teacherDateResult.data ?? []) as Array<{
    id: string;
    session_date: string;
    start_time: string;
    end_time: string;
    teacher_id: string | null;
  }>;

  const batchPlan = planBatchUpdateTime({
    newStartTime,
    newEndTime,
    targetSessions: targetSessions.map((target) => ({
      id: target.id,
      classId: target.class_id,
      teacherId: target.teacher_id,
      sessionDate: target.session_date,
      status: target.status,
    })),
    existingClassPeers: classPeers.map((peer) => ({
      id: peer.id,
      classId: peer.class_id,
      sessionDate: peer.session_date,
      startTime: peer.start_time,
      endTime: peer.end_time,
    })),
    existingTeacherPeers: teacherPeers.map((peer) => ({
      id: peer.id,
      teacherId: peer.teacher_id,
      sessionDate: peer.session_date,
      startTime: peer.start_time,
      endTime: peer.end_time,
    })),
  });
  const conflicts: BatchSessionConflictItem[] = batchPlan.conflicts;
  const processableIds = batchPlan.processableIds;

  const missingCount = uniqueSessionIds.length - targetSessions.length;
  const updated = processableIds.length;
  const skipped = conflicts.length + missingCount;

  if (!dryRun && updated > 0) {
    const { error: updateError } = await supabase
      .from('sessions')
      .update({ start_time: newStartTime, end_time: newEndTime })
      .eq('org_id', orgId)
      .in('id', processableIds);

    if (updateError) {
      return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
    }
  }

  if (!dryRun) {
    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceName: 'sessions',
        action: 'batch_update_session_time',
        details: {
          requested: uniqueSessionIds.length,
          updated,
          skipped,
          startTime: newStartTime,
          endTime: newEndTime,
        },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );
  }

  return c.json(
    {
      updated,
      skipped,
      processableIds,
      conflicts,
      dryRun,
    },
    200,
  );
});

const batchCancelRoute = createRoute({
  method: 'patch',
  path: '/batch-cancel',
  tags: ['Sessions'],
  summary: '批次停課（sessionIds）',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BatchCancelBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: BatchSessionActionResultSchema,
        },
      },
    },
    400: {
      description: '參數或資料錯誤',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(batchCancelRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const uniqueSessionIds = [...new Set(body.sessionIds)];
  const dryRun = body.dryRun ?? true;

  const { data: sessionRows, error: sessionRowsError } = await supabase
    .from('sessions')
    .select('id, class_id, session_date, start_time, end_time, status, teacher_id')
    .eq('org_id', orgId)
    .in('id', uniqueSessionIds);

  if (sessionRowsError) {
    return c.json({ error: sessionRowsError.message, code: 'DB_ERROR' }, 400);
  }

  const targetSessions = (sessionRows ?? []) as Array<{
    id: string;
    class_id: string;
    session_date: string;
    start_time: string;
    end_time: string;
    status: 'scheduled' | 'completed' | 'cancelled';
    teacher_id: string | null;
  }>;

  if (targetSessions.length === 0) {
    return c.json(
      {
        updated: 0,
        skipped: uniqueSessionIds.length,
        processableIds: [],
        conflicts: [],
        dryRun,
      },
      200,
    );
  }

  const conflicts: BatchSessionConflictItem[] = [];
  const processableIds: string[] = [];

  for (const target of targetSessions) {
    if (target.status !== 'scheduled') {
      conflicts.push({
        sessionId: target.id,
        sessionDate: target.session_date,
        reason: 'status_not_cancellable',
        detail: '僅可停課狀態為「scheduled」的課堂',
      });
      continue;
    }
    processableIds.push(target.id);
  }

  const missingCount = uniqueSessionIds.length - targetSessions.length;
  const updated = processableIds.length;
  const skipped = conflicts.length + missingCount;

  if (!dryRun && updated > 0) {
    const { error: cancelError } = await supabase
      .from('sessions')
      .update({ status: 'cancelled' })
      .eq('org_id', orgId)
      .in('id', processableIds);

    if (cancelError) {
      return c.json({ error: cancelError.message, code: 'DB_ERROR' }, 400);
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      return c.json({ error: profileError.message, code: 'DB_ERROR' }, 400);
    }

    const { error: insertChangeError } = await supabase.from('schedule_changes').insert(
      processableIds.map((sessionId) => ({
        org_id: orgId,
        session_id: sessionId,
        change_type: 'cancellation',
        reason: body.reason ?? null,
        created_by_name: profile?.display_name ?? null,
      })),
    );

    if (insertChangeError) {
      return c.json({ error: insertChangeError.message, code: 'DB_ERROR' }, 400);
    }
  }

  if (!dryRun) {
    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceName: 'sessions',
        action: 'batch_cancel_session',
        details: {
          requested: uniqueSessionIds.length,
          updated,
          skipped,
        },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );
  }

  return c.json(
    {
      updated,
      skipped,
      processableIds,
      conflicts,
      dryRun,
    },
    200,
  );
});

const batchUncancelRoute = createRoute({
  method: 'patch',
  path: '/batch-uncancel',
  tags: ['Sessions'],
  summary: '批次恢復課堂（sessionIds）',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BatchUncancelBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功',
      content: {
        'application/json': {
          schema: BatchSessionActionResultSchema,
        },
      },
    },
    400: {
      description: '參數或資料錯誤',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(batchUncancelRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const uniqueSessionIds = [...new Set(body.sessionIds)];
  const dryRun = body.dryRun ?? true;

  const { data: sessionRows, error: sessionRowsError } = await supabase
    .from('sessions')
    .select('id, class_id, session_date, start_time, end_time, status, teacher_id')
    .eq('org_id', orgId)
    .in('id', uniqueSessionIds);

  if (sessionRowsError) {
    return c.json({ error: sessionRowsError.message, code: 'DB_ERROR' }, 400);
  }

  const targetSessions = (sessionRows ?? []) as Array<{
    id: string;
    class_id: string;
    session_date: string;
    start_time: string;
    end_time: string;
    status: 'scheduled' | 'completed' | 'cancelled';
    teacher_id: string | null;
  }>;

  if (targetSessions.length === 0) {
    return c.json(
      {
        updated: 0,
        skipped: uniqueSessionIds.length,
        processableIds: [],
        conflicts: [],
        dryRun,
      },
      200,
    );
  }

  const targetDates = [...new Set(targetSessions.map((session) => session.session_date))];
  const targetClassIds = [...new Set(targetSessions.map((session) => session.class_id))];
  const targetTeacherIds = [
    ...new Set(
      targetSessions
        .map((session) => session.teacher_id)
        .filter((teacherId): teacherId is string => !!teacherId),
    ),
  ];

  const { data: classDateRows, error: classDateError } = await supabase
    .from('sessions')
    .select('id, class_id, session_date, start_time, end_time')
    .eq('org_id', orgId)
    .eq('status', 'scheduled')
    .in('class_id', targetClassIds)
    .in('session_date', targetDates);

  if (classDateError) {
    return c.json({ error: classDateError.message, code: 'DB_ERROR' }, 400);
  }

  const teacherDateResult =
    targetTeacherIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('sessions')
          .select('id, session_date, start_time, end_time, teacher_id')
          .eq('org_id', orgId)
          .eq('status', 'scheduled')
          .in('teacher_id', targetTeacherIds)
          .in('session_date', targetDates);

  if (teacherDateResult.error) {
    return c.json({ error: teacherDateResult.error.message, code: 'DB_ERROR' }, 400);
  }

  const classPeers = (classDateRows ?? []) as Array<{
    id: string;
    class_id: string;
    session_date: string;
    start_time: string;
    end_time: string;
  }>;
  const teacherPeers = (teacherDateResult.data ?? []) as Array<{
    id: string;
    session_date: string;
    start_time: string;
    end_time: string;
    teacher_id: string | null;
  }>;

  const conflicts: BatchSessionConflictItem[] = [];
  const processableIds: string[] = [];
  const plannedReopenSlots: Array<{
    sessionId: string;
    classId: string;
    teacherId: string | null;
    sessionDate: string;
    startTime: string;
    endTime: string;
  }> = [];
  const sortedTargets = [...targetSessions].sort((a, b) => {
    const dateCompare = a.session_date.localeCompare(b.session_date);
    if (dateCompare !== 0) return dateCompare;
    return normalizeTime(a.start_time).localeCompare(normalizeTime(b.start_time));
  });

  for (const target of sortedTargets) {
    if (target.status !== 'cancelled') {
      conflicts.push({
        sessionId: target.id,
        sessionDate: target.session_date,
        reason: 'status_not_reopenable',
        detail: '僅可取消已停課（cancelled）的課堂',
      });
      continue;
    }

    const targetStart = normalizeTime(target.start_time);
    const targetEnd = normalizeTime(target.end_time);

    const classConflictWithExisting = classPeers.find(
      (peer) =>
        peer.id !== target.id &&
        peer.class_id === target.class_id &&
        peer.session_date === target.session_date &&
        isTimeOverlap(targetStart, targetEnd, normalizeTime(peer.start_time), normalizeTime(peer.end_time)),
    );

    if (classConflictWithExisting) {
      conflicts.push({
        sessionId: target.id,
        sessionDate: target.session_date,
        reason: 'class_conflict',
        detail: '同班級於此時段已有課堂',
        conflictingSessionId: classConflictWithExisting.id,
      });
      continue;
    }

    const classConflictWithPlanned = plannedReopenSlots.find(
      (slot) =>
        slot.classId === target.class_id &&
        slot.sessionDate === target.session_date &&
        isTimeOverlap(targetStart, targetEnd, slot.startTime, slot.endTime),
    );

    if (classConflictWithPlanned) {
      conflicts.push({
        sessionId: target.id,
        sessionDate: target.session_date,
        reason: 'class_conflict',
        detail: '同班級於此時段已有課堂',
        conflictingSessionId: classConflictWithPlanned.sessionId,
      });
      continue;
    }

    if (target.teacher_id) {
      const teacherConflictWithExisting = teacherPeers.find(
        (peer) =>
          peer.id !== target.id &&
          peer.teacher_id === target.teacher_id &&
          peer.session_date === target.session_date &&
          isTimeOverlap(targetStart, targetEnd, normalizeTime(peer.start_time), normalizeTime(peer.end_time)),
      );

      if (teacherConflictWithExisting) {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'teacher_conflict',
          detail: '老師於此時段已有其他課堂',
          conflictingSessionId: teacherConflictWithExisting.id,
        });
        continue;
      }

      const teacherConflictWithPlanned = plannedReopenSlots.find(
        (slot) =>
          slot.sessionId !== target.id &&
          slot.teacherId === target.teacher_id &&
          slot.sessionDate === target.session_date &&
          isTimeOverlap(targetStart, targetEnd, slot.startTime, slot.endTime),
      );

      if (teacherConflictWithPlanned) {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'teacher_conflict',
          detail: '老師於此時段已有其他課堂',
          conflictingSessionId: teacherConflictWithPlanned.sessionId,
        });
        continue;
      }
    }

    processableIds.push(target.id);
    plannedReopenSlots.push({
      sessionId: target.id,
      classId: target.class_id,
      teacherId: target.teacher_id,
      sessionDate: target.session_date,
      startTime: targetStart,
      endTime: targetEnd,
    });
  }

  const missingCount = uniqueSessionIds.length - targetSessions.length;
  const updated = processableIds.length;
  const skipped = conflicts.length + missingCount;

  if (!dryRun && updated > 0) {
    const { error: reopenError } = await supabase
      .from('sessions')
      .update({ status: 'scheduled' })
      .eq('org_id', orgId)
      .in('id', processableIds);

    if (reopenError) {
      return c.json({ error: reopenError.message, code: 'DB_ERROR' }, 400);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();

    const { error: insertChangeError } = await supabase.from('schedule_changes').insert(
      processableIds.map((sessionId) => ({
        org_id: orgId,
        session_id: sessionId,
        change_type: 'uncancel',
        created_by_name: profile?.display_name ?? null,
      })),
    );

    if (insertChangeError) {
      return c.json({ error: insertChangeError.message, code: 'DB_ERROR' }, 400);
    }
  }

  if (!dryRun) {
    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceName: 'sessions',
        action: 'batch_uncancel_session',
        details: {
          requested: uniqueSessionIds.length,
          updated,
          skipped,
        },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );
  }

  return c.json(
    {
      updated,
      skipped,
      processableIds,
      conflicts,
      dryRun,
    },
    200,
  );
});

export default app;
