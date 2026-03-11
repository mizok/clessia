import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { formatAuditClassResourceName, logAudit } from '../utils/audit';
import { planBatchAssign } from '../domain/session-assignment/batch-assign-planner';
import { buildSessionGenerationPlan } from '../domain/session-assignment/session-generation-planner';
import { deriveAssignmentStatus } from '../domain/session-assignment/session-assignment.rules';
import type { BatchAssignMode } from '../domain/session-assignment/session-assignment.types';
import {
  normalizeTime,
  toMinutes,
  isTimeOverlap,
  toWeekdayFromString,
} from '../domain/session-assignment/time-utils';

// ============================================================
// Schemas
// ============================================================

const ScheduleSchema = z
  .object({
    id: z.uuid(),
    classId: z.uuid(),
    weekday: z.number().int().min(1).max(7),
    startTime: z.string(),
    endTime: z.string(),
    teacherId: z.uuid().nullable(),
    teacherName: z.string().optional(),
    effectiveTo: z.string().nullable(),
  })
  .openapi('Schedule');

const ClassSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    campusId: z.uuid(),
    courseId: z.uuid(),
    courseName: z.string().optional(),
    name: z.string(),
    maxStudents: z.number(),
    gradeLevels: z.array(z.string()),
    nextClassId: z.uuid().nullable(),
    isActive: z.boolean(),
    scheduleCount: z.number().optional(),
    scheduleTeacherIds: z.array(z.string()).optional(),
    hasUpcomingSessions: z.boolean().optional(),
    hasAnySessions: z.boolean().optional(),
    // TODO: 待老師點名功能完成後，改為依據 status='completed' 判斷
    hasPastSessions: z.boolean().optional(),
    upcomingCancelledCount: z.number().optional(),
    upcomingUnassignedCount: z.number().optional(),
    upcomingClassConflictCount: z.number().optional(),
    upcomingTeacherConflictCount: z.number().optional(),
    schedules: z.array(ScheduleSchema).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string().nullable().optional(),
    updatedByName: z.string().nullable().optional(),
  })
  .openapi('Class');

const ClassListResponseSchema = z
  .object({
    data: z.array(ClassSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('ClassListResponse');

const CreateClassSchema = z
  .object({
    courseId: z.uuid(),
    name: z.string().min(1).max(50),
    maxStudents: z.number().int().min(1).max(200).optional(),
    nextClassId: z.uuid().nullable().optional(),
  })
  .openapi('CreateClass');

const UpdateClassSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    maxStudents: z.number().int().min(1).max(200).optional(),
    nextClassId: z.uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .openapi('UpdateClass');

const CreateScheduleSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    teacherId: z.uuid().nullable().optional(),
    effectiveTo: z.string().nullable().optional(),
  })
  .openapi('CreateSchedule');

const SessionPreviewSchema = z
  .object({
    sessionDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    teacherId: z.uuid().nullable(),
    teacherName: z.string().optional(),
    weekday: z.number(),
    exists: z.boolean(),
    canCreate: z.boolean(),
    willBeUnassigned: z.boolean(),
    skipReason: z.enum(['exists', 'no_teacher']).nullable(),
  })
  .openapi('SessionPreview');

const BatchAssignTimeRangeSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});

const BatchAssignBodySchema = z.object({
  from: z.string(),
  to: z.string(),
  weekday: z.array(z.number().int().min(1).max(7)).optional(),
  timeRanges: z.array(BatchAssignTimeRangeSchema).optional(),
  toTeacherId: z.uuid(),
  mode: z.enum(['skip-conflicts', 'strict', 'force']).default('skip-conflicts'),
  includeAssigned: z.boolean().default(false),
  dryRun: z.boolean().optional(),
});

const BatchAssignConflictSchema = z.object({
  sessionId: z.uuid(),
  sessionDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  conflictWithSessionId: z.uuid(),
});

const BatchSessionTargetSchema = z.object({
  sessionIds: z.array(z.uuid()).min(1).max(1000),
  dryRun: z.boolean().optional(),
});

const BatchUpdateSessionTimeBodySchema = BatchSessionTargetSchema.extend({
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});

const BatchCancelSessionsBodySchema = BatchSessionTargetSchema;

const BatchSessionConflictSchema = z.object({
  sessionId: z.uuid(),
  sessionDate: z.string(),
  reason: z.enum([
    'status_not_editable',
    'status_not_cancellable',
    'status_not_reopenable',
    'class_conflict',
    'teacher_conflict',
  ]),
  detail: z.string(),
  conflictingSessionId: z.uuid().optional(),
});

const BatchSessionActionResponseSchema = z.object({
  updated: z.number(),
  skipped: z.number(),
  processableIds: z.array(z.uuid()),
  conflicts: z.array(BatchSessionConflictSchema),
  dryRun: z.boolean(),
});

const GenerateSessionsResponseSchema = z.object({
  createdAssigned: z.number(),
  createdUnassigned: z.number(),
  skippedExisting: z.number(),
  skippedNoTeacher: z.number(),
  totalPlanned: z.number(),
});

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi('Error');

const CheckConflictsRequestSchema = z
  .object({
    schedules: z.array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        startTime: z.string(),
        endTime: z.string(),
        teacherId: z.uuid().nullable(),
        effectiveTo: z.string().nullable().optional(),
      }),
    ),
    excludeClassId: z.uuid().optional(),
  })
  .openapi('CheckConflictsRequest');

const ScheduleConflictItemSchema = z
  .object({
    scheduleIndex: z.number().int(),
    teacherName: z.string(),
    conflictingClassId: z.uuid(),
    conflictingClassName: z.string(),
    conflictingCourseName: z.string(),
    conflictingWeekday: z.number().int(),
    conflictingStartTime: z.string(),
    conflictingEndTime: z.string(),
  })
  .openapi('ScheduleConflictItem');

const QueryParamsSchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
  campusId: z.uuid().optional(),
  courseId: z.uuid().optional(),
  isActive: z.string().optional(),
});

// ============================================================
// Helpers
// ============================================================

function mapSchedule(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    classId: row['class_id'] as string,
    weekday: row['weekday'] as number,
    startTime: row['start_time'] as string,
    endTime: row['end_time'] as string,
    teacherId: (row['teacher_id'] as string | null) ?? null,
    teacherName: (row['staff'] as { display_name: string } | null)?.display_name,
    effectiveTo: (row['effective_to'] as string | null) ?? null,
  };
}

interface ClassExtras {
  schedules?: unknown[];
  scheduleCount?: number;
  scheduleTeacherIds?: string[];
  hasUpcomingSessions?: boolean;
  hasAnySessions?: boolean;
  // TODO: 待老師點名功能完成後，改為依據 status='completed' 判斷
  hasPastSessions?: boolean;
  upcomingCancelledCount?: number;
  upcomingUnassignedCount?: number;
  upcomingClassConflictCount?: number;
  upcomingTeacherConflictCount?: number;
  updatedByName?: string | null;
}

