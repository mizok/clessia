import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
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

// ============================================================
// Shared schemas
// ============================================================

const ErrorSchema = z.object({ error: z.string() }).openapi('EnrollmentError');

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
        'id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name, courses(id, name)), students(name), creator:ba_user!created_by(name)',
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
      .select('id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name, courses(id, name)), students(name), creator:ba_user!created_by(name)')
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
      .select('id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name, courses(id, name)), students(name), creator:ba_user!created_by(name)')
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
      .select('id, org_id, class_id, student_id, status, payment_cycle, effective_from, effective_to, notes, created_by, created_at, updated_at, classes(name, courses(id, name)), students(name), creator:ba_user!created_by(name)')
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

    const { data: cls } = await supabase
      .from('classes')
      .select('max_students')
      .eq('id', classId)
      .eq('org_id', orgId)
      .single();

    if (!cls) return c.json({ error: 'CLASS_NOT_FOUND' }, 404);

    const { count: activeCount } = await supabase
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('org_id', orgId)
      .in('status', ['active', 'pending_payment']);

    if ((activeCount ?? 0) + studentIds.length > (cls.max_students ?? 9999)) {
      return c.json({ error: 'over_quota' }, 400);
    }

    const today = new Date().toISOString().slice(0, 10);
    const results: z.infer<typeof BatchCreateResultItemSchema>[] = [];

    for (const studentId of studentIds) {
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

export default app;
