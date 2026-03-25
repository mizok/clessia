import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { requireAdminMiddleware } from '../middleware/auth';
import type { AppEnv } from '../index';

// ============================================================
// Schemas
// ============================================================

const EnrollmentStatusSchema = z
  .enum(['pending_payment', 'active', 'suspended', 'withdrawal', 'void'])
  .openapi('EnrollmentStatus');

const PaymentCycleSchema = z.enum(['monthly', 'semester']).openapi('PaymentCycle');

const EnrollmentSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    classId: z.uuid(),
    className: z.string(),
    courseId: z.uuid(),
    courseName: z.string(),
    studentId: z.uuid(),
    studentName: z.string(),
    studentSchool: z.string(),
    studentGrade: z.string(),
    status: EnrollmentStatusSchema,
    paymentCycle: PaymentCycleSchema.nullable(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
    notes: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdByName: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    attendanceCount: z.number().int().min(0),
  })
  .openapi('Enrollment');

const EnrollmentListResponseSchema = z
  .object({
    data: z.array(EnrollmentSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('EnrollmentListResponse');

const CreateEnrollmentSchema = z
  .object({
    classId: z.uuid(),
    studentId: z.uuid(),
    status: z.enum(['pending_payment', 'active']).default('active'),
    paymentCycle: PaymentCycleSchema.optional(),
    effectiveFrom: z.string().date().optional(),
    effectiveTo: z.string().date().nullable().optional(),
    notes: z.string().max(2000).optional(),
  })
  .openapi('CreateEnrollment');

const UpdateEnrollmentSchema = z
  .object({
    paymentCycle: PaymentCycleSchema.nullable().optional(),
    effectiveFrom: z.string().date().optional(),
    effectiveTo: z.string().date().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .openapi('UpdateEnrollment');

const UpdateEnrollmentStatusSchema = z
  .object({
    status: EnrollmentStatusSchema,
    notes: z.string().max(2000).optional(),
  })
  .openapi('UpdateEnrollmentStatus');

const BatchCreateEnrollmentSchema = z
  .object({
    classId: z.uuid(),
    studentIds: z.array(z.uuid()).min(1).max(50),
  })
  .openapi('BatchCreateEnrollment');

const BatchCreateResultItemSchema = z.object({
  studentId: z.uuid(),
  status: z.enum(['enrolled', 'already_exists', 'error']),
  enrollmentId: z.uuid().optional(),
  message: z.string().optional(),
});

const BatchCreateResultSchema = z
  .object({ results: z.array(BatchCreateResultItemSchema) })
  .openapi('BatchCreateEnrollmentResult');

const BatchMatchBodySchema = z
  .object({
    classId: z.string().uuid(),
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          school: z.string().min(1),
        }),
      )
      .min(1)
      .max(200),
  })
  .openapi('BatchMatchBody');

const BatchMatchCandidateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    grade: z.string(),
    school: z.string(),
    birthday: z.string().nullable().optional(),
  })
  .openapi('BatchMatchCandidate');

const BatchMatchResultItemSchema = z
  .object({
    index: z.number(),
    status: z.enum(['matched', 'ambiguous', 'not_found', 'already_enrolled']),
    studentId: z.string().optional(),
    candidates: z.array(BatchMatchCandidateSchema).optional(),
  })
  .openapi('BatchMatchResultItem');

const BatchMatchResponseSchema = z
  .object({
    results: z.array(BatchMatchResultItemSchema),
  })
  .openapi('BatchMatchResponse');

const CopyFromClassBodySchema = z
  .object({
    targetClassId: z.uuid(),
    sourceClassId: z.uuid(),
    statuses: z
      .array(z.enum(['pending_payment', 'active', 'suspended', 'withdrawal', 'void']))
      .min(1),
  })
  .openapi('CopyFromClassBody');

const CopyFromClassResponseSchema = z
  .object({
    copied: z.number().int().min(0),
    skipped: z.number().int().min(0),
  })
  .openapi('CopyFromClassResponse');

// ============================================================
// Helper
// ============================================================

