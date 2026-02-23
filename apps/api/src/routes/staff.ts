import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuth } from '../auth';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';

// ============================================================
// Schemas
// ============================================================

const StaffRoleSchema = z.enum(['admin', 'teacher']).openapi('StaffRole');

const PermissionSchema = z
  .enum([
    'basic_operations',
    'manage_courses',
    'manage_students',
    'manage_finance',
    'manage_staff',
    'view_reports',
  ])
  .openapi('Permission');

const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD');

const StaffSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    orgId: z.uuid(),
    displayName: z.string(),
    phone: z.string().nullable(),
    email: z.email(),
    birthday: z.string().nullable(),
    notes: z.string().nullable(),
    subjectIds: z.array(z.uuid()),
    subjectNames: z.array(z.string()),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    campusIds: z.array(z.uuid()),
    roles: z.array(StaffRoleSchema),
    permissions: z.array(PermissionSchema),
  })
  .openapi('Staff');

const StaffListResponseSchema = z
  .object({
    data: z.array(StaffSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
      totalPages: z.number(),
    }),
  })
  .openapi('StaffListResponse');

const CreateStaffSchema = z
  .object({
    displayName: z.string().min(1).max(100).openapi({ description: '姓名' }),
    email: z.email().openapi({ description: 'Email（登入帳號）' }),
    phone: z.string().max(30).nullable().optional().openapi({ description: '電話' }),
    birthday: DateStringSchema.nullable().optional().openapi({ description: '生日（YYYY-MM-DD）' }),
    notes: z.string().max(2000).nullable().optional().openapi({ description: '備註' }),
    subjectIds: z.array(z.uuid()).optional().openapi({ description: '教學科目 IDs（老師用）' }),
    campusIds: z.array(z.uuid()).min(1).openapi({ description: '服務分校 IDs' }),
    roles: z.array(StaffRoleSchema).min(1).openapi({ description: '角色：admin、teacher（可多選）' }),
    permissions: z.array(PermissionSchema).optional().openapi({ description: '管理員權限清單' }),
  })
  .openapi('CreateStaff');

const UpdateStaffSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    phone: z.string().max(30).nullable().optional(),
    birthday: DateStringSchema.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    subjectIds: z.array(z.uuid()).optional(),
    campusIds: z.array(z.uuid()).min(1).optional(),
    roles: z.array(StaffRoleSchema).min(1).optional().openapi({ description: '角色（可多選）' }),
    isActive: z.boolean().optional(),
    permissions: z.array(PermissionSchema).optional(),
  })
  .openapi('UpdateStaff');

const ErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('Error');

const QueryParamsSchema = z.object({
  page: z.string().optional().openapi({ description: '頁碼', example: '1' }),
  pageSize: z.string().optional().openapi({ description: '每頁筆數', example: '20' }),
  search: z.string().optional().openapi({ description: '姓名 / Email 搜尋' }),
  role: StaffRoleSchema.optional().openapi({ description: '角色篩選' }),
  campusId: z.uuid().optional().openapi({ description: '分校篩選' }),
  isActive: z.string().optional().openapi({ description: '篩選狀態 (true/false)' }),
});

// ============================================================
// Types
// ============================================================

type StaffRole = z.infer<typeof StaffRoleSchema>;
type Permission = z.infer<typeof PermissionSchema>;

interface RoleInfo {
  roles: StaffRole[];
  permissions: Permission[];
}

interface StaffCampusRow {
  staff_id: string;
  campus_id: string;
}

interface StaffSubjectRow {
  staff_id: string;
  subject_id: string;
  subjects: { name: string } | { name: string }[] | null;
}

interface UserRoleRow {
  user_id: string;
  role: StaffRole;
  permissions: unknown;
}

interface SubjectInfo {
  ids: string[];
  names: string[];
}

// ============================================================
// Helpers
// ============================================================

function normalizePermissions(permissions: unknown): Permission[] {
  if (!Array.isArray(permissions)) {
    return [];
  }

  return permissions.filter((permission): permission is Permission =>
    PermissionSchema.options.includes(permission as Permission),
  );
}