function mapClass(row: Record<string, unknown>, extras?: ClassExtras) {
  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    campusId: row['campus_id'] as string,
    courseId: row['course_id'] as string,
    courseName: (row['courses'] as { name: string } | null)?.name,
    name: row['name'] as string,
    maxStudents: row['max_students'] as number,
    gradeLevels: (row['grade_levels'] as string[]) ?? [],
    nextClassId: (row['next_class_id'] as string | null) ?? null,
    isActive: row['is_active'] as boolean,
    scheduleCount: extras?.scheduleCount,
    scheduleTeacherIds: extras?.scheduleTeacherIds,
    hasUpcomingSessions: extras?.hasUpcomingSessions,
    hasAnySessions: extras?.hasAnySessions,
    hasPastSessions: extras?.hasPastSessions,
    upcomingCancelledCount: extras?.upcomingCancelledCount,
    upcomingUnassignedCount: extras?.upcomingUnassignedCount,
    upcomingClassConflictCount: extras?.upcomingClassConflictCount,
    upcomingTeacherConflictCount: extras?.upcomingTeacherConflictCount,
    schedules: extras?.schedules?.map((s) => mapSchedule(s as Record<string, unknown>)),
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    updatedBy: (row['updated_by'] as string | null) ?? null,
    updatedByName:
      extras?.updatedByName || (row['ba_user'] as { name: string } | null)?.name || null,
  };
}

function classAuditResourceName(row: Record<string, unknown> | null | undefined): string | null {
  return formatAuditClassResourceName({
    className: row?.['name'] as string | null | undefined,
    courseName: (row?.['courses'] as { name?: string } | null | undefined)?.name ?? null,
    campusName: (row?.['campuses'] as { name?: string } | null | undefined)?.name ?? null,
  });
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


// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/classes
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Classes'],
    summary: '取得班級列表',
    request: { query: QueryParamsSchema },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: ClassListResponseSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const query = c.req.valid('query');
    const page = Math.max(parseInt(query.page || '1'), 1);
    const rawPageSize = query.pageSize !== undefined ? parseInt(query.pageSize) : 50;
    const unpaginated = rawPageSize === 0;
    const pageSize = unpaginated ? 0 : Math.max(rawPageSize, 1);
    const offset = (page - 1) * pageSize;

    let dbQuery = supabase
      .from('classes')
      .select('*, courses(name), schedules(*, staff(display_name)), ba_user!updated_by(name)', {
        count: 'exact',
      });

    if (query.search) dbQuery = dbQuery.ilike('name', `%${query.search}%`);
    if (query.campusId) dbQuery = dbQuery.eq('campus_id', query.campusId);
    if (query.courseId) dbQuery = dbQuery.eq('course_id', query.courseId);
    if (query.isActive !== undefined) dbQuery = dbQuery.eq('is_active', query.isActive === 'true');

    dbQuery = dbQuery.order('created_at', { ascending: false });
    if (!unpaginated) dbQuery = dbQuery.range(offset, offset + pageSize - 1);

    const { data, count, error } = await dbQuery;
    if (error) console.error('DB Error:', error);

    const rows = data || [];
    const classIds = rows.map((r) => r.id as string);

    // Batch-fetch schedule counts & teacher IDs for this page
    const scheduleCountMap: Record<string, number> = {};
    const scheduleTeacherMap: Record<string, string[]> = {};
    const hasUpcomingSet = new Set<string>();
    const hasAnySessionSet = new Set<string>();
    // TODO: 待老師點名功能完成後，改為查 status='completed'
    const hasPastSessionsSet = new Set<string>();
    const upcomingCancelledCountMap: Record<string, number> = {};
    const upcomingUnassignedCountMap: Record<string, number> = {};
    const upcomingClassConflictCountMap: Record<string, number> = {};
    const upcomingTeacherConflictCountMap: Record<string, number> = {};

    if (classIds.length > 0) {
      const sessionsResult = await supabase
        .from('sessions')
        .select('id, class_id, session_date, start_time, end_time, teacher_id')
        .in('class_id', classIds)
        .gte('session_date', new Date().toISOString().split('T')[0])
        .eq('status', 'scheduled');

      for (const s of sessionsResult.data || []) {
        const classId = s.class_id as string;
        hasUpcomingSet.add(classId);
        if (!s.teacher_id) {
          upcomingUnassignedCountMap[classId] = (upcomingUnassignedCountMap[classId] ?? 0) + 1;
        }
      }

      const upcomingSessions =
        (sessionsResult.data as
          | Array<{
              id: string;
              class_id: string;
              session_date: string;
              start_time: string;
              end_time: string;
              teacher_id: string | null;
            }>
          | null) ?? [];

      const classDateBuckets = new Map<string, typeof upcomingSessions>();
      for (const session of upcomingSessions) {
        const bucketKey = `${session.class_id}|${session.session_date}`;
        const bucket = classDateBuckets.get(bucketKey) ?? [];
        bucket.push(session);
        classDateBuckets.set(bucketKey, bucket);
      }

      for (const sessions of classDateBuckets.values()) {
        sessions.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
        for (let i = 0; i < sessions.length; i++) {
          for (let j = i + 1; j < sessions.length; j++) {
            if (
              isTimeOverlap(
                normalizeTime(sessions[i].start_time),
                normalizeTime(sessions[i].end_time),
                normalizeTime(sessions[j].start_time),
                normalizeTime(sessions[j].end_time),
              )
            ) {
              const classId = sessions[i].class_id;
              upcomingClassConflictCountMap[classId] =
                (upcomingClassConflictCountMap[classId] ?? 0) + 1;
            } else {
              break;
            }
          }
        }
      }

      const teacherDateBuckets = new Map<string, typeof upcomingSessions>();
      for (const session of upcomingSessions) {
        if (!session.teacher_id) continue;
        const bucketKey = `${session.teacher_id}|${session.session_date}`;
        const bucket = teacherDateBuckets.get(bucketKey) ?? [];
        bucket.push(session);
        teacherDateBuckets.set(bucketKey, bucket);
      }

      for (const sessions of teacherDateBuckets.values()) {
        sessions.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
        for (let i = 0; i < sessions.length; i++) {
          for (let j = i + 1; j < sessions.length; j++) {
            if (
              isTimeOverlap(
                normalizeTime(sessions[i].start_time),
                normalizeTime(sessions[i].end_time),
                normalizeTime(sessions[j].start_time),
                normalizeTime(sessions[j].end_time),
              )
            ) {
              const classIdA = sessions[i].class_id;
              const classIdB = sessions[j].class_id;
              upcomingTeacherConflictCountMap[classIdA] =
                (upcomingTeacherConflictCountMap[classIdA] ?? 0) + 1;
              upcomingTeacherConflictCountMap[classIdB] =
                (upcomingTeacherConflictCountMap[classIdB] ?? 0) + 1;
            } else {
              break;
            }
          }
        }
      }

      const anySessionsResult = await supabase
        .from('sessions')
        .select('class_id')
        .in('class_id', classIds);

      for (const s of anySessionsResult.data || []) {
        hasAnySessionSet.add(s.class_id as string);
      }

      // TODO: 待老師點名功能完成後，改為查 status='completed'
      const pastSessionsResult = await supabase
        .from('sessions')
        .select('class_id')
        .in('class_id', classIds)
        .lt('session_date', new Date().toISOString().slice(0, 10));

      for (const s of pastSessionsResult.data || []) {
        hasPastSessionsSet.add(s.class_id as string);
      }

      const upcomingCancelledResult = await supabase
        .from('sessions')
        .select('class_id')
        .in('class_id', classIds)
        .gte('session_date', new Date().toISOString().split('T')[0])
        .eq('status', 'cancelled');

      for (const s of upcomingCancelledResult.data || []) {
        const classId = s.class_id as string;
        upcomingCancelledCountMap[classId] = (upcomingCancelledCountMap[classId] ?? 0) + 1;
      }
    }

    return c.json({
      data: rows.map((r) => {
        const id = r.id as string;
        const schedules = (r['schedules'] as unknown[]) || [];
        return mapClass(r as Record<string, unknown>, {
          schedules,
          scheduleCount: schedules.length,
          scheduleTeacherIds: schedules
            .map((s: any) => s.teacher_id)
            .filter((tid): tid is string => !!tid),
          hasUpcomingSessions: hasUpcomingSet.has(id),
          hasAnySessions: hasAnySessionSet.has(id),
          hasPastSessions: hasPastSessionsSet.has(id),
          upcomingCancelledCount: upcomingCancelledCountMap[id] ?? 0,
          upcomingUnassignedCount: upcomingUnassignedCountMap[id] ?? 0,
          upcomingClassConflictCount: upcomingClassConflictCountMap[id] ?? 0,
          upcomingTeacherConflictCount: upcomingTeacherConflictCountMap[id] ?? 0,
        });
      }),
      meta: {
        total: count || 0,
        page: unpaginated ? 1 : page,
        pageSize: unpaginated ? (count || 0) : pageSize,
        totalPages: unpaginated ? 1 : Math.ceil((count || 0) / pageSize),
      },
    });
  },
);