export function toEnrollmentResponse(row: any): z.infer<typeof EnrollmentSchema> {
  return {
    id: row.id,
    orgId: row.org_id,
    classId: row.class_id,
    className: row.classes?.name ?? '',
    courseId: row.classes?.courses?.id ?? '',
    courseName: row.classes?.courses?.name ?? '',
    studentId: row.student_id,
    studentName: row.students?.name ?? '',
    studentSchool: row.students?.school ?? '',
    studentGrade: row.students?.grade ?? '',
    status: row.status,
    paymentCycle: row.payment_cycle ?? null,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to ?? null,
    notes: row.notes ?? null,
    createdBy: row.created_by ?? null,
    createdByName: row.creator?.name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attendanceCount: row.attendances?.[0]?.count ?? 0,
  };
}

interface CopyFromClassStudentRow {
  student_id: string;
}

interface CopyFromClassPlan {
  sourceStudentIds: string[];
  toInsertStudentIds: string[];
  skipped: number;
}

interface CopyFromClassQuotaInput {
  currentActiveCount: number | null;
  maxStudents: number | null;
  toInsertCount: number;
}

export function buildCopyFromClassPlan(
  sourceEnrollments: ReadonlyArray<CopyFromClassStudentRow>,
  targetActiveEnrollments: ReadonlyArray<CopyFromClassStudentRow>,
): CopyFromClassPlan {
  const sourceStudentIds = Array.from(new Set(sourceEnrollments.map((row) => row.student_id)));
  const alreadyInSet = new Set(targetActiveEnrollments.map((row) => row.student_id));
  const toInsertStudentIds = sourceStudentIds.filter((studentId) => !alreadyInSet.has(studentId));

  return {
    sourceStudentIds,
    toInsertStudentIds,
    skipped: sourceStudentIds.length - toInsertStudentIds.length,
  };
}

export function isCopyFromClassOverQuota(input: CopyFromClassQuotaInput): boolean {
  const maxStudents = input.maxStudents ?? 9999;
  const currentActiveCount = input.currentActiveCount ?? 0;
  return currentActiveCount + input.toInsertCount > maxStudents;
}

// ============================================================
// Shared schemas
// ============================================================

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
  })
  .openapi('EnrollmentError');

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/enrollments
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Enrollments'],
    request: {
      query: z.object({
        classId: z.uuid().optional(),
        studentId: z.uuid().optional(),
        status: EnrollmentStatusSchema.optional(),
        page: z.coerce.number().int().min(1).default(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).default(20).optional(),
      }),
    },
    responses: {
      200: { content: { 'application/json': { schema: EnrollmentListResponseSchema } }, description: 'OK' },
      500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Internal Server Error' },
    },
  }),
  async (c) => {
    const { classId, studentId, status, page = 1, pageSize = 20 } = c.req.valid('query');
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');

    let query = supabase
      .from('enrollments')
      .select(
        'id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name, courses(id, name)), students(name, school, grade), creator:ba_user!created_by(name)',
        { count: 'exact' },
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (classId) query = query.eq('class_id', classId);
    if (studentId) query = query.eq('student_id', studentId);
    if (status) query = query.eq('status', status);

    const { data, count, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    const total = count ?? 0;
    return c.json({
      data: (data ?? []).map(toEnrollmentResponse),
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    }, 200);
  },
);

// POST /api/enrollments
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Enrollments'],
    request: { body: { content: { 'application/json': { schema: CreateEnrollmentSchema } } } },
    responses: {
      201: { content: { 'application/json': { schema: z.object({ data: EnrollmentSchema }) } }, description: 'Created' },
      400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
      409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Conflict' },
      500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Internal Server Error' },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const supabase = c.get('supabase');

    const { data, error } = await supabase
      .from('enrollments')
      .insert({
        org_id: orgId,
        class_id: body.classId,
        student_id: body.studentId,
        status: body.status ?? 'active',
        payment_cycle: body.paymentCycle ?? null,
        effective_from: body.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        effective_to: body.effectiveTo ?? null,
        notes: body.notes ?? null,
        created_by: userId,
      })
      .select('id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name, courses(id, name)), students(name, school, grade), creator:ba_user!created_by(name)')
      .single();

    if (error) {
      if (error.code === '23505') return c.json({ error: 'ALREADY_ENROLLED' }, 409);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ data: toEnrollmentResponse(data) }, 201);
  },
);

