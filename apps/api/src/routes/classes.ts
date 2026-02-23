import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';

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
    effectiveFrom: z.string(),
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
    gradeLevels: z.array(z.string()).optional(),
    nextClassId: z.uuid().nullable().optional(),
  })
  .openapi('CreateClass');

const UpdateClassSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    maxStudents: z.number().int().min(1).max(200).optional(),
    gradeLevels: z.array(z.string()).optional(),
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
    effectiveFrom: z.string(),
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
  })
  .openapi('SessionPreview');

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
        effectiveFrom: z.string(),
        effectiveTo: z.string().nullable().optional(),
      })
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
    effectiveFrom: row['effective_from'] as string,
    effectiveTo: (row['effective_to'] as string | null) ?? null,
  };
}

interface ClassExtras {
  schedules?: unknown[];
  scheduleCount?: number;
  scheduleTeacherIds?: string[];
  hasUpcomingSessions?: boolean;
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
    schedules: extras?.schedules?.map((s) => mapSchedule(s as Record<string, unknown>)),
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    updatedBy: (row['updated_by'] as string | null) ?? null,
    updatedByName: extras?.updatedByName ?? null,
  };
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
    const page = parseInt(query.page || '1');
    const pageSize = parseInt(query.pageSize || '50');
    const offset = (page - 1) * pageSize;

    let dbQuery = supabase.from('classes').select('*, courses(name)', { count: 'exact' });

    if (query.search) dbQuery = dbQuery.ilike('name', `%${query.search}%`);
    if (query.campusId) dbQuery = dbQuery.eq('campus_id', query.campusId);
    if (query.courseId) dbQuery = dbQuery.eq('course_id', query.courseId);
    if (query.isActive !== undefined) dbQuery = dbQuery.eq('is_active', query.isActive === 'true');

    dbQuery = dbQuery
      .range(offset, offset + pageSize - 1)
      .order('created_at', { ascending: false });

    const { data, count, error } = await dbQuery;
    if (error) console.error('DB Error:', error);

    const rows = data || [];
    const classIds = rows.map((r) => r.id as string);

    // Batch-fetch schedule counts & teacher IDs for this page
    const scheduleCountMap: Record<string, number> = {};
    const scheduleTeacherMap: Record<string, string[]> = {};
    const hasUpcomingSet = new Set<string>();

    if (classIds.length > 0) {
      const [schedulesResult, sessionsResult] = await Promise.all([
        supabase.from('schedules').select('class_id, teacher_id').in('class_id', classIds),
        supabase
          .from('sessions')
          .select('class_id')
          .in('class_id', classIds)
          .gte('session_date', new Date().toISOString().split('T')[0])
          .eq('status', 'scheduled'),
      ]);

      for (const s of schedulesResult.data || []) {
        const cid = s.class_id as string;
        scheduleCountMap[cid] = (scheduleCountMap[cid] ?? 0) + 1;
        if (s.teacher_id) {
          scheduleTeacherMap[cid] = scheduleTeacherMap[cid] ?? [];
          scheduleTeacherMap[cid].push(s.teacher_id as string);
        }
      }

      for (const s of sessionsResult.data || []) {
        hasUpcomingSet.add(s.class_id as string);
      }
    }

    return c.json({
      data: rows.map((r) => {
        const id = r.id as string;
        return mapClass(r as Record<string, unknown>, {
          scheduleCount: scheduleCountMap[id] ?? 0,
          scheduleTeacherIds: scheduleTeacherMap[id] ?? [],
          hasUpcomingSessions: hasUpcomingSet.has(id),
        });
      }),
      meta: {
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  }
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
    const { data: orgClasses } = await supabase
      .from('classes')
      .select('id')
      .eq('org_id', orgId);
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
        const sFrom = s.effectiveFrom;
        const sTo = s.effectiveTo ?? null;
        const eFrom = existing.effective_from as string;
        const eTo = (existing.effective_to as string | null) ?? null;
        if (sTo && sTo < eFrom) continue;
        if (eTo && eTo < sFrom) continue;

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
  }
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

    logAudit(supabase, {
      orgId,
      userId,
      resourceType: 'class',
      action: isActive ? 'batch_activate' : 'batch_deactivate',
      details: { count: ids.length },
    }, c.executionCtx.waitUntil.bind(c.executionCtx));

    return c.json({ updated: data?.length ?? 0 }, 200);
  }
);

