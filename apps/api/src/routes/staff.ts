import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuth } from '../lib/get-auth';
import { mintLoginLinkForRequest } from './login-links/mint';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { PERMISSIONS } from '../lib/permissions';
import { checkRoleAssignment } from '../lib/role-assignment';
import { campusFilterIds } from '../lib/campus-scope';

// ============================================================
// Schemas
// ============================================================

const StaffRoleSchema = z.enum(['admin', 'teacher']).openapi('StaffRole');

// 詞彙表的家在 lib/permissions.ts —— 那裡有 harness gate 守著「每個權限都要有
// mount 真的用到」。這裡只是把它變成 zod。
const PermissionSchema = z.enum(PERMISSIONS).openapi('Permission');

const StaffStatusSchema = z.enum(['active', 'inactive', 'archived']).openapi('StaffStatus');

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
    status: StaffStatusSchema,
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
    summary: z.object({
      total: z.number(),
      adminCount: z
        .number()
        .openapi({
          description: '有 admin 角色的人次——跟 teacherCount 可能重疊，不是 total 的分割',
        }),
      teacherCount: z
        .number()
        .openapi({
          description: '有 teacher 角色的人次——跟 adminCount 可能重疊，不是 total 的分割',
        }),
      multiRoleCount: z
        .number()
        .openapi({ description: '同時具備一個以上角色的人數（目前即 admin ∩ teacher）' }),
      activeCount: z.number(),
      inactiveCount: z.number(),
      archivedCount: z.number(),
    }),
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
    email: z.email().openapi({ description: 'Email（產生一次性登入連結時的查人鍵）' }),
    phone: z.string().max(30).nullable().optional().openapi({ description: '電話' }),
    birthday: DateStringSchema.nullable().optional().openapi({ description: '生日（YYYY-MM-DD）' }),
    notes: z.string().max(2000).nullable().optional().openapi({ description: '備註' }),
    subjectIds: z.array(z.uuid()).optional().openapi({ description: '教學科目 IDs（老師用）' }),
    campusIds: z.array(z.uuid()).min(1).openapi({ description: '服務分校 IDs' }),
    roles: z
      .array(StaffRoleSchema)
      .min(1)
      .openapi({ description: '角色：admin、teacher（可多選）' }),
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
    status: StaffStatusSchema.optional(),
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
  subjectId: z.uuid().optional().openapi({ description: '科目篩選' }),
  status: StaffStatusSchema.optional().openapi({ description: '篩選狀態' }),
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

interface StaffSummary {
  total: number;
  /**
   * **角色人次，不是人數的分割**。`adminCount + teacherCount` 可以大於 `total`
   * ——同時具備 admin 與 teacher 兩個角色的人會在兩邊都被算一次
   * （見 `staff.spec.ts` 的 `buildStaffSummary` 測試，那個不一致是刻意的）。
   */
  adminCount: number;
  teacherCount: number;
  /** 同時具備一個以上角色（目前只有 admin/teacher 兩種）的人數，不是「剛好兩個」——
   *  角色種類以後若增加，這個名字不會產生歧義。 */
  multiRoleCount: number;
  activeCount: number;
  inactiveCount: number;
  archivedCount: number;
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

    const subjectName = Array.isArray(row.subjects) ? row.subjects[0]?.name : row.subjects?.name;
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
  baUserMap: Map<string, { email: string | null; phone: string | null }>,
) {
  const userId = row['user_id'] as string;
  const staffId = row['id'] as string;
  const roleInfo = roleInfoMap.get(userId) ?? { roles: [] as StaffRole[], permissions: [] };
  const baUser = baUserMap.get(userId) ?? { email: null, phone: null };

  return {
    id: staffId,
    userId,
    orgId: row['org_id'] as string,
    displayName: row['display_name'] as string,
    phone: baUser.phone,
    email: baUser.email ?? '',
    birthday: row['birthday'] as string | null,
    notes: row['notes'] as string | null,
    subjectIds: subjectMap.get(staffId)?.ids ?? [],
    subjectNames: subjectMap.get(staffId)?.names ?? [],
    status: row['status'] as 'active' | 'inactive' | 'archived',
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    campusIds: campusMap.get(staffId) || [],
    roles: roleInfo.roles,
    permissions: roleInfo.permissions,
  };
}