// PATCH /api/enrollments/:id
app.openapi(
  createRoute({
    method: 'patch',
    path: '/:id',
    tags: ['Enrollments'],
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateEnrollmentSchema } } },
    },
    responses: {
      200: { content: { 'application/json': { schema: z.object({ data: EnrollmentSchema }) } }, description: 'OK' },
      404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');

    const updates: Record<string, unknown> = {};
    if (body.paymentCycle !== undefined) updates['payment_cycle'] = body.paymentCycle;
    if (body.effectiveFrom !== undefined) updates['effective_from'] = body.effectiveFrom;
    if (body.effectiveTo !== undefined) updates['effective_to'] = body.effectiveTo;
    if (body.notes !== undefined) updates['notes'] = body.notes;

    const { data, error } = await supabase
      .from('enrollments')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name, courses(id, name)), students(name, school, grade), creator:ba_user!created_by(name)')
      .single();

    if (error) return c.json({ error: 'NOT_FOUND' }, 404);
    return c.json({ data: toEnrollmentResponse(data) }, 200);
  },
);

// PATCH /api/enrollments/:id/status
app.openapi(
  createRoute({
    method: 'patch',
    path: '/:id/status',
    tags: ['Enrollments'],
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { 'application/json': { schema: UpdateEnrollmentStatusSchema } } },
    },
    responses: {
      200: { content: { 'application/json': { schema: z.object({ data: EnrollmentSchema }) } }, description: 'OK' },
      400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
      404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
      500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Internal Server Error' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { status, notes } = c.req.valid('json');
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');

    if (['suspended', 'withdrawal', 'void'].includes(status) && !notes?.trim()) {
      return c.json({ error: 'NOTES_REQUIRED' }, 400);
    }

    const { data: existing } = await supabase
      .from('enrollments')
      .select('status')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!existing) return c.json({ error: 'NOT_FOUND' }, 404);

    if (['withdrawal', 'void'].includes(existing.status)) {
      return c.json({ error: 'TERMINAL_STATE' }, 400);
    }

    if (existing.status === 'pending_payment' && status === 'suspended') {
      return c.json({ error: 'INVALID_TRANSITION' }, 400);
    }

    const updates: Record<string, unknown> = { status };
    if (notes) updates['notes'] = notes;
    if (['withdrawal', 'void'].includes(status)) {
      updates['effective_to'] = new Date().toISOString().slice(0, 10);
    }

    const { data, error } = await supabase
      .from('enrollments')
      .update(updates)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name, courses(id, name)), students(name, school, grade), creator:ba_user!created_by(name)')
      .single();

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ data: toEnrollmentResponse(data) }, 200);
  },
);

// POST /api/enrollments/batch
app.openapi(
  createRoute({
    method: 'post',
    path: '/batch',
    tags: ['Enrollments'],
    request: { body: { content: { 'application/json': { schema: BatchCreateEnrollmentSchema } } } },
    responses: {
      200: { content: { 'application/json': { schema: BatchCreateResultSchema } }, description: 'OK' },
      400: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Bad Request (over_quota)',
      },
      404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Class not found' },
      500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Internal Server Error' },
    },
  }),
  async (c) => {
    const { classId, studentIds } = c.req.valid('json');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const supabase = c.get('supabase');
    const uniqueStudentIds = Array.from(new Set(studentIds));

    const { data: cls, error: classError } = await supabase
      .from('classes')
      .select('max_students')
      .eq('id', classId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (classError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);
    if (!cls) return c.json({ error: 'CLASS_NOT_FOUND' }, 404);

    const { count: activeCount, error: activeCountError } = await supabase
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('org_id', orgId)
      .in('status', ['active', 'pending_payment']);

    if (activeCountError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);

    const { count: alreadyInCount, error: alreadyInCountError } = await supabase
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('org_id', orgId)
      .in('status', ['active', 'pending_payment'])
      .in('student_id', uniqueStudentIds);

    if (alreadyInCountError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);

    const projectedNewCount = uniqueStudentIds.length - (alreadyInCount ?? 0);
    if ((activeCount ?? 0) + projectedNewCount > (cls.max_students ?? 9999)) {
      return c.json({ error: '人數已達上限', code: 'OVER_QUOTA' }, 400);
    }

    const today = new Date().toISOString().slice(0, 10);
    const results: z.infer<typeof BatchCreateResultItemSchema>[] = [];

    for (const studentId of uniqueStudentIds) {
      const { data, error } = await supabase
        .from('enrollments')
        .insert({
          org_id: orgId,
          class_id: classId,
          student_id: studentId,
          status: 'active',
          effective_from: today,
          created_by: userId,
        })
        .select('id')
        .single();

      if (error) {
        if (error.code === '23505') {
          results.push({ studentId, status: 'already_exists' });
        } else {
          results.push({ studentId, status: 'error', message: error.message });
        }
      } else {
        results.push({ studentId, status: 'enrolled', enrollmentId: data.id });
      }
    }

    return c.json({ results }, 200);
  },
);