// DELETE /api/classes/batch
app.openapi(
  createRoute({
    method: 'delete',
    path: '/batch',
    tags: ['Classes'],
    summary: '批次刪除班級（有 sessions 的略過）',
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

    // 查哪些班級有 sessions（有的不能刪）
    const { data: withSessions } = await supabase
      .from('sessions')
      .select('class_id')
      .in('class_id', ids);

    const hasSessionsSet = new Set((withSessions || []).map((s) => s.class_id as string));
    const toDeleteIds = ids.filter((id) => !hasSessionsSet.has(id));
    const skipped = ids.length - toDeleteIds.length;

    if (toDeleteIds.length === 0) {
      return c.json({ deleted: 0, deletedIds: [], skipped }, 200);
    }

    const { error } = await supabase.from('classes').delete().in('id', toDeleteIds);
    if (error) return c.json({ deleted: 0, deletedIds: [], skipped }, 200);

    logAudit(supabase, {
      orgId,
      userId,
      resourceType: 'class',
      action: 'batch_delete',
      details: { count: toDeleteIds.length },
    }, c.executionCtx.waitUntil.bind(c.executionCtx));

    return c.json({ deleted: toDeleteIds.length, deletedIds: toDeleteIds, skipped }, 200);
  }
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
      supabase.from('classes').select('*, courses(name)').eq('id', id).single(),
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
      200
    );
  }
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

    // 從 course 取得 campus_id
    const { data: course } = await supabase
      .from('courses')
      .select('campus_id')
      .eq('id', body.courseId)
      .single();

    if (!course) {
      return c.json({ error: '課程不存在', code: 'COURSE_NOT_FOUND' }, 400);
    }

    const { data, error } = await supabase
      .from('classes')
      .insert({
        org_id: orgId,
        campus_id: course.campus_id,
        course_id: body.courseId,
        name: body.name,
        max_students: body.maxStudents ?? 20,
        grade_levels: body.gradeLevels ?? [],
        next_class_id: body.nextClassId ?? null,
        updated_by: userId,
      })
      .select('*, courses(name)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return c.json({ error: '此分校已有同名班級', code: 'DUPLICATE' }, 409);
      }
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    logAudit(supabase, {
      orgId,
      userId,
      resourceType: 'class',
      resourceId: data.id as string,
      resourceName: data.name as string,
      action: 'create',
    }, c.executionCtx.waitUntil.bind(c.executionCtx));

    return c.json({ data: mapClass(data as Record<string, unknown>, {}) }, 201);
  }
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
    if (body.gradeLevels !== undefined) updateData['grade_levels'] = body.gradeLevels;
    if (body.nextClassId !== undefined) updateData['next_class_id'] = body.nextClassId;
    if (body.isActive !== undefined) updateData['is_active'] = body.isActive;

    const { data, error } = await supabase
      .from('classes')
      .update(updateData)
      .eq('id', id)
      .select('*, courses(name)')
      .single();

    if (error || !data) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    logAudit(supabase, {
      orgId: c.get('orgId'),
      userId,
      resourceType: 'class',
      resourceId: id,
      resourceName: data.name as string,
      action: 'update',
    }, c.executionCtx.waitUntil.bind(c.executionCtx));

    return c.json({ data: mapClass(data as Record<string, unknown>, {}) }, 200);
  }
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
      .select('*, courses(name)')
      .single();

    if (error || !data) {
      return c.json({ error: '更新失敗', code: 'UPDATE_FAILED' }, 404);
    }

    logAudit(supabase, {
      orgId: c.get('orgId'),
      userId,
      resourceType: 'class',
      resourceId: id,
      resourceName: data.name as string,
      action: 'toggle_active',
      details: { isActive: !current.is_active },
    }, c.executionCtx.waitUntil.bind(c.executionCtx));

    return c.json({ data: mapClass(data as Record<string, unknown>, {}) }, 200);
  }
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

    const { count } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', id);

    if (count && count > 0) {
      return c.json(
        { error: `此班級已有 ${count} 筆課堂記錄，無法刪除`, code: 'HAS_SESSIONS' },
        409
      );
    }

    const { data: existing } = await supabase
      .from('classes')
      .select('name')
      .eq('id', id)
      .single();

    const { error } = await supabase.from('classes').delete().eq('id', id);
    if (error) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    logAudit(supabase, {
      orgId,
      userId,
      resourceType: 'class',
      resourceId: id,
      resourceName: existing?.name ?? null,
      action: 'delete',
    }, c.executionCtx.waitUntil.bind(c.executionCtx));

    return c.json({ success: true }, 200);
  }
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

    const { data: cls } = await supabase.from('classes').select('name').eq('id', id).single();

    const { data, error } = await supabase
      .from('schedules')
      .insert({
        class_id: id,
        weekday: body.weekday,
        start_time: body.startTime,
        end_time: body.endTime,
        teacher_id: body.teacherId ?? null,
        effective_from: body.effectiveFrom,
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

    logAudit(supabase, {
      orgId,
      userId,
      resourceType: 'class',
      resourceId: id,
      resourceName: cls?.name ?? null,
      action: 'add_schedule',
      details: { weekday: body.weekday, startTime: body.startTime, endTime: body.endTime },
    }, c.executionCtx.waitUntil.bind(c.executionCtx));

    return c.json({ data: mapSchedule(data as Record<string, unknown>) }, 201);
  }
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
    if (body.effectiveFrom !== undefined) updateData['effective_from'] = body.effectiveFrom;
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
  }
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

    const { data: cls } = await supabase.from('classes').select('name').eq('id', id).single();

    const { error } = await supabase
      .from('schedules')
      .delete()
      .eq('id', sid)
      .eq('class_id', id);

    if (error) {
      return c.json({ error: '時段不存在', code: 'NOT_FOUND' }, 404);
    }

    logAudit(supabase, {
      orgId,
      userId,
      resourceType: 'class',
      resourceId: id,
      resourceName: cls?.name ?? null,
      action: 'delete_schedule',
    }, c.executionCtx.waitUntil.bind(c.executionCtx));

    return c.json({ success: true }, 200);
  }
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
      query: z.object({ from: z.string(), to: z.string(), excludeDates: z.string().optional() }),
    },
    responses: {
      200: {
        description: '成功',
        content: {
          'application/json': { schema: z.object({ data: z.array(SessionPreviewSchema) }) },
        },
      },
      400: {
        description: '參數錯誤',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const { id } = c.req.valid('param');
    const { from, to, excludeDates } = c.req.valid('query');

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return c.json({ error: '無效日期格式', code: 'INVALID_DATE' }, 400);
    }

    const excludeSet = new Set(excludeDates ? excludeDates.split(',').filter(Boolean) : []);

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
        (s: { session_date: string; start_time: string }) => `${s.session_date}|${s.start_time}`
      )
    );

    const previews: Array<{
      sessionDate: string;
      startTime: string;
      endTime: string;
      teacherId: string | null;
      teacherName?: string;
      weekday: number;
      exists: boolean;
    }> = [];

    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const isoDate = cursor.toISOString().split('T')[0];
      // JS getDay(): 0=Sun, 1=Mon...6=Sat → 我們: 1=Mon...7=Sun
      const jsDay = cursor.getDay();
      const weekday = jsDay === 0 ? 7 : jsDay;

      if (excludeSet.has(isoDate)) {
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }

      for (const schedule of schedules) {
        if (schedule.weekday !== weekday) continue;

        const effFrom = new Date(schedule.effective_from);
        const effTo = schedule.effective_to ? new Date(schedule.effective_to) : null;

        if (cursor < effFrom) continue;
        if (effTo && cursor > effTo) continue;

        previews.push({
          sessionDate: isoDate,
          startTime: schedule.start_time,
          endTime: schedule.end_time,
          teacherId: schedule.teacher_id,
          teacherName: (schedule.staff as { display_name: string } | null)?.display_name,
          weekday,
          exists: existingSet.has(`${isoDate}|${schedule.start_time}`),
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    previews.sort(
      (a, b) =>
        a.sessionDate.localeCompare(b.sessionDate) || a.startTime.localeCompare(b.startTime)
    );

    return c.json({ data: previews }, 200);
  }
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
            schema: z.object({ created: z.number(), skipped: z.number() }),
          },
        },
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
    const { from, to, excludeDates } = c.req.valid('json');

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return c.json({ error: '無效日期格式', code: 'INVALID_DATE' }, 400);
    }

    const excludeSet = new Set(excludeDates ?? []);

    const { data: schedules } = await supabase.from('schedules').select('*').eq('class_id', id);

    if (!schedules || schedules.length === 0) {
      return c.json({ created: 0, skipped: 0 }, 200);
    }

    const toInsert: Array<{
      org_id: string;
      class_id: string;
      schedule_id: string;
      session_date: string;
      start_time: string;
      end_time: string;
      teacher_id: string; // sessions require a teacher; schedules without teacher are skipped
      status: string;
    }> = [];

    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const isoDate = cursor.toISOString().split('T')[0];
      const jsDay = cursor.getDay();
      const weekday = jsDay === 0 ? 7 : jsDay;

      if (excludeSet.has(isoDate)) {
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }

      for (const schedule of schedules) {
        if (schedule.weekday !== weekday) continue;
        if (!schedule.teacher_id) continue; // skip schedules without a teacher

        const effFrom = new Date(schedule.effective_from);
        const effTo = schedule.effective_to ? new Date(schedule.effective_to) : null;

        if (cursor < effFrom) continue;
        if (effTo && cursor > effTo) continue;

        toInsert.push({
          org_id: orgId,
          class_id: id,
          schedule_id: schedule.id,
          session_date: isoDate,
          start_time: schedule.start_time,
          end_time: schedule.end_time,
          teacher_id: schedule.teacher_id,
          status: 'scheduled',
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    if (toInsert.length === 0) {
      return c.json({ created: 0, skipped: 0 }, 200);
    }

    // upsert with ignoreDuplicates to skip existing sessions
    const { data: inserted, error } = await supabase
      .from('sessions')
      .upsert(toInsert, { onConflict: 'class_id,session_date,start_time', ignoreDuplicates: true })
      .select('id');

    if (error) {
      return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
    }

    const created = inserted?.length ?? 0;
    const skipped = toInsert.length - created;

    return c.json({ created, skipped }, 200);
  }
);

// POST /api/classes/:id/cancel-future-sessions
app.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/cancel-future-sessions',
    tags: ['Classes'],
    summary: '取消此班級所有未來已排定的課堂',
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
    const { data: cls } = await supabase
      .from('classes')
      .select('id')
      .eq('id', id)
      .single();

    if (!cls) {
      return c.json({ error: '班級不存在', code: 'NOT_FOUND' }, 404);
    }

    const today = new Date().toISOString().split('T')[0];

    const { data: updated, error } = await supabase
      .from('sessions')
      .update({ status: 'cancelled' })
      .eq('class_id', id)
      .gte('session_date', today)
      .eq('status', 'scheduled')
      .select('id');

    if (error) {
      return c.json({ error: error.message, code: 'DB_ERROR' }, 404);
    }

    return c.json({ cancelled: updated?.length ?? 0 }, 200);
  }
);

export default app;