export function buildStaffSummary(
  rows: Array<{ user_id: string; status: string }>,
  roleInfoMap: Map<string, RoleInfo>,
): StaffSummary {
  let adminCount = 0;
  let teacherCount = 0;
  let multiRoleCount = 0;
  let activeCount = 0;
  let inactiveCount = 0;
  let archivedCount = 0;

  for (const row of rows) {
    const roleInfo = roleInfoMap.get(row.user_id);
    const isAdmin = roleInfo?.roles.includes('admin') ?? false;
    const isTeacher = roleInfo?.roles.includes('teacher') ?? false;
    if (isAdmin) {
      adminCount++;
    }
    if (isTeacher) {
      teacherCount++;
    }
    if (isAdmin && isTeacher) {
      multiRoleCount++;
    }
    if (row.status === 'active') {
      activeCount++;
    } else if (row.status === 'inactive') {
      inactiveCount++;
    } else {
      archivedCount++;
    }
  }

  return {
    total: rows.length,
    adminCount,
    teacherCount,
    multiRoleCount,
    activeCount,
    inactiveCount,
    archivedCount,
  };
}

function emptyStaffSummary(): StaffSummary {
  return {
    total: 0,
    adminCount: 0,
    teacherCount: 0,
    multiRoleCount: 0,
    activeCount: 0,
    inactiveCount: 0,
    archivedCount: 0,
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

async function loadStaffRelations(
  supabase: SupabaseClient,
  staffRows: Record<string, unknown>[],
): Promise<{
  campusMap: Map<string, string[]>;
  subjectMap: Map<string, SubjectInfo>;
  roleInfoMap: Map<string, RoleInfo>;
  baUserMap: Map<string, { email: string | null; phone: string | null }>;
}> {
  const staffIds = staffRows.map((row) => row['id'] as string);
  const userIds = staffRows.map((row) => row['user_id'] as string);

  if (staffIds.length === 0 || userIds.length === 0) {
    return {
      campusMap: new Map<string, string[]>(),
      subjectMap: new Map<string, SubjectInfo>(),
      roleInfoMap: new Map<string, RoleInfo>(),
      baUserMap: new Map<string, { email: string | null; phone: string | null }>(),
    };
  }

  const [{ data: campusRows }, { data: subjectRows }, { data: roleRows }, { data: baUserRows }] =
    await Promise.all([
      supabase
        .from('staff_campuses')
        .select('staff_id, campus_id, campuses!inner(id)')
        .in('staff_id', staffIds),
      supabase
        .from('staff_subjects')
        .select('staff_id, subject_id, subjects(name)')
        .in('staff_id', staffIds),
      supabase.from('user_roles').select('user_id, role, permissions').in('user_id', userIds),
      supabase.from('ba_user').select('id, email, phone').in('id', userIds),
    ]);

  const filteredRoleRows = (roleRows || []).filter(
    (row) => row.role === 'admin' || row.role === 'teacher',
  ) as UserRoleRow[];

  const baUserMap = new Map<string, { email: string | null; phone: string | null }>();
  for (const baUserRow of baUserRows ?? []) {
    baUserMap.set(baUserRow.id as string, {
      email: (baUserRow.email as string | null) ?? null,
      phone: (baUserRow.phone as string | null) ?? null,
    });
  }

  return {
    campusMap: toCampusMap((campusRows || []) as StaffCampusRow[]),
    subjectMap: toSubjectMap((subjectRows || []) as StaffSubjectRow[]),
    roleInfoMap: toRoleInfoMap(filteredRoleRows),
    baUserMap,
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
  const campusScope = c.get('campusScope');

  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const rawPageSize = query.pageSize !== undefined ? parseInt(query.pageSize, 10) : 20;
  const unpaginated = rawPageSize === 0;
  const pageSize = unpaginated ? 0 : Math.max(rawPageSize, 1);
  const offset = (page - 1) * pageSize;

  let filteredStaffIdsByCampus: string[] | null = null;
  let filteredStaffIdsBySubject: string[] | null = null;
  let filteredUserIdsByRole: string[] | null = null;

  // 沒指定分校時也要縮到自己管的那幾間。**人員清單尤其重要** ——
  // 只管 A 校的主任不該看得到 B 校的員工名單與聯絡方式。
  const campusIds = campusFilterIds(campusScope, query.campusId);
  if (campusIds) {
    const { data: campusLinks } = await supabase
      .from('staff_campuses')
      .select('staff_id, campuses!inner(id)')
      .in('campus_id', [...campusIds]);
    filteredStaffIdsByCampus = (campusLinks || []).map((row) => row.staff_id);
  }

  if (query.role) {
    // 用 ba_user.orgId 而不是 profiles.org_id：profiles 只有 seed.sql 會寫入，
    // 透過 app 建立的員工在那裡沒有列，拿它篩選會讓這些人整批從結果消失。
    const { data: orgUsers, error: orgProfileError } = await supabase
      .from('ba_user')
      .select('id')
      .eq('orgId', orgId);

    if (orgProfileError) {
      return c.json({ error: orgProfileError.message, code: 'DB_ERROR' }, 400);
    }

    const orgUserIds = (orgUsers || []).map((user) => user.id);
    if (orgUserIds.length === 0) {
      return c.json(
        {
          data: [],
          summary: emptyStaffSummary(),
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

  if (query.subjectId) {
    const { data: subjectLinks, error: subjectFilterError } = await supabase
      .from('staff_subjects')
      .select('staff_id')
      .eq('subject_id', query.subjectId);

    if (subjectFilterError) {
      return c.json({ error: subjectFilterError.message, code: 'DB_ERROR' }, 400);
    }

    filteredStaffIdsBySubject = (subjectLinks || []).map((row) => row.staff_id);
  }

  // 條件是 `campusIds` 不是 `query.campusId` —— 受分校限制的管理員即使沒指定分校，
  // 查不到人也要回空，不能落下去變成「看到全部」
  if (campusIds && filteredStaffIdsByCampus && filteredStaffIdsByCampus.length === 0) {
    return c.json(
      {
        data: [],
        summary: emptyStaffSummary(),
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
        summary: emptyStaffSummary(),
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

  if (query.subjectId && filteredStaffIdsBySubject && filteredStaffIdsBySubject.length === 0) {
    return c.json(
      {
        data: [],
        summary: emptyStaffSummary(),
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

  let dbQuery = supabase.from('staff').select('*', { count: 'exact' }).eq('org_id', orgId);
  let matchingUserIds: string[] = [];

  if (query.search) {
    const { data: baMatches } = await supabase
      .from('ba_user')
      .select('id')
      .or(`email.ilike.%${query.search}%,phone.ilike.%${query.search}%`);
    matchingUserIds = (baMatches ?? []).map((user: { id: string }) => user.id);

    if (matchingUserIds.length > 0) {
      dbQuery = dbQuery.or(
        `display_name.ilike.%${query.search}%,user_id.in.(${matchingUserIds.join(',')})`,
      );
    } else {
      dbQuery = dbQuery.ilike('display_name', `%${query.search}%`);
    }
  }

  if (query.status !== undefined) {
    dbQuery = dbQuery.eq('status', query.status);
  }

  if (filteredStaffIdsByCampus) {
    dbQuery = dbQuery.in('id', filteredStaffIdsByCampus);
  }

  if (filteredStaffIdsBySubject) {
    dbQuery = dbQuery.in('id', filteredStaffIdsBySubject);
  }

  if (filteredUserIdsByRole) {
    dbQuery = dbQuery.in('user_id', filteredUserIdsByRole);
  }

  dbQuery = dbQuery.order('created_at', { ascending: false });
  if (!unpaginated) dbQuery = dbQuery.range(offset, offset + pageSize - 1);

  const { data, count, error } = await dbQuery;

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  const staffRows = (data || []) as Record<string, unknown>[];
  const { campusMap, subjectMap, roleInfoMap, baUserMap } = await loadStaffRelations(
    supabase,
    staffRows,
  );
  const staffList = staffRows.map((row) =>
    mapStaff(row, campusMap, subjectMap, roleInfoMap, baUserMap),
  );
  const total = count || 0;

  // summary 不套用 status filter，永遠反映全機構（含封存）的真實總數
  let summaryQuery = supabase.from('staff').select('user_id, status').eq('org_id', orgId);

  if (query.search) {
    if (matchingUserIds.length > 0) {
      summaryQuery = summaryQuery.or(
        `display_name.ilike.%${query.search}%,user_id.in.(${matchingUserIds.join(',')})`,
      );
    } else {
      summaryQuery = summaryQuery.ilike('display_name', `%${query.search}%`);
    }
  }

  if (filteredStaffIdsByCampus) {
    summaryQuery = summaryQuery.in('id', filteredStaffIdsByCampus);
  }

  if (filteredStaffIdsBySubject) {
    summaryQuery = summaryQuery.in('id', filteredStaffIdsBySubject);
  }

  if (filteredUserIdsByRole) {
    summaryQuery = summaryQuery.in('user_id', filteredUserIdsByRole);
  }

  const { data: summaryRows, error: summaryError } = await summaryQuery;

  if (summaryError) {
    return c.json({ error: summaryError.message, code: 'DB_ERROR' }, 400);
  }

  const summaryUserIds = Array.from(
    new Set(((summaryRows || []) as Array<{ user_id: string }>).map((row) => row.user_id)),
  );
  let summaryRoleInfoMap = new Map<string, RoleInfo>();

  if (summaryUserIds.length > 0) {
    const { data: summaryRoleRows, error: summaryRoleError } = await supabase
      .from('user_roles')
      .select('user_id, role, permissions')
      .in('user_id', summaryUserIds);

    if (summaryRoleError) {
      return c.json({ error: summaryRoleError.message, code: 'DB_ERROR' }, 400);
    }

    const filteredSummaryRoleRows = (summaryRoleRows || []).filter(
      (row) => row.role === 'admin' || row.role === 'teacher',
    ) as UserRoleRow[];
    summaryRoleInfoMap = toRoleInfoMap(filteredSummaryRoleRows);
  }

  const typedSummaryRows = (summaryRows || []) as Array<{ user_id: string; status: string }>;
  const summary = buildStaffSummary(typedSummaryRows, summaryRoleInfoMap);

  return c.json(
    {
      data: staffList,
      summary,
      meta: {
        total,
        page: unpaginated ? 1 : page,
        pageSize: unpaginated ? total : pageSize,
        totalPages: unpaginated ? 1 : Math.ceil(total / pageSize),
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

  const { campusMap, subjectMap, roleInfoMap, baUserMap } = await loadStaffRelations(supabase, [
    staffRow,
  ]);
  return c.json({ data: mapStaff(staffRow, campusMap, subjectMap, roleInfoMap, baUserMap) }, 200);
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
          schema: z.object({ data: StaffSchema, loginUrl: z.string().nullable() }),
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

  // 建立帳號一定會指定角色，所以一定要 `manage_roles` —— 否則「能建人」就等於
  // 「能給自己開一個權限全開的帳號」。mount 那層的 `manage_staff` 只管到人事資料。
  const assignment = checkRoleAssignment({
    permissions: c.get('permissions') ?? [],
    requesterUserId,
    targetUserId: null,
    touchesRoleAssignment: true,
  });
  if (!assignment.ok) {
    return c.json({ error: assignment.message, code: 'FORBIDDEN' }, 403);
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

  const auth = getAuth(c);
  // **刻意不給 password** —— Better Auth 的 createUser 明說不給就是「magic link 或
  // social login only user」。給了會做一次 scrypt，那正是撞爆 Workers 10ms CPU 的東西。
  let createdUserId: string | null = null;

  try {
    const newUser = await (auth.api as any).createUser({
      body: {
        name: body.displayName,
        email: body.email,
        data: {
          display_name: body.displayName,
          ...(body.phone ? { phone: body.phone } : {}),
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
    console.error('[staff] 建立帳號失敗（非預期）:', error);
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
    } catch (rollbackError) {
      console.error(`[staff] rollback 失敗，孤兒 ba_user=${createdUserId}:`, rollbackError);
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
      birthday: body.birthday || null,
      notes: body.notes || null,
      status: 'active',
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

  // phone 不在這裡寫：上面的 createUser 已經把它帶在 `data` 裡（`phone` 在 auth.ts 的
  // additionalFields 是 `input: true`）。這裡原本有一次重複的直寫 ba_user，2026-09-03 移除。

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
      return c.json(
        { error: staffSubjectError.message, code: 'CREATE_STAFF_SUBJECTS_FAILED' },
        400,
      );
    }
  }

  const freshStaffRow = await getStaffById(supabase, staffRow.id as string);
  if (!freshStaffRow) {
    return c.json({ error: '建立人員後讀取失敗', code: 'READ_AFTER_CREATE_FAILED' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId,
      userId: requesterUserId,
      resourceType: 'staff',
      resourceId: staffRow.id as string,
      resourceName: body.displayName,
      action: 'create',
    },
    waitUntilFrom(c),
  );

  const { campusMap, subjectMap, roleInfoMap, baUserMap } = await loadStaffRelations(supabase, [
    freshStaffRow,
  ]);

  // 建立完就產生連結 —— 櫃檯當場把它變成 QR 給對方掃
  const loginUrl = await mintLoginLinkForRequest(c, body.email);

  return c.json(
    {
      data: mapStaff(freshStaffRow, campusMap, subjectMap, roleInfoMap, baUserMap),
      // 取代原本的 initialPassword：把連結變成 QR 給對方當場掃，是綁定成功率最高的時刻
      loginUrl,
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

  const userId = staffRow['user_id'] as string;

  // 改人事資料是 `manage_staff`（mount 擋過了）；**指定角色與權限是 `manage_roles`**，
  // 而且不論有什麼權限都不能改自己 —— 提權的路要經過另一個人。
  const assignment = checkRoleAssignment({
    permissions: c.get('permissions') ?? [],
    requesterUserId,
    targetUserId: userId,
    touchesRoleAssignment: body.roles !== undefined || body.permissions !== undefined,
  });
  if (!assignment.ok) {
    return c.json({ error: assignment.message, code: 'FORBIDDEN' }, 403);
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
  if (body.birthday !== undefined) updateData['birthday'] = body.birthday;
  if (body.notes !== undefined) updateData['notes'] = body.notes;
  if (body.status !== undefined) updateData['status'] = body.status;

  if (Object.keys(updateData).length > 0) {
    const { error: updateStaffError } = await supabase
      .from('staff')
      .update(updateData)
      .eq('id', id);
    if (updateStaffError) {
      return c.json({ error: updateStaffError.message, code: 'UPDATE_STAFF_FAILED' }, 400);
    }
  }

  // Sync phone to ba_user (staff.phone column no longer exists)
  if (body.phone !== undefined) {
    await supabase.from('ba_user').update({ phone: body.phone }).eq('id', userId);
  }

  if (body.displayName !== undefined) {
    const { error: updateProfileError } = await supabase
      .from('profiles')
      .update({ display_name: body.displayName })
      .eq('id', userId);

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

  logAudit(
    supabase,
    {
      orgId: freshStaffRow['org_id'] as string,
      userId: requesterUserId,
      resourceType: 'staff',
      resourceId: id,
      resourceName: freshStaffRow['display_name'] as string,
      action: 'update',
    },
    waitUntilFrom(c),
  );

  const { campusMap, subjectMap, roleInfoMap, baUserMap } = await loadStaffRelations(supabase, [
    freshStaffRow,
  ]);
  return c.json(
    { data: mapStaff(freshStaffRow, campusMap, subjectMap, roleInfoMap, baUserMap) },
    200,
  );
});

// PATCH /api/staff/:id/archive
const archiveRoute = createRoute({
  method: 'patch',
  path: '/{id}/archive',
  tags: ['Staff'],
  summary: '封存人員（軟刪除：停用帳號、解除未來課堂指派，保留歷史紀錄）',
  request: {
    params: z.object({ id: z.uuid() }),
  },
  responses: {
    200: {
      description: '封存成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean(), unassignedSessions: z.number() }),
        },
      },
    },
    400: {
      description: '封存失敗',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: '人員不存在',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

app.openapi(archiveRoute, async (c) => {
  const supabase = c.get('supabase');
  const orgId = c.get('orgId');
  const requesterUserId = c.get('userId');
  const { id } = c.req.valid('param');

  const staffRow = await getStaffById(supabase, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可封存人員', code: 'FORBIDDEN' }, 403);
  }

  // 停用帳號
  const { error: deactivateError } = await supabase
    .from('staff')
    .update({ status: 'archived' })
    .eq('id', id);

  if (deactivateError) {
    return c.json({ error: deactivateError.message, code: 'DB_ERROR' }, 400);
  }

  // 移除登入權限
  const userId = staffRow['user_id'] as string;
  const { error: roleError } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .in('role', ['admin', 'teacher']);

  if (roleError) {
    return c.json({ error: roleError.message, code: 'DB_ERROR' }, 400);
  }

  // 解除未來課堂指派
  const today = new Date().toISOString().split('T')[0];
  const { data: unassigned, error: unassignError } = await supabase
    .from('sessions')
    .update({ teacher_id: null, assignment_status: 'unassigned' })
    .eq('org_id', orgId)
    .eq('teacher_id', id)
    .eq('status', 'scheduled')
    .gte('session_date', today)
    .select('id');

  if (unassignError) {
    return c.json({ error: unassignError.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId: staffRow['org_id'] as string,
      userId: requesterUserId,
      resourceType: 'staff',
      resourceId: id,
      resourceName: staffRow['display_name'] as string,
      action: 'archive',
      details: { archived: true, unassignedSessions: unassigned?.length ?? 0 },
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true, unassignedSessions: unassigned?.length ?? 0 }, 200);
});

// PATCH /api/staff/:id/deactivate
const deactivateRoute = createRoute({
  method: 'patch',
  path: '/{id}/deactivate',
  tags: ['Staff'],
  summary: '停用人員（僅暫時停用，不移除角色與課堂指派）',
  request: {
    params: z.object({ id: z.uuid() }),
  },
  responses: {
    200: {
      description: '停用成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
    400: {
      description: '停用失敗',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: '人員不存在',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

app.openapi(deactivateRoute, async (c) => {
  const supabase = c.get('supabase');
  const requesterUserId = c.get('userId');
  const { id } = c.req.valid('param');

  const staffRow = await getStaffById(supabase, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可停用人員', code: 'FORBIDDEN' }, 403);
  }

  const { error } = await supabase.from('staff').update({ status: 'inactive' }).eq('id', id);
  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId: staffRow['org_id'] as string,
      userId: requesterUserId,
      resourceType: 'staff',
      resourceId: id,
      resourceName: staffRow['display_name'] as string,
      action: 'deactivate',
      details: { inactive: true },
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
});

// PATCH /api/staff/:id/activate
const activateRoute = createRoute({
  method: 'patch',
  path: '/{id}/activate',
  tags: ['Staff'],
  summary: '啟用人員（從停用狀態恢復）',
  request: {
    params: z.object({ id: z.uuid() }),
  },
  responses: {
    200: {
      description: '啟用成功',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
    400: {
      description: '啟用失敗',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: '權限不足',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: '人員不存在',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

app.openapi(activateRoute, async (c) => {
  const supabase = c.get('supabase');
  const requesterUserId = c.get('userId');
  const { id } = c.req.valid('param');

  const staffRow = await getStaffById(supabase, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可啟用人員', code: 'FORBIDDEN' }, 403);
  }

  const { error } = await supabase.from('staff').update({ status: 'active' }).eq('id', id);
  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }

  logAudit(
    supabase,
    {
      orgId: staffRow['org_id'] as string,
      userId: requesterUserId,
      resourceType: 'staff',
      resourceId: id,
      resourceName: staffRow['display_name'] as string,
      action: 'activate',
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
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

  logAudit(
    supabase,
    {
      orgId: staffRow['org_id'] as string,
      userId: requesterUserId,
      resourceType: 'staff',
      resourceId: id,
      resourceName: staffRow['display_name'] as string,
      action: 'delete',
    },
    waitUntilFrom(c),
  );

  return c.json({ success: true }, 200);
});

export default app;