// DELETE /api/enrollments/:id
app.openapi(
  createRoute({
    method: 'delete',
    path: '/:id',
    tags: ['Enrollments'],
    request: { params: z.object({ id: z.uuid() }) },
    responses: {
      204: { description: 'No Content' },
      400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad Request' },
      404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not Found' },
      409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Has attendance records' },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');

    const { data: existing } = await supabase
      .from('enrollments')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (!existing) return c.json({ error: 'NOT_FOUND' }, 404);

    const { count: attendanceCount } = await supabase
      .from('attendances')
      .select('*', { count: 'exact', head: true })
      .eq('enrollment_id', id);

    if ((attendanceCount ?? 0) > 0) {
      return c.json({ error: 'has_attendance' }, 409);
    }

    await supabase.from('enrollments').delete().eq('id', id);
    return new Response(null, { status: 204 });
  },
);

// POST /api/enrollments/copy-from-class
app.openapi(
  createRoute({
    method: 'post',
    path: '/copy-from-class',
    tags: ['Enrollments'],
    middleware: [requireAdminMiddleware] as const,
    request: {
      body: { content: { 'application/json': { schema: CopyFromClassBodySchema } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: CopyFromClassResponseSchema } },
        description: 'OK',
      },
      400: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Bad Request (SAME_CLASS / OVER_QUOTA / invalid statuses)',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Class not found',
      },
      500: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Internal Server Error',
      },
    },
  }),
  async (c) => {
    const { targetClassId, sourceClassId, statuses } = c.req.valid('json');
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    const supabase = c.get('supabase');

    if (sourceClassId === targetClassId) {
      return c.json({ error: '來源班級不能與目標班級相同', code: 'SAME_CLASS' }, 400);
    }

    const { data: targetClass, error: targetClassError } = await supabase
      .from('classes')
      .select('id, max_students')
      .eq('id', targetClassId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (targetClassError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);
    if (!targetClass) return c.json({ error: 'TARGET_CLASS_NOT_FOUND' }, 404);

    const { data: sourceClass, error: sourceClassError } = await supabase
      .from('classes')
      .select('id')
      .eq('id', sourceClassId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (sourceClassError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);
    if (!sourceClass) return c.json({ error: 'SOURCE_CLASS_NOT_FOUND' }, 404);

    const { data: sourceEnrollments, error: sourceEnrollmentsError } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('class_id', sourceClassId)
      .eq('org_id', orgId)
      .in('status', statuses);

    if (sourceEnrollmentsError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);

    const sourceRows = (sourceEnrollments ?? []) as Array<CopyFromClassStudentRow>;
    if (sourceRows.length === 0) {
      return c.json({ copied: 0, skipped: 0 }, 200);
    }

    const { data: activeEnrollments, error: activeEnrollmentsError } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('class_id', targetClassId)
      .eq('org_id', orgId)
      .in('status', ['active', 'pending_payment', 'suspended']);

    if (activeEnrollmentsError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);

    const activeRows = (activeEnrollments ?? []) as Array<CopyFromClassStudentRow>;
    const { toInsertStudentIds, skipped } = buildCopyFromClassPlan(sourceRows, activeRows);

    if (toInsertStudentIds.length === 0) {
      return c.json({ copied: 0, skipped }, 200);
    }

    const { count: currentActiveCount, error: countError } = await supabase
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', targetClassId)
      .eq('org_id', orgId)
      .in('status', ['active', 'pending_payment']);

    if (countError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);

    const maxStudents =
      typeof targetClass.max_students === 'number' ? targetClass.max_students : null;
    if (
      isCopyFromClassOverQuota({
        currentActiveCount: currentActiveCount ?? null,
        maxStudents,
        toInsertCount: toInsertStudentIds.length,
      })
    ) {
      return c.json({ error: '人數已達上限', code: 'OVER_QUOTA' }, 400);
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = toInsertStudentIds.map((studentId) => ({
      org_id: orgId,
      class_id: targetClassId,
      student_id: studentId,
      status: 'active' as const,
      effective_from: today,
      created_by: userId,
    }));

    const { error: insertError } = await supabase.from('enrollments').insert(rows);
    if (insertError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);

    return c.json({ copied: toInsertStudentIds.length, skipped }, 200);
  },
);

// POST /api/enrollments/batch-match
app.openapi(
  createRoute({
    method: 'post',
    path: '/batch-match',
    tags: ['Enrollments'],
    summary: '批次比對學生（唯讀）',
    request: { body: { content: { 'application/json': { schema: BatchMatchBodySchema } } } },
    responses: {
      200: { content: { 'application/json': { schema: BatchMatchResponseSchema } }, description: 'OK' },
      404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Class not found' },
      500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Internal Server Error' },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const orgId = c.get('orgId');
    const supabase = c.get('supabase');

    const { data: classData, error: classError } = await supabase
      .from('classes')
      .select('id')
      .eq('id', body.classId)
      .eq('org_id', orgId)
      .maybeSingle();

    if (classError) return c.json({ error: '伺服器錯誤', code: 'SERVER_ERROR' }, 500);
    if (!classData) return c.json({ error: 'CLASS_NOT_FOUND' }, 404);

    const { data: enrolled, error: enrolledError } = await supabase
      .from('enrollments')
      .select('student_id')
      .eq('class_id', body.classId)
      .eq('org_id', orgId)
      .not('status', 'in', '(withdrawal,void)');

    if (enrolledError) return c.json({ error: enrolledError.message }, 500);

    const enrolledIds = new Set((enrolled ?? []).map((e) => e.student_id));
    const uniqueNames = Array.from(new Set(body.items.map((item) => item.name.trim()).filter(Boolean)));
    const uniqueSchools = Array.from(
      new Set(body.items.map((item) => item.school.trim()).filter(Boolean)),
    );

    let students: z.infer<typeof BatchMatchCandidateSchema>[] = [];
    if (uniqueNames.length > 0 && uniqueSchools.length > 0) {
      const { data: allCandidates, error: candidatesError } = await supabase
        .from('students')
        .select('id, name, grade, school, birthday')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .in('name', uniqueNames)
        .in('school', uniqueSchools);

      if (candidatesError) return c.json({ error: candidatesError.message }, 500);
      students = allCandidates ?? [];
    }

    const exactIndex = new Map<string, z.infer<typeof BatchMatchCandidateSchema>[]>();
    const ilikeIndex = new Map<string, z.infer<typeof BatchMatchCandidateSchema>[]>();

    for (const student of students) {
      const exactKey = `${student.name}\u0000${student.school}`;
      const ilikeKey = `${student.name.toLowerCase()}\u0000${student.school.toLowerCase()}`;

      const exactBucket = exactIndex.get(exactKey) ?? [];
      exactBucket.push(student);
      exactIndex.set(exactKey, exactBucket);

      const ilikeBucket = ilikeIndex.get(ilikeKey) ?? [];
      ilikeBucket.push(student);
      ilikeIndex.set(ilikeKey, ilikeBucket);
    }

    const results: z.infer<typeof BatchMatchResultItemSchema>[] = [];

    for (const [index, item] of body.items.entries()) {
      const exactKey = `${item.name}\u0000${item.school}`;
      const ilikeKey = `${item.name.toLowerCase()}\u0000${item.school.toLowerCase()}`;

      const exactMatches = exactIndex.get(exactKey) ?? [];
      const ilikeMatches = ilikeIndex.get(ilikeKey) ?? [];
      const candidates = exactMatches.length > 0 ? exactMatches : ilikeMatches;

      const available = candidates.filter((candidate) => !enrolledIds.has(candidate.id));

      if (candidates.length > 0 && available.length === 0) {
        results.push({ index, status: 'already_enrolled' });
      } else if (available.length === 1) {
        results.push({ index, status: 'matched', studentId: available[0].id });
      } else if (available.length > 1) {
        results.push({ index, status: 'ambiguous', candidates: available });
      } else {
        results.push({ index, status: 'not_found' });
      }
    }

    return c.json({ results }, 200);
  },
);

export default app;