// POST /api/classes/check-conflicts
// 注意：必須在所有 /{id} 路由之前定義，否則 check-conflicts 會被當成 :id
app.openapi(
  createRoute({
    method: 'post',
    path: '/check-conflicts',
    tags: ['Classes'],
    summary: '排課衝突預檢（soft check，不阻擋儲存）',
    request: {
      body: { content: { 'application/json': { schema: CheckConflictsRequestSchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({ conflicts: z.array(ScheduleConflictItemSchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { schedules, excludeClassId } = c.req.valid('json');

    const schedulesToCheck = schedules.filter((s) => s.teacherId != null);
    if (schedulesToCheck.length === 0) {
      return c.json({ conflicts: [] }, 200);
    }

    const teacherIds = [...new Set(schedulesToCheck.map((s) => s.teacherId as string))];

    // Step 1: 取得此 org 的所有班級 id（確保跨組織隔離）
    const { data: orgClasses } = await supabase.from('classes').select('id').eq('org_id', orgId);
    let orgClassIds = (orgClasses || []).map((c) => c.id as string);

    if (excludeClassId) {
      orgClassIds = orgClassIds.filter((id) => id !== excludeClassId);
    }

    if (orgClassIds.length === 0) {
      return c.json({ conflicts: [] }, 200);
    }

    // Step 2: 查詢這些班級中屬於這些老師的所有時段
    const { data: existingSchedules, error } = await supabase
      .from('schedules')
      .select('*, staff(display_name), classes(name, courses(name))')
      .in('teacher_id', teacherIds)
      .in('class_id', orgClassIds);

    if (error) {
      console.error('check-conflicts DB error:', error);
      return c.json({ conflicts: [] }, 200); // soft-fail
    }

    type ConflictItem = {
      scheduleIndex: number;
      teacherName: string;
      conflictingClassId: string;
      conflictingClassName: string;
      conflictingCourseName: string;
      conflictingWeekday: number;
      conflictingStartTime: string;
      conflictingEndTime: string;
    };

    const conflicts: ConflictItem[] = [];

    for (let i = 0; i < schedules.length; i++) {
      const s = schedules[i];
      if (!s.teacherId) continue;

      const sStart = s.startTime.substring(0, 5);
      const sEnd = s.endTime.substring(0, 5);

      for (const existing of existingSchedules || []) {
        if (existing.teacher_id !== s.teacherId) continue;
        if (existing.weekday !== s.weekday) continue;

        // 時間重疊：兩段 [s1,e1) 與 [s2,e2) 重疊條件 = s1 < e2 && s2 < e1
        const eStart = (existing.start_time as string).substring(0, 5);
        const eEnd = (existing.end_time as string).substring(0, 5);
        if (sStart >= eEnd || eStart >= sEnd) continue;

        // 日期範圍重疊
        const sTo = s.effectiveTo ?? null;
        const eTo = (existing.effective_to as string | null) ?? null;

        const clsData = existing.classes as {
          name: string;
          courses: { name: string } | null;
        } | null;
        const teacherData = existing.staff as { display_name: string } | null;

        conflicts.push({
          scheduleIndex: i,
          teacherName: teacherData?.display_name ?? '未知老師',
          conflictingClassId: existing.class_id as string,
          conflictingClassName: clsData?.name ?? '未知班級',
          conflictingCourseName: clsData?.courses?.name ?? '未知課程',
          conflictingWeekday: existing.weekday as number,
          conflictingStartTime: existing.start_time as string,
          conflictingEndTime: existing.end_time as string,
        });
      }
    }

    return c.json({ conflicts }, 200);
  },
);

// PATCH /api/classes/batch-set-active
app.openapi(
  createRoute({
    method: 'patch',
    path: '/batch-set-active',
    tags: ['Classes'],
    summary: '批次啟用/停用班級',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({ ids: z.array(z.uuid()), isActive: z.boolean() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ updated: z.number() }) } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { ids, isActive } = c.req.valid('json');
    if (ids.length === 0) return c.json({ updated: 0 }, 200);

    const { data, error } = await supabase
      .from('classes')
      .update({ is_active: isActive, updated_by: userId })
      .in('id', ids)
      .select('id');

    if (error) return c.json({ updated: 0 }, 200);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        action: isActive ? 'batch_activate' : 'batch_deactivate',
        details: { count: ids.length },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ updated: data?.length ?? 0 }, 200);
  },
);

// DELETE /api/classes/batch
app.openapi(
  createRoute({
    method: 'delete',
    path: '/batch',
    tags: ['Classes'],
    summary: '批次刪除班級（有歷史課堂的略過）',
    request: {
      body: {
        content: {
          'application/json': { schema: z.object({ ids: z.array(z.uuid()) }) },
        },
      },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              deleted: z.number(),
              deletedIds: z.array(z.string()),
              skipped: z.number(),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { ids } = c.req.valid('json');
    if (ids.length === 0) return c.json({ deleted: 0, deletedIds: [], skipped: 0 }, 200);

    // 查哪些班級有過去日期的課堂（有則視為已發生業務，不可刪除）
    // TODO: 待老師點名功能完成後，改為查 status='completed'
    const today = new Date().toISOString().slice(0, 10);
    const { data: withPastSessions } = await supabase
      .from('sessions')
      .select('class_id')
      .in('class_id', ids)
      .lt('session_date', today);

    const hasSessionsSet = new Set((withPastSessions || []).map((s) => s.class_id as string));
    const toDeleteIds = ids.filter((id) => !hasSessionsSet.has(id));
    const skipped = ids.length - toDeleteIds.length;

    if (toDeleteIds.length === 0) {
      return c.json({ deleted: 0, deletedIds: [], skipped }, 200);
    }

    const { error } = await supabase.from('classes').delete().in('id', toDeleteIds);
    if (error) return c.json({ deleted: 0, deletedIds: [], skipped }, 200);

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        action: 'batch_delete',
        details: { count: toDeleteIds.length },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ deleted: toDeleteIds.length, deletedIds: toDeleteIds, skipped }, 200);
  },
);

// GET /api/classes/:id（含 schedules）
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Classes'],
    summary: '取得單一班級（含上課時間）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');

    const [classResult, schedulesResult] = await Promise.all([
      supabase
        .from('classes')
        .select('*, courses(name), ba_user!updated_by(name)')
        .eq('id', id)
        .single(),
      supabase.from('schedules').select('*, staff(display_name)').eq('class_id', id),
    ]);

    if (classResult.error || !classResult.data) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    // 查修改者姓名（profiles.id = ba_user.id，每個登入用戶都有 profile）
    let updatedByName: string | null = null;
    const updatedByUserId = classResult.data.updated_by as string | null;
    if (updatedByUserId) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', updatedByUserId)
        .maybeSingle();
      updatedByName = profileData?.display_name ?? null;
    }

    return c.json(
      {
        data: mapClass(classResult.data as Record<string, unknown>, {
          schedules: schedulesResult.data || [],
          updatedByName,
        }),
      },
      200,
    );
  },
);

// POST /api/classes
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Classes'],
    summary: '新增班級',
    request: {
      body: { content: { 'application/json': { schema: CreateClassSchema } } },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      400: {
        description: '驗證錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '班名重複',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const body = c.req.valid('json');

    // 從 course 取得 campus_id 與啟用狀態
    const { data: course } = await supabase
      .from('courses')
      .select('campus_id, is_active')
      .eq('id', body.courseId)
      .eq('org_id', orgId)
      .single();

    if (!course) {
      return c.json({ error: '課程不存在', code: 'COURSE_NOT_FOUND' }, 400);
    }
    if (!(course.is_active as boolean)) {
      return c.json({ error: '課程已停用，無法新增班級', code: 'COURSE_INACTIVE' }, 409);
    }

    const { data, error } = await supabase
      .from('classes')
      .insert({
        org_id: orgId,
        campus_id: course.campus_id,
        course_id: body.courseId,
        name: body.name,
        max_students: body.maxStudents ?? 20,
        next_class_id: body.nextClassId ?? null,
        updated_by: userId,
      })
      .select('*, courses(name), campuses(name)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: '此課程已有同名班級', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceId: data.id as string,
        resourceName: classAuditResourceName(data as Record<string, unknown>),
        action: 'create',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ data: mapClass(data as Record<string, unknown>, {}) }, 201);
  },
);

// PUT /api/classes/:id
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Classes'],
    summary: '更新班級',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateClassSchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const updateData: Record<string, unknown> = { updated_by: userId };
    if (body.name !== undefined) updateData['name'] = body.name;
    if (body.maxStudents !== undefined) updateData['max_students'] = body.maxStudents;
    if (body.nextClassId !== undefined) updateData['next_class_id'] = body.nextClassId;
    if (body.isActive !== undefined) updateData['is_active'] = body.isActive;

    const { data, error } = await supabase
      .from('classes')
      .update(updateData)
      .eq('id', id)
      .select('*, courses(name), campuses(name)')
      .single();

    if (error || !data) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    logAudit(
      supabase,
      {
        orgId: c.get('orgId'),
        userId,
        resourceType: 'class',
        resourceId: id,
        resourceName: classAuditResourceName(data as Record<string, unknown>),
        action: 'update',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ data: mapClass(data as Record<string, unknown>, {}) }, 200);
  },
);