function toRoleInfoMap(rows: UserRoleRow[]): Map<string, RoleInfo> {
  const roleInfoMap = new Map<string, RoleInfo>();

  for (const row of rows) {
    const existing = roleInfoMap.get(row.user_id);
    const rowPermissions = normalizePermissions(row.permissions);

    if (existing) {
      // Merge roles and permissions
      if (!existing.roles.includes(row.role)) {
        existing.roles.push(row.role);
      }
      // Merge permissions (avoid duplicates)
      for (const perm of rowPermissions) {
        if (!existing.permissions.includes(perm)) {
          existing.permissions.push(perm);
        }
      }
    } else {
      roleInfoMap.set(row.user_id, {
        roles: [row.role],
        permissions: rowPermissions,
      });
    }
  }

  return roleInfoMap;
}

function toCampusMap(rows: StaffCampusRow[]): Map<string, string[]> {
  const campusMap = new Map<string, string[]>();

  for (const row of rows) {
    const current = campusMap.get(row.staff_id) || [];
    current.push(row.campus_id);
    campusMap.set(row.staff_id, current);
  }

  return campusMap;
}

function toSubjectMap(rows: StaffSubjectRow[]): Map<string, SubjectInfo> {
  const subjectMap = new Map<string, SubjectInfo>();

  for (const row of rows) {
    const current = subjectMap.get(row.staff_id) || { ids: [], names: [] };
    if (!current.ids.includes(row.subject_id)) {
      current.ids.push(row.subject_id);
    }

    const subjectName = Array.isArray(row.subjects)
      ? row.subjects[0]?.name
      : row.subjects?.name;
    if (subjectName && !current.names.includes(subjectName)) {
      current.names.push(subjectName);
    }

    subjectMap.set(row.staff_id, current);
  }

  return subjectMap;
}

function mapStaff(
  row: Record<string, unknown>,
  campusMap: Map<string, string[]>,
  subjectMap: Map<string, SubjectInfo>,
  roleInfoMap: Map<string, RoleInfo>,
) {
  const userId = row['user_id'] as string;
  const staffId = row['id'] as string;
  const roleInfo = roleInfoMap.get(userId) || { roles: ['teacher'] as StaffRole[], permissions: [] };

  return {
    id: staffId,
    userId,
    orgId: row['org_id'] as string,
    displayName: row['display_name'] as string,
    phone: row['phone'] as string | null,
    email: row['email'] as string,
    birthday: row['birthday'] as string | null,
    notes: row['notes'] as string | null,
    subjectIds: subjectMap.get(staffId)?.ids ?? [],
    subjectNames: subjectMap.get(staffId)?.names ?? [],
    isActive: row['is_active'] as boolean,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    campusIds: campusMap.get(staffId) || [],
    roles: roleInfo.roles,
    permissions: roleInfo.permissions,
  };
}

async function checkUserIsAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();

  return !!data;
}

async function validateCampusIdsInOrg(
  supabase: SupabaseClient,
  orgId: string,
  campusIds: string[],
): Promise<boolean> {
  const uniqueCampusIds = Array.from(new Set(campusIds));

  if (uniqueCampusIds.length === 0) {
    return false;
  }

  const { data, error } = await supabase
    .from('campuses')
    .select('id')
    .eq('org_id', orgId)
    .in('id', uniqueCampusIds);

  if (error) {
    return false;
  }

  return (data || []).length === uniqueCampusIds.length;
}

async function validateSubjectIdsInOrg(
  supabase: SupabaseClient,
  orgId: string,
  subjectIds: string[],
): Promise<boolean> {
  const uniqueSubjectIds = Array.from(new Set(subjectIds));

  if (uniqueSubjectIds.length === 0) {
    return true;
  }

  const { data, error } = await supabase
    .from('subjects')
    .select('id')
    .eq('org_id', orgId)
    .in('id', uniqueSubjectIds);

  if (error) {
    return false;
  }

  return (data || []).length === uniqueSubjectIds.length;
}

function isDuplicateEmailError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('already') && normalized.includes('registered');
}

function generateRandomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function loadStaffRelations(
  supabase: SupabaseClient,
  staffRows: Record<string, unknown>[],
): Promise<{
  campusMap: Map<string, string[]>;
  subjectMap: Map<string, SubjectInfo>;
  roleInfoMap: Map<string, RoleInfo>;
}> {
  const staffIds = staffRows.map((row) => row['id'] as string);
  const userIds = staffRows.map((row) => row['user_id'] as string);

  if (staffIds.length === 0 || userIds.length === 0) {
    return {
      campusMap: new Map<string, string[]>(),
      subjectMap: new Map<string, SubjectInfo>(),
      roleInfoMap: new Map<string, RoleInfo>(),
    };
  }

  const [{ data: campusRows }, { data: subjectRows }, { data: roleRows }] = await Promise.all([
    supabase
      .from('staff_campuses')
      .select('staff_id, campus_id, campuses!inner(id)')
      .in('staff_id', staffIds),
    supabase
      .from('staff_subjects')
      .select('staff_id, subject_id, subjects(name)')
      .in('staff_id', staffIds),
    supabase.from('user_roles').select('user_id, role, permissions').in('user_id', userIds),
  ]);

  const filteredRoleRows = (roleRows || []).filter(
    (row) => row.role === 'admin' || row.role === 'teacher',
  ) as UserRoleRow[];

  return {
    campusMap: toCampusMap((campusRows || []) as StaffCampusRow[]),
    subjectMap: toSubjectMap((subjectRows || []) as StaffSubjectRow[]),
    roleInfoMap: toRoleInfoMap(filteredRoleRows),
  };
}

async function getStaffById(
  supabase: SupabaseClient,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from('staff').select('*').eq('id', id).maybeSingle();
  return (data as Record<string, unknown> | null) || null;
}

function normalizeAdminPermissions(role: StaffRole, permissions?: Permission[]): Permission[] {
  if (role !== 'admin') {
    return [];
  }

  return Array.from(new Set(permissions || []));
}

// ============================================================
// Routes
// ============================================================

const app = new OpenAPIHono<AppEnv>();

