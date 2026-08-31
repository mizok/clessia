import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { resolveStudentScope } from './students/teacher-scope';
import { taughtClassIds } from '../lib/teacher-scope';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { DbUuidSchema } from '../lib/validation';

// ============================================================
// Schemas
// ============================================================

const GradeLevelSchema = z
  .enum(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J2', 'J3', 'S1', 'S2', 'S3'])
  .openapi('GradeLevel');

const StudentGenderSchema = z
  .enum(['male', 'female', 'prefer_not_to_say'])
  .openapi('StudentGender');

const StudentSchoolSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    shortName: z.string().nullable(),
  })
  .openapi('StudentSchool');

const StudentSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    name: z.string(),
    grade: GradeLevelSchema,
    school: StudentSchoolSchema.nullable(),
    birthday: z.string().nullable(),
    gender: StudentGenderSchema.nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    emergencyContactName: z.string().nullable(),
    emergencyContactPhone: z.string().nullable(),
    notes: z.string().nullable(),
    isActive: z.boolean(),
    parentNames: z.array(z.string()),
    campusNames: z.array(z.string()),
    /** 在籍班級（老師端用來分組；管理端目前不顯示） */
    classNames: z.array(z.string()),
    hasEnrollments: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Student');

const StudentDetailParentSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    relation: z.string().nullable(),
    isPrimary: z.boolean(),
  })
  .openapi('StudentDetailParent');

const StudentDetailSchema = StudentSchema.extend({
  parents: z.array(StudentDetailParentSchema),
}).openapi('StudentDetail');