// PATCH /api/classes/:id/toggle-active
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/toggle-active',
    tags: ['Classes'],
    summary: '切換班級啟用/停用',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ClassSchema }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    const { data: current } = await supabase
      .from('classes')
      .select('is_active')
      .eq('id', id)
      .single();

    if (!current) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data, error } = await supabase
      .from('classes')
      .update({ is_active: !current.is_active, updated_by: userId })
      .eq('id', id)
      .select('*, courses(name), campuses(name)')
      .single();

    if (error || !data) {
      return c.json({ error: '更新失敗', code: 'UPDATE_FAILED' }, 404);
    }

    logAudit(
      supabase,
      {
        orgId: c.get('orgId'),
        userId,
        resourceType: 'class',
        resourceId: id,
        resourceName: classAuditResourceName(data as Record<string, unknown>),
        action: 'toggle_active',
        details: { isActive: !current.is_active },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ data: mapClass(data as Record<string, unknown>, {}) }, 200);
  },
);

// DELETE /api/classes/:id
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Classes'],
    summary: '刪除班級（無 sessions 才可刪）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '已有課堂記錄，無法刪除',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');

    // 檢查是否有過去日期的課堂 — 有則視為曾實際發生業務，不可刪除，只能停用
    // TODO: 待老師點名功能完成後，改為檢查 status='completed'
    const today = new Date().toISOString().slice(0, 10);
    const { data: pastSessions } = await supabase
      .from('sessions')
      .select('id')
      .eq('class_id', id)
      .lt('session_date', today)
      .limit(1);

    if (pastSessions && pastSessions.length > 0) {
      return c.json({ error: '此班級已有歷史課堂記錄，無法刪除，請改為停用', code: 'HAS_PAST_SESSIONS' }, 409);
    }

    // CASCADE DELETE: 刪除關聯資料
    await supabase.from('sessions').delete().eq('class_id', id);
    await supabase.from('schedules').delete().eq('class_id', id);
    await supabase.from('enrollments').delete().eq('class_id', id);

    const { data: existing } = await supabase
      .from('classes')
      .select('name, courses(name), campuses(name)')
      .eq('id', id)
      .single();

    const { error } = await supabase.from('classes').delete().eq('id', id);
    if (error) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceId: id,
        resourceName: classAuditResourceName(existing as Record<string, unknown> | null | undefined),
        action: 'delete',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ success: true }, 200);
  },
);