// GET /api/staff
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Staff'],
  summary: '取得人員列表',
  description: '取得人員列表，支援分頁、搜尋、角色篩選、分校篩選',
  request: {
    query: QueryParamsSchema,
  },
  responses: {
    200: {
      description: '成功取得人員列表',
      content: {
        'application/json': {
          schema: StaffListResponseSchema,
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

app.openapi(listRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const query = c.req.valid('query');

  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const pageSize = Math.max(parseInt(query.pageSize || '20', 10), 1);
  const offset = (page - 1) * pageSize;

  let filteredStaffIdsByCampus: string[] | null = null;
  let filteredUserIdsByRole: string[] | null = null;

  if (query.campusId) {
    const { data: campusLinks } = await supabase
      .from('staff_campuses')
      .select('staff_id, campuses!inner(id)')
      .eq('campus_id', query.campusId);
    filteredStaffIdsByCampus = (campusLinks || []).map((row) => row.staff_id);
  }

  if (query.role) {
    const { data: orgProfiles, error: orgProfileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('org_id', orgId);

    if (orgProfileError) {
      return c.json({ error: orgProfileError.message, code: 'DB_ERROR' }, 400);
    }

    const orgUserIds = (orgProfiles || []).map((profile) => profile.id);
    if (orgUserIds.length === 0) {
      return c.json(
        {
          data: [],
          meta: {
            total: 0,
            page,
            pageSize,
            totalPages: 0,
          },
        },
        200,
      );
    }

    const { data: roleRows, error: roleFilterError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', query.role)
      .in('user_id', orgUserIds);

    if (roleFilterError) {
      return c.json({ error: roleFilterError.message, code: 'DB_ERROR' }, 400);
    }

    filteredUserIdsByRole = (roleRows || []).map((row) => row.user_id);
  }

  if (query.campusId && filteredStaffIdsByCampus && filteredStaffIdsByCampus.length === 0) {
    return c.json(
      {
        data: [],
        meta: {
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        },
      },
      200,
    );
  }

  if (query.role && filteredUserIdsByRole && filteredUserIdsByRole.length === 0) {
    return c.json(
      {
        data: [],
        meta: {
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        },
      },
      200,
    );
  }

  let dbQuery = supabase.from('staff').select('*', { count: 'exact' });

  if (query.search) {
    dbQuery = dbQuery.or(`display_name.ilike.%${query.search}%,email.ilike.%${query.search}%`);
  }

  if (query.isActive !== undefined) {
    dbQuery = dbQuery.eq('is_active', query.isActive === 'true');
  }

  if (filteredStaffIdsByCampus) {
    dbQuery = dbQuery.in('id', filteredStaffIdsByCampus);
  }

  if (filteredUserIdsByRole) {
    dbQuery = dbQuery.in('user_id', filteredUserIdsByRole);
  }

  dbQuery = dbQuery.range(offset, offset + pageSize - 1).order('created_at', { ascending: false });

  const { data, count, error } = await dbQuery;

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const staffRows = (data || []) as Record<string, unknown>[];
  const { campusMap, subjectMap, roleInfoMap } = await loadStaffRelations(supabase, staffRows);
  const staffList = staffRows.map((row) => mapStaff(row, campusMap, subjectMap, roleInfoMap));

  return c.json(
    {
      data: staffList,
      meta: {
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    },
    200,
  );
});

// GET /api/staff/:id
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Staff'],
  summary: '取得單一人員',
  request: {
    params: z.object({
      id: z.uuid().openapi({ description: '人員 ID' }),
    }),
  },
  responses: {
    200: {
      description: '成功取得人員',
      content: {
        'application/json': {
          schema: z.object({ data: StaffSchema }),
        },
      },
    },
    404: {
      description: '人員不存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(getRoute, async (c) => {
  const supabase = c.get('supabase');
  const { id } = c.req.valid('param');

  const staffRow = await getStaffById(supabase, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const { campusMap, subjectMap, roleInfoMap } = await loadStaffRelations(supabase, [staffRow]);
  return c.json({ data: mapStaff(staffRow, campusMap, subjectMap, roleInfoMap) }, 200);
});

// POST /api/staff
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['Staff'],
  summary: '新增人員',
  description: '建立 auth.user + staff + user_roles + staff_campuses',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateStaffSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: '成功新增人員',
      content: {
        'application/json': {
          schema: z.object({ data: StaffSchema }),
        },
      },
    },
    400: {
      description: '資料驗證錯誤',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    403: {
      description: '權限不足',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    409: {
      description: 'Email 已存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(createRouteDef, async (c) => {
  const supabase = c.get('supabase');
  const requesterUserId = c.get('userId');
  const orgId = c.get('orgId');
  const body = c.req.valid('json');

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可新增人員', code: 'FORBIDDEN' }, 403);
  }

  const hasTeacherRole = body.roles.includes('teacher');
  if (hasTeacherRole && (!body.subjectIds || body.subjectIds.length === 0)) {
    return c.json({ error: '老師必須至少有一個教學科目', code: 'SUBJECTS_REQUIRED' }, 400);
  }

  const campusesValid = await validateCampusIdsInOrg(supabase, orgId, body.campusIds);
  if (!campusesValid) {
    return c.json({ error: '分校資料不正確', code: 'INVALID_CAMPUSES' }, 400);
  }

  if (body.subjectIds && body.subjectIds.length > 0) {
    const subjectsValid = await validateSubjectIdsInOrg(supabase, orgId, body.subjectIds);
    if (!subjectsValid) {
      return c.json({ error: '科目資料不正確', code: 'INVALID_SUBJECTS' }, 400);
    }
  }

  const auth = createAuth(c.env);
  const password = generateRandomPassword();
  let createdUserId: string | null = null;

  try {
    const newUser = await auth.api.createUser({
      body: {
        name: body.displayName,
        email: body.email,
        password,
        data: {
          display_name: body.displayName,
        },
      },
      asResponse: false,
    });

    createdUserId = newUser.user.id;
  } catch (error) {
    const authErrorMessage = error instanceof Error ? error.message : String(error);
    if (isDuplicateEmailError(authErrorMessage)) {
      return c.json({ error: 'Email 已被使用', code: 'DUPLICATE_EMAIL' }, 409);
    }
    return c.json(
      { error: authErrorMessage || '建立帳號失敗', code: 'CREATE_AUTH_USER_FAILED' },
      400,
    );
  }

  const rollbackCreatedUser = async () => {
    if (!createdUserId) {
      return;
    }

    try {
      await auth.api.removeUser({
        body: {
          userId: createdUserId,
        },
        headers: c.req.raw.headers,
        asResponse: false,
      });
    } catch (_error) {
      // ignore rollback errors
    }
  };

  const { error: updateUserError } = await supabase
    .from('ba_user')
    .update({ orgId: orgId })
    .eq('id', createdUserId);

  if (updateUserError) {
    await rollbackCreatedUser();
    return c.json({ error: updateUserError.message, code: 'UPDATE_USER_ORG_FAILED' }, 400);
  }

  const { data: staffRow, error: insertStaffError } = await supabase
    .from('staff')
    .insert({
      user_id: createdUserId,
      org_id: orgId,
      display_name: body.displayName,
      phone: body.phone || null,
      email: body.email,
      birthday: body.birthday || null,
      notes: body.notes || null,
      is_active: true,
    })
    .select('*')
    .single();

  if (insertStaffError || !staffRow) {
    await rollbackCreatedUser();
    return c.json(
      { error: insertStaffError?.message || '建立人員資料失敗', code: 'CREATE_STAFF_FAILED' },
      400,
    );
  }

  // Insert multiple roles
  const roleRows = body.roles.map((role) => ({
    user_id: createdUserId,
    role,
    permissions: role === 'admin' ? normalizeAdminPermissions('admin', body.permissions) : [],
  }));

  const { error: roleError } = await supabase.from('user_roles').insert(roleRows);

  if (roleError) {
    await supabase.from('staff').delete().eq('id', staffRow.id);
    await rollbackCreatedUser();
    return c.json({ error: roleError.message, code: 'CREATE_ROLE_FAILED' }, 400);
  }

  const campusRows = Array.from(new Set(body.campusIds)).map((campusId) => ({
    staff_id: staffRow.id as string,
    campus_id: campusId,
  }));

  const { error: staffCampusError } = await supabase.from('staff_campuses').insert(campusRows);
  if (staffCampusError) {
    await supabase.from('staff').delete().eq('id', staffRow.id);
    await rollbackCreatedUser();
    return c.json({ error: staffCampusError.message, code: 'CREATE_STAFF_CAMPUSES_FAILED' }, 400);
  }

  if (body.subjectIds && body.subjectIds.length > 0) {
    const subjectRows = Array.from(new Set(body.subjectIds)).map((subjectId) => ({
      staff_id: staffRow.id as string,
      subject_id: subjectId,
    }));

    const { error: staffSubjectError } = await supabase.from('staff_subjects').insert(subjectRows);
    if (staffSubjectError) {
      await supabase.from('staff').delete().eq('id', staffRow.id);
      await rollbackCreatedUser();
      return c.json({ error: staffSubjectError.message, code: 'CREATE_STAFF_SUBJECTS_FAILED' }, 400);
    }
  }

  const freshStaffRow = await getStaffById(supabase, staffRow.id as string);
  if (!freshStaffRow) {
    return c.json({ error: '建立人員後讀取失敗', code: 'READ_AFTER_CREATE_FAILED' }, 400);
  }

  logAudit(supabase, {
    orgId,
    userId: requesterUserId,
    resourceType: 'staff',
    resourceId: staffRow.id as string,
    resourceName: body.displayName,
    action: 'create',
  }, c.executionCtx.waitUntil.bind(c.executionCtx));

  const { campusMap, subjectMap, roleInfoMap } = await loadStaffRelations(supabase, [freshStaffRow]);
  return c.json(
    {
      data: mapStaff(freshStaffRow, campusMap, subjectMap, roleInfoMap),
      initialPassword: password,
    },
    201,
  );
});

// PUT /api/staff/:id
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Staff'],
  summary: '更新人員',
  request: {
    params: z.object({
      id: z.uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateStaffSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: '成功更新人員',
      content: {
        'application/json': {
          schema: z.object({ data: StaffSchema }),
        },
      },
    },
    400: {
      description: '更新失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    403: {
      description: '權限不足',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '人員不存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(updateRoute, async (c) => {
  const supabase = c.get('supabase');
  const requesterUserId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const staffRow = await getStaffById(supabase, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可更新人員', code: 'FORBIDDEN' }, 403);
  }

  if (body.campusIds !== undefined) {
    const orgId = staffRow['org_id'] as string;
    const campusesValid = await validateCampusIdsInOrg(supabase, orgId, body.campusIds);
    if (!campusesValid) {
      return c.json({ error: '分校資料不正確', code: 'INVALID_CAMPUSES' }, 400);
    }
  }

  if (body.subjectIds !== undefined) {
    const orgId = staffRow['org_id'] as string;
    const subjectsValid = await validateSubjectIdsInOrg(supabase, orgId, body.subjectIds);
    if (!subjectsValid) {
      return c.json({ error: '科目資料不正確', code: 'INVALID_SUBJECTS' }, 400);
    }
  }

  const updateData: Record<string, unknown> = {};
  if (body.displayName !== undefined) updateData['display_name'] = body.displayName;
  if (body.phone !== undefined) updateData['phone'] = body.phone;
  if (body.birthday !== undefined) updateData['birthday'] = body.birthday;
  if (body.notes !== undefined) updateData['notes'] = body.notes;
  if (body.isActive !== undefined) updateData['is_active'] = body.isActive;

  if (Object.keys(updateData).length > 0) {
    const { error: updateStaffError } = await supabase
      .from('staff')
      .update(updateData)
      .eq('id', id);
    if (updateStaffError) {
      return c.json({ error: updateStaffError.message, code: 'UPDATE_STAFF_FAILED' }, 400);
    }
  }

  if (body.displayName !== undefined) {
    const { error: updateProfileError } = await supabase
      .from('profiles')
      .update({ display_name: body.displayName })
      .eq('id', staffRow['user_id'] as string);

    if (updateProfileError) {
      return c.json({ error: updateProfileError.message, code: 'UPDATE_PROFILE_FAILED' }, 400);
    }
  }

  if (body.campusIds !== undefined) {
    const uniqueCampusIds = Array.from(new Set(body.campusIds));

    const { error: deleteCampusLinksError } = await supabase
      .from('staff_campuses')
      .delete()
      .eq('staff_id', id);

    if (deleteCampusLinksError) {
      return c.json(
        { error: deleteCampusLinksError.message, code: 'UPDATE_STAFF_CAMPUSES_FAILED' },
        400,
      );
    }

    const campusRows = uniqueCampusIds.map((campusId) => ({
      staff_id: id,
      campus_id: campusId,
    }));

    const { error: insertCampusLinksError } = await supabase
      .from('staff_campuses')
      .insert(campusRows);

    if (insertCampusLinksError) {
      return c.json(
        { error: insertCampusLinksError.message, code: 'UPDATE_STAFF_CAMPUSES_FAILED' },
        400,
      );
    }
  }

  if (body.subjectIds !== undefined) {
    const uniqueSubjectIds = Array.from(new Set(body.subjectIds));

    const { error: deleteSubjectLinksError } = await supabase
      .from('staff_subjects')
      .delete()
      .eq('staff_id', id);

    if (deleteSubjectLinksError) {
      return c.json(
        { error: deleteSubjectLinksError.message, code: 'UPDATE_STAFF_SUBJECTS_FAILED' },
        400,
      );
    }

    if (uniqueSubjectIds.length > 0) {
      const subjectRows = uniqueSubjectIds.map((subjectId) => ({
        staff_id: id,
        subject_id: subjectId,
      }));

      const { error: insertSubjectLinksError } = await supabase
        .from('staff_subjects')
        .insert(subjectRows);

      if (insertSubjectLinksError) {
        return c.json(
          { error: insertSubjectLinksError.message, code: 'UPDATE_STAFF_SUBJECTS_FAILED' },
          400,
        );
      }
    }
  }

  const userId = staffRow['user_id'] as string;

  // Handle roles update
  if (body.roles !== undefined) {
    // Delete existing roles
    const { error: deleteRolesError } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .in('role', ['admin', 'teacher']);

    if (deleteRolesError) {
      return c.json({ error: deleteRolesError.message, code: 'UPDATE_ROLES_FAILED' }, 400);
    }

    // Insert new roles
    const roleRows = body.roles.map((role) => ({
      user_id: userId,
      role,
      permissions: role === 'admin' ? normalizeAdminPermissions('admin', body.permissions) : [],
    }));

    const { error: insertRolesError } = await supabase.from('user_roles').insert(roleRows);

    if (insertRolesError) {
      return c.json({ error: insertRolesError.message, code: 'UPDATE_ROLES_FAILED' }, 400);
    }
  } else if (body.permissions !== undefined) {
    // Only update permissions if roles not being changed
    const { data: existingRoleRows } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['admin', 'teacher']);

    const hasAdminRole = (existingRoleRows || []).some((roleRow) => roleRow.role === 'admin');
    if (hasAdminRole) {
      const permissions = normalizeAdminPermissions('admin', body.permissions);
      const { error: updatePermissionsError } = await supabase
        .from('user_roles')
        .update({ permissions })
        .eq('user_id', userId)
        .eq('role', 'admin');

      if (updatePermissionsError) {
        return c.json(
          { error: updatePermissionsError.message, code: 'UPDATE_PERMISSIONS_FAILED' },
          400,
        );
      }
    }
  }

  const freshStaffRow = await getStaffById(supabase, id);
  if (!freshStaffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  logAudit(supabase, {
    orgId: freshStaffRow['org_id'] as string,
    userId: requesterUserId,
    resourceType: 'staff',
    resourceId: id,
    resourceName: freshStaffRow['display_name'] as string,
    action: 'update',
  }, c.executionCtx.waitUntil.bind(c.executionCtx));

  const { campusMap, subjectMap, roleInfoMap } = await loadStaffRelations(supabase, [freshStaffRow]);
  return c.json({ data: mapStaff(freshStaffRow, campusMap, subjectMap, roleInfoMap) }, 200);
});

// DELETE /api/staff/:id
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Staff'],
  summary: '刪除人員',
  request: {
    params: z.object({
      id: z.uuid(),
    }),
  },
  responses: {
    200: {
      description: '成功刪除人員',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
    400: {
      description: '刪除失敗',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    403: {
      description: '權限不足',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
    404: {
      description: '人員不存在',
      content: {
        'application/json': {
          schema: ErrorSchema,
        },
      },
    },
  },
});

app.openapi(deleteRoute, async (c) => {
  const supabase = c.get('supabase');
  const requesterUserId = c.get('userId');
  const { id } = c.req.valid('param');

  const staffRow = await getStaffById(supabase, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可刪除人員', code: 'FORBIDDEN' }, 403);
  }

  const userId = staffRow['user_id'] as string;

  const { error: deleteStaffError } = await supabase.from('staff').delete().eq('id', id);
  if (deleteStaffError) {
    return c.json({ error: deleteStaffError.message, code: 'DELETE_STAFF_FAILED' }, 400);
  }

  const { error: deleteRoleError } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .in('role', ['admin', 'teacher']);

  if (deleteRoleError) {
    return c.json({ error: deleteRoleError.message, code: 'DELETE_ROLE_FAILED' }, 400);
  }

  logAudit(supabase, {
    orgId: staffRow['org_id'] as string,
    userId: requesterUserId,
    resourceType: 'staff',
    resourceId: id,
    resourceName: staffRow['display_name'] as string,
    action: 'delete',
  }, c.executionCtx.waitUntil.bind(c.executionCtx));

  return c.json({ success: true }, 200);
});

export default app;
