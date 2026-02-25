import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import {
  assertSessionOperable,
  SessionUnassignedError,
} from '../domain/session-assignment/session-operation-guard';

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
  .enum(['reschedule', 'substitute', 'cancellation'])
  .openapi('SessionChangeType');

const SessionListQuerySchema = z
  .object({
    from: DateSchema.optional(),
    to: DateSchema.optional(),
    campusId: z.uuid().optional().openapi({ description: '分校 ID' }),
    courseId: z.uuid().optional().openapi({ description: '課程 ID' }),
    teacherId: z.uuid().optional().openapi({ description: '教師 ID' }),
    classId: z.uuid().optional().openapi({ description: '班級 ID' }),
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
    newSessionDate: DateSchema.nullable(),
    newStartTime: TimeSchema.nullable(),
    newEndTime: TimeSchema.nullable(),
    substituteTeacherId: z.uuid().nullable(),
    substituteTeacherName: z.string().nullable(),
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

function mapSessionChange(row: Record<string, unknown>) {
  const substituteRaw = row['staff'] as Record<string, unknown> | Record<string, unknown>[] | null;
  const substituteTeacher = Array.isArray(substituteRaw)
    ? (substituteRaw[0] as Record<string, unknown> | undefined)
    : substituteRaw;

  return {
    id: row['id'] as string,
    changeType: row['change_type'] as 'reschedule' | 'substitute' | 'cancellation',
    newSessionDate: (row['new_session_date'] as string | null) ?? null,
    newStartTime: toHHmm(row['new_start_time'] as string | null),
    newEndTime: toHHmm(row['new_end_time'] as string | null),
    substituteTeacherId: (substituteTeacher?.['id'] as string | undefined) ?? null,
    substituteTeacherName: (substituteTeacher?.['display_name'] as string | undefined) ?? null,
    reason: (row['reason'] as string | null) ?? null,
    createdByName: (row['created_by_name'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
  };
}

async function loadSessionOperationState(
  supabase: AppEnv['Variables']['supabase'],
  orgId: string,
  id: string,
): Promise<{
  assignmentStatus: 'assigned' | 'unassigned';
  status: 'scheduled' | 'completed' | 'cancelled';
} | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('status, assignment_status, teacher_id')
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;

  const assignmentStatus =
    (data.assignment_status as 'assigned' | 'unassigned' | null) ??
    ((data.teacher_id as string | null) ? 'assigned' : 'unassigned');

  return {
    assignmentStatus,
    status: data.status as 'scheduled' | 'completed' | 'cancelled',
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
  const { from, to, campusId, courseId, teacherId, classId } = c.req.valid('query');

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

  if (campusId) {
    dbQuery = dbQuery.eq('classes.campus_id', campusId);
  }
  if (courseId) {
    dbQuery = dbQuery.eq('classes.course_id', courseId);
  }
  if (teacherId) {
    dbQuery = dbQuery.eq('teacher_id', teacherId);
  }
  if (classId) {
    dbQuery = dbQuery.eq('class_id', classId);
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
    .select(
      `
      id, change_type, new_session_date, new_start_time, new_end_time,
      reason, created_by_name, created_at,
      staff!substitute_teacher_id ( id, display_name )
    `,
    )
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
      description: '課堂未指派老師',
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
  try {
    assertSessionOperable(sessionState);
  } catch (error) {
    if (error instanceof SessionUnassignedError) {
      return c.json({ error: error.message, code: error.code }, 409);
    }
    throw error;
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

  const { error: insertError } = await supabase.from('schedule_changes').insert({
    org_id: orgId,
    session_id: id,
    change_type: 'cancellation',
    reason: body.reason ?? null,
    created_by_name: profile?.display_name ?? null,
  });

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
    throw error;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    return c.json({ error: profileError.message, code: 'DB_ERROR' }, 400);
  }

  const { error: insertError } = await supabase.from('schedule_changes').insert({
    org_id: orgId,
    session_id: id,
    change_type: 'substitute',
    substitute_teacher_id: body.substituteTeacherId,
    reason: body.reason ?? null,
    created_by_name: profile?.display_name ?? null,
  });

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
      description: '課堂未指派老師',
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
  try {
    assertSessionOperable(sessionState);
  } catch (error) {
    if (error instanceof SessionUnassignedError) {
      return c.json({ error: error.message, code: error.code }, 409);
    }
    throw error;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    return c.json({ error: profileError.message, code: 'DB_ERROR' }, 400);
  }

  const { error: insertError } = await supabase.from('schedule_changes').insert({
    org_id: orgId,
    session_id: id,
    change_type: 'reschedule',
    new_session_date: body.newSessionDate,
    new_start_time: body.newStartTime,
    new_end_time: body.newEndTime,
    reason: body.reason ?? null,
    created_by_name: profile?.display_name ?? null,
  });

  if (insertError) {
    return c.json({ error: insertError.message, code: 'DB_ERROR' }, 400);
  }

  return c.json({ success: true }, 200);
});

export default app;