// POST /api/classes/:id/schedules
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/schedules',
    tags: ['Classes'],
    summary: '新增上課時間',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: CreateScheduleSchema } } },
    },
    responses: {
      201: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ScheduleSchema }) } },
      },
      400: {
        description: '驗證錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '時段重複',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const { data: cls } = await supabase
      .from('classes')
      .select('name, courses(name), campuses(name)')
      .eq('id', id)
      .single();

    const { data, error } = await supabase
      .from('schedules')
      .insert({
        class_id: id,
        weekday: body.weekday,
        start_time: body.startTime,
        end_time: body.endTime,
        teacher_id: body.teacherId ?? null,
        effective_to: body.effectiveTo ?? null,
      })
      .select('*, staff(display_name)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: '此時段已存在', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceId: id,
        resourceName: classAuditResourceName(cls as Record<string, unknown> | null | undefined),
        action: 'add_schedule',
        details: { weekday: body.weekday, startTime: body.startTime, endTime: body.endTime },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ data: mapSchedule(data as Record<string, unknown>) }, 201);
  },
);

// PUT /api/classes/:id/schedules/:sid
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}/schedules/{sid}',
    tags: ['Classes'],
    summary: '更新上課時間',
    request: {
      params: z.object({ id: z.uuid(), sid: z.uuid() }),
      body: { content: { 'application/json': { schema: CreateScheduleSchema.partial() } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ data: ScheduleSchema }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id, sid } = c.req.valid('param');
    const body = c.req.valid('json');

    const updateData: Record<string, unknown> = {};
    if (body.weekday !== undefined) updateData['weekday'] = body.weekday;
    if (body.startTime !== undefined) updateData['start_time'] = body.startTime;
    if (body.endTime !== undefined) updateData['end_time'] = body.endTime;
    if (body.teacherId !== undefined) updateData['teacher_id'] = body.teacherId;
    if (body.effectiveTo !== undefined) updateData['effective_to'] = body.effectiveTo;

    const { data, error } = await supabase
      .from('schedules')
      .update(updateData)
      .eq('id', sid)
      .eq('class_id', id)
      .select('*, staff(display_name)')
      .single();

    if (error || !data) {
      return c.json({ error: '時段不存在', code: 'NOT_FOUND' }, 404);
    }

    return c.json({ data: mapSchedule(data as Record<string, unknown>) }, 200);
  },
);

// DELETE /api/classes/:id/schedules/:sid
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}/schedules/{sid}',
    tags: ['Classes'],
    summary: '刪除上課時間',
    request: { params: z.object({ id: z.uuid(), sid: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: {
        description: '不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id, sid } = c.req.valid('param');

    const { data: cls } = await supabase
      .from('classes')
      .select('name, courses(name), campuses(name)')
      .eq('id', id)
      .single();

    const { error } = await supabase.from('schedules').delete().eq('id', sid).eq('class_id', id);

    if (error) {
      return c.json({ error: '時段不存在', code: 'NOT_FOUND' }, 404);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId,
        resourceType: 'class',
        resourceId: id,
        resourceName: classAuditResourceName(cls as Record<string, unknown> | null | undefined),
        action: 'delete_schedule',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ success: true }, 200);
  },
);

// GET /api/classes/:id/sessions/preview
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/sessions/preview',
    tags: ['Classes'],
    summary: '預覽將產生的課堂',
    request: {
      params: z.object({ id: z.uuid() }),
      query: z.object({
        from: z.string(),
        to: z.string(),
        excludeDates: z.string().optional(),
        includeUnassigned: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': { schema: z.object({ data: z.array(SessionPreviewSchema) }) },
        },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '班級或課程已停用',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: {
        description: '參數錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const { from, to, excludeDates, includeUnassigned } = c.req.valid('query');

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
      return c.json({ error: '無效日期格式', code: 'INVALID_DATE' }, 400);
    }

    const includeUnassignedValue = includeUnassigned !== 'false';
    const excludeSet = new Set(excludeDates ? excludeDates.split(',').filter(Boolean) : []);

    const { data: cls, error: clsError } = await supabase
      .from('classes')
      .select('id, is_active, courses(id, is_active)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (clsError) {
      return c.json({ error: clsError.message, code: 'DB_ERROR' }, 400);
    }
    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }
    if (!(cls.is_active as boolean)) {
      return c.json({ error: '班級已停用，無法新增未來課程排程', code: 'CLASS_INACTIVE' }, 409);
    }
    const linkedCourseRaw = cls.courses as
      | { id?: string; is_active?: boolean | null }
      | Array<{ id?: string; is_active?: boolean | null }>
      | null;
    const linkedCourse = Array.isArray(linkedCourseRaw) ? linkedCourseRaw[0] : linkedCourseRaw;
    if (linkedCourse && linkedCourse.is_active === false) {
      return c.json({ error: '課程已停用，無法新增未來課程排程', code: 'COURSE_INACTIVE' }, 409);
    }

    const { data: schedules } = await supabase
      .from('schedules')
      .select('*, staff(display_name)')
      .eq('class_id', id);

    if (!schedules || schedules.length === 0) {
      return c.json({ data: [] }, 200);
    }

    const { data: existingSessions } = await supabase
      .from('sessions')
      .select('session_date, start_time')
      .eq('class_id', id)
      .gte('session_date', from)
      .lte('session_date', to);

    const existingSet = new Set(
      (existingSessions || []).map(
        (s: { session_date: string; start_time: string }) =>
          `${s.session_date}|${normalizeTime(s.start_time)}`,
      ),
    );

    const plan = buildSessionGenerationPlan({
      orgId: c.get('orgId'),
      classId: id,
      from,
      to,
      includeUnassigned: includeUnassignedValue,
      schedules: (schedules || []).map((schedule) => ({
        id: schedule.id as string,
        weekday: schedule.weekday as number,
        startTime: schedule.start_time as string,
        endTime: schedule.end_time as string,
        teacherId: (schedule.teacher_id as string | null) ?? null,
        teacherName: (schedule.staff as { display_name: string } | null)?.display_name,
        effectiveFrom: schedule.effective_from as string,
        effectiveTo: (schedule.effective_to as string | null) ?? null,
      })),
      existingKeys: existingSet,
      excludeDates: excludeSet,
    });

    return c.json({ data: plan.preview }, 200);
  },
);