const StudentListResponseSchema = z
  .object({
    data: z.array(StudentSchema),
    summary: z.object({ total: z.number(), activeCount: z.number() }),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('StudentListResponse');

const UpdateStudentSchema = z
  .object({
    name: z.string().min(1).optional(),
    grade: GradeLevelSchema.optional(),
    schoolId: z.uuid().nullable().optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD')
      .nullable()
      .optional(),
    gender: StudentGenderSchema.nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    address: z.string().nullable().optional(),
    emergencyContactName: z.string().nullable().optional(),
    emergencyContactPhone: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .openapi('UpdateStudent');

const CreateStudentSchema = z
  .object({
    name: z.string().min(1),
    grade: GradeLevelSchema,
    schoolId: z.uuid().nullable().optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD')
      .nullable()
      .optional(),
    gender: StudentGenderSchema.nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    address: z.string().nullable().optional(),
    emergencyContactName: z.string().nullable().optional(),
    emergencyContactPhone: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    parentId: z.string().uuid().optional(),
  })
  .openapi('CreateStudent');

// ============================================================
// Helpers (exported for unit testing)
// ============================================================

export function buildStudentSummary(
  rows: Array<{ is_active: boolean }>,
  total: number,
): { total: number; activeCount: number } {
  return {
    total,
    activeCount: rows.filter((r) => r.is_active).length,
  };
}

export function toStudentResponse(
  row: Record<string, unknown>,
  parentNames: string[] = [],
  campusNames: string[] = [],
  hasEnrollments: boolean = false,
  classNames: string[] = [],
) {
  const school = row['schools'] as
    { id: string; name: string; short_name: string | null } | null | undefined;

  return {
    id: row['id'] as string,
    orgId: row['org_id'] as string,
    name: row['name'] as string,
    grade: row['grade'] as string,
    school: school
      ? {
          id: school.id,
          name: school.name,
          shortName: school.short_name,
        }
      : null,
    birthday: (row['birthday'] as string | null) ?? null,
    gender: (row['gender'] as string | null) ?? null,
    phone: (row['phone'] as string | null) ?? null,
    email: (row['email'] as string | null) ?? null,
    address: (row['address'] as string | null) ?? null,
    emergencyContactName: (row['emergency_contact_name'] as string | null) ?? null,
    emergencyContactPhone: (row['emergency_contact_phone'] as string | null) ?? null,
    notes: (row['notes'] as string | null) ?? null,
    isActive: row['is_active'] as boolean,
    parentNames,
    campusNames,
    classNames,
    hasEnrollments,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

export function buildStudentSearchClause(
  search: string,
  matchedStudentIds: string[],
  searchScope: 'default' | 'student_name' = 'default',
): string {
  if (searchScope === 'student_name') {
    return `name.ilike.%${search}%`;
  }

  if (matchedStudentIds.length > 0) {
    return `name.ilike.%${search}%,id.in.(${matchedStudentIds.join(',')})`;
  }

  return `name.ilike.%${search}%`;
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/students
app.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Students'],
    summary: '取得學生列表',
    request: {
      query: z.object({
        search: z.string().optional(),
        searchScope: z.enum(['default', 'student_name']).default('default').optional(),
        grade: GradeLevelSchema.optional(),
        campusId: DbUuidSchema.optional(),
        page: z.coerce.number().min(1).default(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).default(20).optional(),
        isActive: z.coerce.boolean().optional(),
        // 意圖提示而已：老師的範圍由角色決定（見 students/teacher-scope.ts）
        taughtByMe: z.coerce.boolean().optional(),
      }),
    },
    responses: {
      200: {
        description: '學生列表',
        content: { 'application/json': { schema: StudentListResponseSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const {
      search,
      searchScope = 'default',
      grade,
      campusId,
      page = 1,
      pageSize = 20,
      isActive,
      taughtByMe = false,
    } = c.req.valid('query');

    const roles = c.get('roles') ?? [];

    // 管理員不受限，所以不必查 staff
    let ownStaffId: string | null = null;
    if (!roles.includes('admin')) {
      const { data: ownStaff } = await supabase
        .from('staff')
        .select('id')
        .eq('user_id', c.get('userId'))
        .eq('org_id', orgId)
        .maybeSingle();
      ownStaffId = (ownStaff?.id as string | undefined) ?? null;
    }

    const scope = resolveStudentScope({ roles, taughtByMe, ownStaffId });
    if ('forbidden' in scope) {
      return c.json({ error: '權限不足', code: 'FORBIDDEN' }, 403);
    }

    // 老師只看得到自己固定任課的班（schedules，不是 sessions —— 代課不算「我的學生」）
    let taughtStudentIds: string[] | null = null;
    if (scope.teacherStaffId) {
      // 這裡原本自己組同一支查詢，而且同樣對 `schedules` 下了 `org_id` ——
      // **那張表沒有這個欄位**（42703）。改成共用 `lib/teacher-scope` 的那一份，
      // 兩處各修一次的話，下一次只會修好一處。
      const classIds = await taughtClassIds(supabase, orgId, scope.teacherStaffId);

      if (classIds.length === 0) {
        taughtStudentIds = [];
      } else {
        const { data: enrolledRows, error: enrolledError } = await supabase
          .from('enrollments')
          .select('student_id')
          .eq('org_id', orgId)
          .in('class_id', classIds)
          .in('status', ['active', 'pending_payment']);
        if (enrolledError) {
          return c.json({ error: '讀取在籍學生失敗', message: enrolledError.message }, 500);
        }
        taughtStudentIds = Array.from(
          new Set((enrolledRows ?? []).map((r) => r['student_id'] as string)),
        );
      }
    }

    let query = supabase
      .from('students')
      .select(
        `*, schools(id, name, short_name), parent_student_relations(is_primary, relation, parents(id, name)), enrollments(id, status, classes(id, name, campus_id, campuses(name)))`,
        { count: 'exact' },
      )
      .eq('org_id', orgId)
      .order('name');

    if (taughtStudentIds !== null) {
      // 空陣列代表這位老師沒有任何任課班 —— 結果必須是空的，不是「不篩」
      if (taughtStudentIds.length === 0) {
        return c.json({ data: [], meta: { total: 0, page, pageSize, totalPages: 0 } }, 200);
      }
      query = query.in('id', taughtStudentIds);
    }

    if (search) {
      let matchedStudentIds: string[] = [];

      if (searchScope === 'default') {
        const { data: relationRows, error: relationError } = await supabase
          .from('parent_student_relations')
          .select('student_id, parents!inner(name)')
          .ilike('parents.name', `%${search}%`);

        if (relationError) {
          return c.json({ error: '讀取學生列表失敗', message: relationError.message }, 500);
        }

        matchedStudentIds = Array.from(
          new Set(
            ((relationRows ?? []) as Array<{ student_id: string | null }>)
              .map((row) => row.student_id)
              .filter((studentId): studentId is string => !!studentId),
          ),
        );
      }

      query = query.or(buildStudentSearchClause(search, matchedStudentIds, searchScope));
    }
    if (grade) {
      query = query.eq('grade', grade);
    }
    if (campusId) {
      const { data: enrollmentRows } = await supabase
        .from('enrollments')
        .select('student_id, classes!inner(campus_id)')
        .eq('classes.campus_id', campusId);

      const campusStudentIds = Array.from(
        new Set(
          ((enrollmentRows ?? []) as Array<{ student_id: string | null }>)
            .map((row) => row.student_id)
            .filter((id): id is string => !!id),
        ),
      );

      if (campusStudentIds.length > 0) {
        query = query.in('id', campusStudentIds);
      } else {
        // 該分校無學生，直接回空集合
        query = query.in('id', ['00000000-0000-0000-0000-000000000000']);
      }
    }
    if (isActive !== undefined) {
      query = query.eq('is_active', isActive);
    }

    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);

    const { data, error, count } = await query;

    if (error) {
      return c.json({ error: '讀取學生列表失敗', message: error.message }, 500);
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const total = count ?? 0;

    // 獨立 query 取得全量 activeCount（不受 isActive filter 影響）
    const { count: activeCount } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_active', true);

    const students = rows.map((row) => {
      const relations =
        (row['parent_student_relations'] as Array<{
          is_primary: boolean;
          relation: string | null;
          parents: { id: string; name: string } | null;
        }>) ?? [];
      const parentNames = relations
        .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
        .map((r) => r.parents?.name ?? '')
        .filter(Boolean);
      const enrollmentRows =
        (row['enrollments'] as Array<{
          id: string;
          status?: string;
          classes: {
            id: string;
            name: string;
            campus_id: string | null;
            campuses: { name: string } | null;
          } | null;
        }>) ?? [];
      const hasEnrollments = enrollmentRows.length > 0;
      const campusNames = Array.from(
        new Set(
          enrollmentRows.map((e) => e.classes?.campuses?.name).filter((n): n is string => !!n),
        ),
      );
      // 只算在籍的班 —— 退班的班名不該出現在老師的分組裡
      const classNames = Array.from(
        new Set(
          enrollmentRows
            .filter((e) => !e.status || ['active', 'pending_payment'].includes(e.status))
            .map((e) => e.classes?.name)
            .filter((n): n is string => !!n),
        ),
      );

      return toStudentResponse(row, parentNames, campusNames, hasEnrollments, classNames);
    });

    return c.json(
      {
        data: students,
        summary: { total, activeCount: activeCount ?? 0 },
        meta: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      },
      200,
    );
  },
);

// GET /api/students/:id
// POST /api/students
app.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Students'],
    summary: '建立學生',
    request: {
      body: { content: { 'application/json': { schema: CreateStudentSchema } } },
    },
    responses: {
      201: {
        description: '建立成功',
        content: { 'application/json': { schema: z.object({ data: StudentSchema }) } },
      },
      500: {
        description: '建立失敗',
        content: {
          'application/json': {
            schema: z.object({ error: z.string(), message: z.string() }),
          },
        },
      },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    const insertPayload: Record<string, unknown> = {
      org_id: orgId,
      name: body.name,
      grade: body.grade,
      school_id: body.schoolId ?? null,
    };
    if (body.birthday !== undefined) insertPayload['birthday'] = body.birthday;
    if (body.gender !== undefined) insertPayload['gender'] = body.gender;
    if (body.phone !== undefined) insertPayload['phone'] = body.phone;
    if (body.email !== undefined) insertPayload['email'] = body.email;
    if (body.address !== undefined) insertPayload['address'] = body.address;
    if (body.emergencyContactName !== undefined)
      insertPayload['emergency_contact_name'] = body.emergencyContactName;
    if (body.emergencyContactPhone !== undefined)
      insertPayload['emergency_contact_phone'] = body.emergencyContactPhone;
    if (body.notes !== undefined) insertPayload['notes'] = body.notes;

    const { data, error } = await supabase
      .from('students')
      .insert(insertPayload)
      .select('*, schools(id, name, short_name)')
      .single();

    if (error || !data) {
      return c.json({ error: '建立學生失敗', message: error?.message ?? '' }, 500);
    }

    const student = StudentSchema.parse(toStudentResponse(data as Record<string, unknown>));

    // 建立家長關聯（若有提供 parentId）
    if (body.parentId) {
      await supabase.from('parent_student_relations').insert({
        parent_id: body.parentId,
        student_id: student.id,
        is_primary: true,
        relation: null,
      });
    }

    return c.json({ data: student }, 201);
  },
);

// GET /api/students/:id
app.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Students'],
    summary: '取得學生詳情',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: {
        description: '學生詳情',
        content: { 'application/json': { schema: z.object({ data: StudentDetailSchema }) } },
      },
      404: { description: '學生不存在' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { data, error } = await supabase
      .from('students')
      .select(
        `*, schools(id, name, short_name), parent_student_relations(
          id, is_primary, relation,
          parents(id, name, user_id)
        )`,
      )
      .eq('id', id)
      .eq('org_id', orgId)
      .single();

    if (error || !data) {
      return c.json({ error: '學生不存在' }, 404);
    }

    const row = data as Record<string, unknown>;
    const relations =
      (row['parent_student_relations'] as Array<{
        id: string;
        is_primary: boolean;
        relation: string | null;
        parents: { id: string; name: string; user_id: string } | null;
      }>) ?? [];

    const validRelations = relations.filter((r) => r.parents);
    const userIds = validRelations.map((r) => r.parents!.user_id).filter(Boolean);

    const baUserMap = new Map<string, { email: string | null; phone: string | null }>();
    if (userIds.length > 0) {
      const { data: baUsers } = await supabase
        .from('ba_user')
        .select('id, email, phone')
        .in('id', userIds);
      for (const u of baUsers ?? []) {
        baUserMap.set(u.id as string, {
          email: (u.email as string | null) ?? null,
          phone: (u.phone as string | null) ?? null,
        });
      }
    }

    const parents = validRelations.map((r) => {
      const baUser = baUserMap.get(r.parents!.user_id) ?? { email: null, phone: null };
      return {
        id: r.parents!.id,
        name: r.parents!.name,
        phone: baUser.phone,
        email: baUser.email,
        relation: r.relation,
        isPrimary: r.is_primary,
      };
    });

    const parentNames = parents
      .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))
      .map((p) => p.name);

    return c.json({ data: { ...toStudentResponse(row, parentNames), parents } }, 200);
  },
);

// PUT /api/students/:id
app.openapi(
  createRoute({
    method: 'put',
    path: '/{id}',
    tags: ['Students'],
    summary: '更新學生資料',
    request: {
      params: z.object({ id: DbUuidSchema }),
      body: { content: { 'application/json': { schema: UpdateStudentSchema } } },
    },
    responses: {
      200: {
        description: '更新成功',
        content: { 'application/json': { schema: z.object({ data: StudentSchema }) } },
      },
      404: { description: '學生不存在' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const updatePayload: Record<string, unknown> = {};
    if (body.name !== undefined) updatePayload['name'] = body.name;
    if (body.grade !== undefined) updatePayload['grade'] = body.grade;
    if (body.schoolId !== undefined) updatePayload['school_id'] = body.schoolId;
    if (body.birthday !== undefined) updatePayload['birthday'] = body.birthday;
    if (body.gender !== undefined) updatePayload['gender'] = body.gender;
    if (body.phone !== undefined) updatePayload['phone'] = body.phone;
    if (body.email !== undefined) updatePayload['email'] = body.email;
    if (body.address !== undefined) updatePayload['address'] = body.address;
    if (body.emergencyContactName !== undefined)
      updatePayload['emergency_contact_name'] = body.emergencyContactName;
    if (body.emergencyContactPhone !== undefined)
      updatePayload['emergency_contact_phone'] = body.emergencyContactPhone;
    if (body.notes !== undefined) updatePayload['notes'] = body.notes;
    if (body.isActive !== undefined) updatePayload['is_active'] = body.isActive;

    if (Object.keys(updatePayload).length === 0) {
      return c.json({ error: '未提供任何更新欄位' }, 400);
    }

    const { data, error } = await supabase
      .from('students')
      .update(updatePayload)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*, schools(id, name, short_name)')
      .single();

    if (error || !data) {
      return c.json({ error: '學生不存在或更新失敗' }, 404);
    }

    const updated = toStudentResponse(data as Record<string, unknown>);

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'student',
        resourceId: id,
        action: 'update',
        details: { newValue: updated },
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ data: updated }, 200);
  },
);

// DELETE /api/students/:id
app.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Students'],
    summary: '刪除學生',
    request: { params: z.object({ id: DbUuidSchema }) },
    responses: {
      200: { description: '刪除成功' },
      409: { description: '學生已有報名紀錄，無法刪除' },
      404: { description: '學生不存在' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const { id } = c.req.valid('param');

    const { count: enrollmentCount, error: enrollmentCountError } = await supabase
      .from('enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', id);

    if (enrollmentCountError) {
      return c.json({ error: '查詢學生報名紀錄失敗', message: enrollmentCountError.message }, 500);
    }

    if ((enrollmentCount ?? 0) > 0) {
      return c.json({ error: '學生已有報名紀錄，無法刪除' }, 409);
    }

    const { data, error } = await supabase
      .from('students')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id')
      .single();

    if (error || !data) {
      return c.json({ error: '學生不存在' }, 404);
    }

    logAudit(
      supabase,
      {
        orgId,
        userId: c.get('userId'),
        resourceType: 'student',
        resourceId: id,
        action: 'delete',
      },
      c.executionCtx.waitUntil.bind(c.executionCtx),
    );

    return c.json({ success: true }, 200);
  },
);

export default app;