// POST /api/classes/:id/sessions/generate
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/sessions/generate',
    tags: ['Classes'],
    summary: '批次建立課堂',
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              from: z.string(),
              to: z.string(),
              excludeDates: z.array(z.string()).optional(),
              includeUnassigned: z.boolean().optional(),
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
            schema: GenerateSessionsResponseSchema,
          },
        },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '班級或課程已停用',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: {
        description: '參數錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const { from, to, excludeDates, includeUnassigned } = c.req.valid('json');

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
      return c.json({ error: '無效日期格式', code: 'INVALID_DATE' }, 400);
    }

    const excludeSet = new Set(excludeDates ?? []);
    const includeUnassignedValue = includeUnassigned ?? true;

    const { data: cls, error: clsError } = await supabase
      .from('classes')
      .select('id, is_active, courses(id, is_active)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (clsError) {
      return c.json({ error: clsError.message, code: 'DB_ERROR' }, 400);
    }
    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }
    if (!(cls.is_active as boolean)) {
      return c.json({ error: '班級已停用，無法新增未來課程排程', code: 'CLASS_INACTIVE' }, 409);
    }
    const linkedCourseRaw = cls.courses as
      | { id?: string; is_active?: boolean | null }
      | Array<{ id?: string; is_active?: boolean | null }>
      | null;
    const linkedCourse = Array.isArray(linkedCourseRaw) ? linkedCourseRaw[0] : linkedCourseRaw;
    if (linkedCourse && linkedCourse.is_active === false) {
      return c.json({ error: '課程已停用，無法新增未來課程排程', code: 'COURSE_INACTIVE' }, 409);
    }

    const { data: schedules } = await supabase.from('schedules').select('*').eq('class_id', id);

    if (!schedules || schedules.length === 0) {
      return c.json(
        {
          createdAssigned: 0,
          createdUnassigned: 0,
          skippedExisting: 0,
          skippedNoTeacher: 0,
          totalPlanned: 0,
        },
        200,
      );
    }

    const { data: existingSessions } = await supabase
      .from('sessions')
      .select('session_date, start_time')
      .eq('class_id', id)
      .gte('session_date', from)
      .lte('session_date', to);

    const existingSet = new Set(
      (existingSessions || []).map(
        (s: { session_date: string; start_time: string }) =>
          `${s.session_date}|${normalizeTime(s.start_time)}`,
      ),
    );

    const plan = buildSessionGenerationPlan({
      orgId,
      classId: id,
      createdBy: userId,
      from,
      to,
      includeUnassigned: includeUnassignedValue,
      schedules: schedules.map((schedule) => ({
        id: schedule.id as string,
        weekday: schedule.weekday as number,
        startTime: schedule.start_time as string,
        endTime: schedule.end_time as string,
        teacherId: (schedule.teacher_id as string | null) ?? null,
        effectiveFrom: schedule.effective_from as string,
        effectiveTo: (schedule.effective_to as string | null) ?? null,
      })),
      existingKeys: existingSet,
      excludeDates: excludeSet,
    });

    if (plan.toInsert.length === 0) {
      return c.json(plan.summary, 200);
    }

    // upsert with ignoreDuplicates to skip existing sessions
    const { data: inserted, error } = await supabase
      .from('sessions')
      .upsert(plan.toInsert, {
        onConflict: 'class_id,session_date,start_time',
        ignoreDuplicates: true,
      })
      .select('id, assignment_status');

    if (error) {
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    const insertedRows = inserted ?? [];
    const createdAssigned = insertedRows.filter(
      (row) => row.assignment_status === 'assigned',
    ).length;
    const createdUnassigned = insertedRows.filter(
      (row) => row.assignment_status === 'unassigned',
    ).length;
    const raceConditionSkipped = plan.toInsert.length - insertedRows.length;

    return c.json(
      {
        createdAssigned,
        createdUnassigned,
        skippedExisting: plan.summary.skippedExisting + raceConditionSkipped,
        skippedNoTeacher: plan.summary.skippedNoTeacher,
        totalPlanned: plan.summary.totalPlanned,
      },
      200,
    );
  },
);

// PATCH /api/classes/:id/sessions/batch-assign-teacher
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/sessions/batch-assign-teacher',
    tags: ['Classes'],
    summary: '批次指派班級課堂老師（單班級）',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: BatchAssignBodySchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({
              updated: z.number(),
              skippedConflicts: z.number(),
              skippedNotEligible: z.number(),
              conflicts: z.array(BatchAssignConflictSchema),
              dryRun: z.boolean(),
            }),
          },
        },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: '教師時段衝突（strict 模式）',
        content: {
          'application/json': {
            schema: z.object({
              error: z.string(),
              code: z.string(),
              updated: z.number(),
              skippedConflicts: z.number(),
              skippedNotEligible: z.number(),
              conflicts: z.array(BatchAssignConflictSchema),
              dryRun: z.boolean(),
            }),
          },
        },
      },
      400: {
        description: '參數或資料錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const fromDate = new Date(body.from);
    const toDate = new Date(body.to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
      return c.json({ error: '無效日期格式', code: 'INVALID_DATE_RANGE' }, 400);
    }

    const weekdaySet = new Set(body.weekday ?? []);
    const timeRanges = (body.timeRanges ?? []).map((range) => ({
      startTime: normalizeTime(range.startTime),
      endTime: normalizeTime(range.endTime),
    }));

    const { data: cls } = await supabase
      .from('classes')
      .select('id, name, courses(name), campuses(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data: classSessions, error: classSessionsError } = await supabase
      .from('sessions')
      .select('id, session_date, start_time, end_time, status, assignment_status, teacher_id')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .gte('session_date', body.from)
      .lte('session_date', body.to);

    if (classSessionsError) {
      return c.json({ error: classSessionsError.message, code: 'DB_ERROR' }, 400);
    }

    const filteredSessions = (classSessions || []).filter((session) => {
      const sessionDate = session.session_date as string;
      const sessionStart = normalizeTime(session.start_time as string);
      const sessionEnd = normalizeTime(session.end_time as string);

      if (weekdaySet.size > 0 && !weekdaySet.has(toWeekdayFromString(sessionDate))) {
        return false;
      }

      if (timeRanges.length === 0) return true;
      return timeRanges.some((range) =>
        isTimeOverlap(sessionStart, sessionEnd, range.startTime, range.endTime),
      );
    });

    const { data: teacherBusySessions, error: teacherBusyError } = await supabase
      .from('sessions')
      .select('id, session_date, start_time, end_time')
      .eq('org_id', orgId)
      .eq('teacher_id', body.toTeacherId)
      .eq('status', 'scheduled')
      .gte('session_date', body.from)
      .lte('session_date', body.to);

    if (teacherBusyError) {
      return c.json({ error: teacherBusyError.message, code: 'DB_ERROR' }, 400);
    }

    const mode = body.mode as BatchAssignMode;
    const dryRun = body.dryRun ?? false;
    const plan = planBatchAssign({
      mode,
      includeAssigned: body.includeAssigned ?? false,
      targetSessions: filteredSessions.map((session) => ({
        id: session.id as string,
        sessionDate: session.session_date as string,
        startTime: normalizeTime(session.start_time as string),
        endTime: normalizeTime(session.end_time as string),
        status: session.status as 'scheduled' | 'completed' | 'cancelled',
        assignmentStatus:
          (session.assignment_status as 'assigned' | 'unassigned' | null) ??
          deriveAssignmentStatus((session.teacher_id as string | null) ?? null),
      })),
      teacherBusySlots: (teacherBusySessions || []).map((session) => ({
        sessionId: session.id as string,
        sessionDate: session.session_date as string,
        startTime: normalizeTime(session.start_time as string),
        endTime: normalizeTime(session.end_time as string),
      })),
    });

    if (!dryRun && mode === 'strict' && plan.conflicts.length > 0) {
      return c.json(
        {
          error: '老師時段衝突，未執行更新',
          code: 'TEACHER_CONFLICT',
          updated: 0,
          skippedConflicts: plan.skippedConflicts,
          skippedNotEligible: plan.skippedNotEligible,
          conflicts: plan.conflicts,
          dryRun: false,
        },
        409,
      );
    }

    if (!dryRun && plan.updatedIds.length > 0) {
      const { error: updateError } = await supabase
        .from('sessions')
        .update({ teacher_id: body.toTeacherId, assignment_status: 'assigned' })
        .in('id', plan.updatedIds);

      if (updateError) {
        return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
      }

      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'class',
          resourceId: id,
          resourceName: classAuditResourceName(cls as Record<string, unknown>),
          action: 'batch_assign_teacher',
          details: {
            from: body.from,
            to: body.to,
            mode,
            updated: plan.updatedIds.length,
            skippedConflicts: plan.skippedConflicts,
            skippedNotEligible: plan.skippedNotEligible,
          },
        },
        c.executionCtx.waitUntil.bind(c.executionCtx),
      );
    }

    return c.json(
      {
        updated: plan.updatedIds.length,
        skippedConflicts: plan.skippedConflicts,
        skippedNotEligible: plan.skippedNotEligible,
        conflicts: plan.conflicts,
        dryRun,
      },
      200,
    );
  },
);

// PATCH /api/classes/:id/sessions/batch-update-time
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/sessions/batch-update-time',
    tags: ['Classes'],
    summary: '批次修改課堂時間（固定略過衝突）',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: BatchUpdateSessionTimeBodySchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: BatchSessionActionResponseSchema } },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: {
        description: '參數或資料錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const uniqueSessionIds = [...new Set(body.sessionIds)];
    const dryRun = body.dryRun ?? true;
    const newStartTime = normalizeTime(body.startTime);
    const newEndTime = normalizeTime(body.endTime);

    if (toMinutes(newStartTime) >= toMinutes(newEndTime)) {
      return c.json({ error: '開始時間需早於結束時間', code: 'INVALID_TIME_RANGE' }, 400);
    }

    const { data: cls } = await supabase
      .from('classes')
      .select('id, name, courses(name), campuses(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data: sessionRows, error: sessionRowsError } = await supabase
      .from('sessions')
      .select('id, session_date, start_time, end_time, status, teacher_id')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .in('id', uniqueSessionIds);

    if (sessionRowsError) {
      return c.json({ error: sessionRowsError.message, code: 'DB_ERROR' }, 400);
    }

    const targetSessions = (sessionRows ?? []) as Array<{
      id: string;
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
    const targetTeacherIds = [
      ...new Set(
        targetSessions
          .map((session) => session.teacher_id)
          .filter((teacherId): teacherId is string => !!teacherId),
      ),
    ];

    const { data: classDateSessions, error: classDateSessionsError } = await supabase
      .from('sessions')
      .select('id, session_date, start_time, end_time, status, teacher_id')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .eq('status', 'scheduled')
      .in('session_date', targetDates);

    if (classDateSessionsError) {
      return c.json({ error: classDateSessionsError.message, code: 'DB_ERROR' }, 400);
    }

    const teacherDateSessionsResult =
      targetTeacherIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from('sessions')
            .select('id, session_date, start_time, end_time, status, teacher_id')
            .eq('org_id', orgId)
            .eq('status', 'scheduled')
            .in('teacher_id', targetTeacherIds)
            .in('session_date', targetDates);

    if (teacherDateSessionsResult.error) {
      return c.json({ error: teacherDateSessionsResult.error.message, code: 'DB_ERROR' }, 400);
    }

    const classPeers = (classDateSessions ?? []) as Array<{
      id: string;
      session_date: string;
      start_time: string;
      end_time: string;
    }>;
    const teacherPeers = (teacherDateSessionsResult.data ?? []) as Array<{
      id: string;
      session_date: string;
      start_time: string;
      end_time: string;
      teacher_id: string | null;
    }>;

    const conflicts: BatchSessionConflictItem[] = [];
    const processableIds: string[] = [];

    for (const target of targetSessions) {
      if (target.status !== 'scheduled') {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'status_not_editable',
          detail: '僅可修改狀態為「scheduled」的課堂',
        });
        continue;
      }

      const classConflict = classPeers.find(
        (peer) =>
          peer.id !== target.id &&
          peer.session_date === target.session_date &&
          isTimeOverlap(newStartTime, newEndTime, normalizeTime(peer.start_time), normalizeTime(peer.end_time)),
      );

      if (classConflict) {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'class_conflict',
          detail: '同班級於此時段已有課堂',
          conflictingSessionId: classConflict.id,
        });
        continue;
      }

      if (target.teacher_id) {
        const teacherConflict = teacherPeers.find(
          (peer) =>
            peer.id !== target.id &&
            peer.teacher_id === target.teacher_id &&
            peer.session_date === target.session_date &&
            isTimeOverlap(newStartTime, newEndTime, normalizeTime(peer.start_time), normalizeTime(peer.end_time)),
        );

        if (teacherConflict) {
          conflicts.push({
            sessionId: target.id,
            sessionDate: target.session_date,
            reason: 'teacher_conflict',
            detail: '老師於此時段已有其他課堂',
            conflictingSessionId: teacherConflict.id,
          });
          continue;
        }
      }

      processableIds.push(target.id);
    }

    const missingCount = uniqueSessionIds.length - targetSessions.length;
    const updated = processableIds.length;
    const skipped = conflicts.length + missingCount;

    if (!dryRun && updated > 0) {
      const { error: updateError } = await supabase
        .from('sessions')
        .update({ start_time: newStartTime, end_time: newEndTime })
        .eq('org_id', orgId)
        .eq('class_id', id)
        .in('id', processableIds);

      if (updateError) {
        return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
      }

      const targetSessionDateMap = new Map(
        targetSessions.map((session) => [session.id, session.session_date]),
      );

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle();

      const { error: insertChangeError } = await supabase.from('schedule_changes').insert(
        processableIds.map((sessionId) => ({
          org_id: orgId,
          session_id: sessionId,
          change_type: 'reschedule',
          new_session_date: targetSessionDateMap.get(sessionId) ?? null,
          new_start_time: newStartTime,
          new_end_time: newEndTime,
          reason: '批次改時間',
          created_by_name: profile?.display_name ?? null,
        })),
      );

      if (insertChangeError) {
        return c.json({ error: insertChangeError.message, code: 'DB_ERROR' }, 400);
      }

      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'class',
          resourceId: id,
          resourceName: classAuditResourceName(cls as Record<string, unknown>),
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
  },
);

// PATCH /api/classes/:id/sessions/batch-cancel
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/sessions/batch-cancel',
    tags: ['Classes'],
    summary: '批次停課（固定略過不可停課項目）',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: BatchCancelSessionsBodySchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: BatchSessionActionResponseSchema } },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: {
        description: '參數或資料錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const uniqueSessionIds = [...new Set(body.sessionIds)];
    const dryRun = body.dryRun ?? true;

    const { data: cls } = await supabase
      .from('classes')
      .select('id, name, courses(name), campuses(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data: sessionRows, error: sessionRowsError } = await supabase
      .from('sessions')
      .select('id, session_date, status')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .in('id', uniqueSessionIds);

    if (sessionRowsError) {
      return c.json({ error: sessionRowsError.message, code: 'DB_ERROR' }, 400);
    }

    const targetSessions = (sessionRows ?? []) as Array<{
      id: string;
      session_date: string;
      status: 'scheduled' | 'completed' | 'cancelled';
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
        .eq('class_id', id)
        .in('id', processableIds);

      if (cancelError) {
        return c.json({ error: cancelError.message, code: 'DB_ERROR' }, 400);
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
          change_type: 'cancellation',
          reason: '批次停課',
          created_by_name: profile?.display_name ?? null,
        })),
      );

      if (insertChangeError) {
        return c.json({ error: insertChangeError.message, code: 'DB_ERROR' }, 400);
      }

      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'class',
          resourceId: id,
          resourceName: classAuditResourceName(cls as Record<string, unknown>),
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
  },
);

// PATCH /api/classes/:id/sessions/batch-uncancel
app.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/sessions/batch-uncancel',
    tags: ['Classes'],
    summary: '批次取消停課（恢復為已排定，固定略過衝突）',
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: BatchCancelSessionsBodySchema } } },
    },
    responses: {
      200: {
        description: '成功',
        content: { 'application/json': { schema: BatchSessionActionResponseSchema } },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      400: {
        description: '參數或資料錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const uniqueSessionIds = [...new Set(body.sessionIds)];
    const dryRun = body.dryRun ?? true;

    const { data: cls } = await supabase
      .from('classes')
      .select('id, name, courses(name), campuses(name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const { data: sessionRows, error: sessionRowsError } = await supabase
      .from('sessions')
      .select('id, class_id, session_date, start_time, end_time, status, teacher_id')
      .eq('org_id', orgId)
      .eq('class_id', id)
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
    const targetTeacherIds = [
      ...new Set(
        targetSessions
          .map((session) => session.teacher_id)
          .filter((teacherId): teacherId is string => !!teacherId),
      ),
    ];

    const { data: classDateSessions, error: classDateSessionsError } = await supabase
      .from('sessions')
      .select('id, class_id, session_date, start_time, end_time, status, teacher_id')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .eq('status', 'scheduled')
      .in('session_date', targetDates);

    if (classDateSessionsError) {
      return c.json({ error: classDateSessionsError.message, code: 'DB_ERROR' }, 400);
    }

    const teacherDateSessionsResult =
      targetTeacherIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from('sessions')
            .select('id, session_date, start_time, end_time, status, teacher_id')
            .eq('org_id', orgId)
            .eq('status', 'scheduled')
            .in('teacher_id', targetTeacherIds)
            .in('session_date', targetDates);

    if (teacherDateSessionsResult.error) {
      return c.json({ error: teacherDateSessionsResult.error.message, code: 'DB_ERROR' }, 400);
    }

    const classPeers = (classDateSessions ?? []) as Array<{
      id: string;
      session_date: string;
      start_time: string;
      end_time: string;
    }>;
    const teacherPeers = (teacherDateSessionsResult.data ?? []) as Array<{
      id: string;
      session_date: string;
      start_time: string;
      end_time: string;
      teacher_id: string | null;
    }>;

    const conflicts: BatchSessionConflictItem[] = [];
    const processableIds: string[] = [];

    for (const target of targetSessions) {
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

      const classConflict = classPeers.find(
        (peer) =>
          peer.session_date === target.session_date &&
          isTimeOverlap(
            targetStart,
            targetEnd,
            normalizeTime(peer.start_time),
            normalizeTime(peer.end_time),
          ),
      );

      if (classConflict) {
        conflicts.push({
          sessionId: target.id,
          sessionDate: target.session_date,
          reason: 'class_conflict',
          detail: '同班級於此時段已有課堂',
          conflictingSessionId: classConflict.id,
        });
        continue;
      }

      if (target.teacher_id) {
        const teacherConflict = teacherPeers.find(
          (peer) =>
            peer.teacher_id === target.teacher_id &&
            peer.session_date === target.session_date &&
            isTimeOverlap(
              targetStart,
              targetEnd,
              normalizeTime(peer.start_time),
              normalizeTime(peer.end_time),
            ),
        );

        if (teacherConflict) {
          conflicts.push({
            sessionId: target.id,
            sessionDate: target.session_date,
            reason: 'teacher_conflict',
            detail: '老師於此時段已有其他課堂',
            conflictingSessionId: teacherConflict.id,
          });
          continue;
        }
      }

      processableIds.push(target.id);
    }

    const missingCount = uniqueSessionIds.length - targetSessions.length;
    const updated = processableIds.length;
    const skipped = conflicts.length + missingCount;

    if (!dryRun && updated > 0) {
      const { error: reopenError } = await supabase
        .from('sessions')
        .update({ status: 'scheduled' })
        .eq('org_id', orgId)
        .eq('class_id', id)
        .in('id', processableIds);

      if (reopenError) {
        return c.json({ error: reopenError.message, code: 'DB_ERROR' }, 400);
      }

      logAudit(
        supabase,
        {
          orgId,
          userId,
          resourceType: 'class',
          resourceId: id,
          resourceName: classAuditResourceName(cls as Record<string, unknown>),
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
  },
);

// POST /api/classes/:id/cancel-future-sessions
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel-future-sessions',
    tags: ['Classes'],
    summary: '取消此班級所有未來課堂排程（軟刪除，保留 schedule_change 紀錄）',
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': {
            schema: z.object({ cancelled: z.number() }),
          },
        },
      },
      400: {
        description: '操作失敗',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: '班級不存在',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');

    // 確認班級存在
    const { data: cls } = await supabase.from('classes').select('id').eq('id', id).single();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const today = new Date().toISOString().split('T')[0];

    // 查出要取消的課堂 IDs
    const { data: targetSessions, error: fetchError } = await supabase
      .from('sessions')
      .select('id')
      .eq('org_id', orgId)
      .eq('class_id', id)
      .gte('session_date', today)
      .neq('status', 'completed');

    if (fetchError) {
      return c.json({ error: fetchError.message, code: 'DB_ERROR' }, 400);
    }

    const sessionIds = (targetSessions ?? []).map((r) => r['id'] as string);

    if (sessionIds.length > 0) {
      // 軟刪除：更新狀態為 cancelled
      const { error: updateError } = await supabase
        .from('sessions')
        .update({ status: 'cancelled' })
        .in('id', sessionIds);

      if (updateError) {
        return c.json({ error: updateError.message, code: 'DB_ERROR' }, 400);
      }

      // 取得操作者名稱
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle();

      // 為每堂課建立 schedule_change 紀錄
      const changeRecords = sessionIds.map((sessionId) => ({
        org_id: orgId,
        session_id: sessionId,
        change_type: 'cancellation',
        reason: '班級停用',
        created_by_name: profile?.display_name ?? null,
      }));

      const { error: insertError } = await supabase
        .from('schedule_changes')
        .insert(changeRecords);

      if (insertError) {
        return c.json({ error: insertError.message, code: 'DB_ERROR' }, 400);
      }
    }

    return c.json({ cancelled: sessionIds.length }, 200);
  },
);

export default app;
