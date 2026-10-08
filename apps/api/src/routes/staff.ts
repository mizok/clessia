import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { waitUntilFrom } from '../lib/wait-until';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuth } from '../lib/get-auth';
import { mintLoginLinkForRequest } from './login-links/mint';
import type { AppEnv } from '../index';
import { logAudit } from '../utils/audit';
import { isOrphanAuthUser } from '../lib/orphan-auth-user';
import { PERMISSIONS } from '../lib/permissions';
import { addedPermissions, checkRoleAssignment } from '../lib/role-assignment';
import {
  campusFilterIds,
  campusIdsWithinScope,
  getCampusScope,
  grantsWiderThanScope,
} from '../lib/campus-scope';
import { DbUuidSchema } from '../lib/validation';
import { findInOrg, inOrg } from '../lib/org-scope';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';
import { generatePlaceholderEmail } from './parents';

// ============================================================
// Schemas
// ============================================================

const StaffRoleSchema = z.enum(['admin', 'teacher', 'kiosk']).openapi('StaffRole');
/**
 * PUT 能指定的角色。kiosk（#1127）只能在建立時給，而且要單獨給 —— 改成別的角色、
 * 或把 kiosk 加到一般人員身上，等於讓機台與人共用帳號。
 */
const AssignableStaffRoleSchema = z.enum(['admin', 'teacher']).openapi('AssignableStaffRole');

// 詞彙表的家在 lib/permissions.ts —— 那裡有 harness gate 守著「每個權限都要有
// mount 真的用到」。這裡只是把它變成 zod。
const PermissionSchema = z.enum(PERMISSIONS).openapi('Permission');

const StaffStatusSchema = z.enum(['active', 'inactive', 'archived']).openapi('StaffStatus');

const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需為 YYYY-MM-DD');

const StaffSchema = z
  .object({
    id: DbUuidSchema,
    userId: DbUuidSchema,
    orgId: DbUuidSchema,
    displayName: z.string(),
    phone: z.string().nullable(),
    email: z.email(),
    birthday: z.string().nullable(),
    notes: z.string().nullable(),
    subjectIds: z.array(DbUuidSchema),
    subjectNames: z.array(z.string()),
    status: StaffStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    campusIds: z.array(DbUuidSchema),
    roles: z.array(StaffRoleSchema),
    permissions: z.array(PermissionSchema),
  })
  .openapi('Staff');

const StaffListResponseSchema = z
  .object({
    data: z.array(StaffSchema),
    summary: z.object({
      total: z.number(),
      adminCount: z.number().openapi({
        description: '有 admin 角色的人次——跟 teacherCount 可能重疊，不是 total 的分割',
      }),
      teacherCount: z.number().openapi({
        description: '有 teacher 角色的人次——跟 adminCount 可能重疊，不是 total 的分割',
      }),
      multiRoleCount: z
        .number()
        .openapi({ description: '同時具備一個以上角色的人數（目前即 admin ∩ teacher）' }),
      activeCount: z.number(),
      inactiveCount: z.number(),
      archivedCount: z.number(),
      byRole: z
        .object({
          admin: z.number().int(),
          teacher: z.number().int(),
          inactiveOrArchived: z.number().int(),
        })
        .openapi({
          description:
            '依角色分章的章節計數（#1314 ST1），三章互斥：在職且有 admin（兼老師的歸這章）／在職且只有 teacher／停用＋封存。和＝total 減在職且兩個角色都沒有的（機台帳號）',
        }),
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
    email: z.email().optional().openapi({
      description: 'Email（產生一次性登入連結時的查人鍵）；掃碼機台不給，由系統產生佔位值',
    }),
    phone: z.string().max(30).nullable().optional().openapi({ description: '電話' }),
    birthday: DateStringSchema.nullable().optional().openapi({ description: '生日（YYYY-MM-DD）' }),
    notes: z.string().max(2000).nullable().optional().openapi({ description: '備註' }),
    subjectIds: z.array(DbUuidSchema).optional().openapi({ description: '教學科目 IDs（老師用）' }),
    campusIds: z.array(DbUuidSchema).min(1).openapi({ description: '服務分校 IDs' }),
    roles: z
      .array(StaffRoleSchema)
      .min(1)
      .openapi({ description: '角色：admin、teacher（可多選）；kiosk 只能單獨給（#1127）' }),
    permissions: z.array(PermissionSchema).optional().openapi({ description: '管理員權限清單' }),
  })
  .openapi('CreateStaff');

const UpdateStaffSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    phone: z.string().max(30).nullable().optional(),
    birthday: DateStringSchema.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    subjectIds: z.array(DbUuidSchema).optional(),
    campusIds: z.array(DbUuidSchema).min(1).optional(),
    roles: z
      .array(AssignableStaffRoleSchema)
      .min(1)
      .optional()
      .openapi({ description: '角色（可多選）' }),
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
  campusId: DbUuidSchema.optional().openapi({ description: '分校篩選' }),
  subjectId: DbUuidSchema.optional().openapi({ description: '科目篩選' }),
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

const EMPTY_BY_ROLE = { admin: 0, teacher: 0, inactiveOrArchived: 0 } as const;

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

/**
 * `withSummaryFilters` 會用到的 builder 方法。泛型 `Q` 刻意不加約束、在裡面轉型 ——
 * 拿 supabase-js 的 builder 去比對有約束的泛型會撞 TS2589（同 #1245 的 `inOrg` 長 select）
 */
interface StaffFilterable {
  eq(column: string, value: unknown): StaffFilterable;
  in(column: string, values: readonly unknown[]): StaffFilterable;
  or(filters: string): StaffFilterable;
  ilike(column: string, pattern: string): StaffFilterable;
}

/**
 * 依角色分章的章節計數（#1314 ST1）。三章互斥；和＝total 減「在職且 admin／teacher 都沒有」的人
 * （機台帳號 kiosk 也是 staff 列，#1127）：
 * 在職且有 admin（**兼老師的歸管理員章** —— A6 `staff.html`：「身兼兩者的人列在管理員那章，
 * 角色標兩個」）／在職且只有 teacher／停用＋封存。跟既有 adminCount／teacherCount（重疊人次）不同，
 * 那兩個給開場副行用，不動。
 *
 * 每章一支 head count 讓 DB 數 —— 撈 staff 列回來數會被 max_rows（1000）靜默截斷。
 * 角色名單從 `user_roles` 撈（它沒有 org 欄、跟 staff 也沒有 FK 可 embed），交給 head count 的
 * `.in('user_id')`；別 org 的 user_id 對不到本 org 的 staff，不影響計數。
 * ponytail: 角色名單撈到底（每頁 1000），而 `.in()` 的 URL 長度上限約數百人；人員量級超過時改 RPC。
 */
async function countStaffByRole(
  supabase: SupabaseClient,
  withFilters: <Q>(q: Q) => Q,
): Promise<{ admin: number; teacher: number; inactiveOrArchived: number } | { error: string }> {
  const adminIds = new Set<string>();
  const teacherIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .in('role', ['admin', 'teacher'])
      .order('user_id')
      .range(from, from + 999);
    if (error) return { error: error.message };
    for (const row of (data ?? []) as Array<{ user_id: string; role: string }>) {
      (row.role === 'admin' ? adminIds : teacherIds).add(row.user_id);
    }
    if ((data ?? []).length < 1000) break;
  }
  const teacherOnlyIds = [...teacherIds].filter((id) => !adminIds.has(id));

  const head = () => supabase.from('staff').select('id', { count: 'exact', head: true });
  const results = await Promise.all([
    withFilters(head())
      .eq('status', 'active')
      .in('user_id', [...adminIds]),
    withFilters(head()).eq('status', 'active').in('user_id', teacherOnlyIds),
    withFilters(head()).in('status', ['inactive', 'archived']),
  ]);
  // 數不出來就不回 0
  const failed = results.find((r) => r.error)?.error;
  if (failed) return { error: failed.message };
  const [admin, teacher, inactiveOrArchived] = results.map((r) => r.count ?? 0) as [
    number,
    number,
    number,
  ];
  return { admin, teacher, inactiveOrArchived };
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
    (row) => row.role === 'admin' || row.role === 'teacher' || row.role === 'kiosk',
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

/**
 * **所有單筆人員讀寫的入口**，所以 org 範圍收在這一處（c1，#966 B3）。
 * 別 org 的 id 跟不存在一樣回 null → 呼叫端 404。修之前這裡沒有 org 條件，
 * GET／PUT／封存／停用／啟用／刪除全部繼承了那個洞。
 */
function getStaffById(
  supabase: SupabaseClient,
  orgId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  return findInOrg(supabase, 'staff', orgId, id, '*');
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
  const campusScope = getCampusScope(c);

  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const rawPageSize = query.pageSize !== undefined ? parseInt(query.pageSize, 10) : 20;
  const unpaginated = rawPageSize === 0;
  const pageSize = unpaginated ? 0 : Math.max(rawPageSize, 1);
  const offset = (page - 1) * pageSize;

  // 沒指定分校時也要縮到自己管的那幾間。**人員清單尤其重要** ——
  // 只管 A 校的主任不該看得到 B 校的員工名單與聯絡方式。
  const campusIds = campusFilterIds(campusScope, query.campusId);

  // #949：四個篩選查詢（分校、角色、科目、搜尋）彼此互不相依 —— 同一輪發出去。
  // 線上每一輪都是一段 Worker↔DB 往返，原本依序發最多是五段（角色要先查 ba_user）。
  const none = Promise.resolve({ data: null, error: null });
  const [campusResult, roleResult, subjectResult, searchResult] = await Promise.all([
    campusIds
      ? supabase
          .from('staff_campuses')
          .select('staff_id, campuses!inner(id)')
          .in('campus_id', [...campusIds])
      : none,
    // 角色篩選**不先把 user_roles 限縮到本 org**：`user_roles` 沒有 org 欄，原本要先查一輪
    // `ba_user.orgId` 拿本 org 的使用者再 `.in()`。但這份名單只拿去當下面 staff 主查詢的
    // `.in('user_id')`，而主查詢本身就 `eq('org_id')` —— 別 org 的 user_id 對不到任何列，
    // 結果一樣、少一輪。（c12：一個部署一個機構，這份名單本來就只有本機構的人。）
    query.role ? supabase.from('user_roles').select('user_id').eq('role', query.role) : none,
    query.subjectId
      ? supabase.from('staff_subjects').select('staff_id').eq('subject_id', query.subjectId)
      : none,
    query.search
      ? supabase
          .from('ba_user')
          .select('id')
          .or(`email.ilike.%${query.search}%,phone.ilike.%${query.search}%`)
      : none,
  ]);

  if (roleResult.error) {
    return c.json({ error: roleResult.error.message, code: 'DB_ERROR' }, 400);
  }
  if (subjectResult.error) {
    return c.json({ error: subjectResult.error.message, code: 'DB_ERROR' }, 400);
  }

  const filteredStaffIdsByCampus: string[] | null = campusIds
    ? ((campusResult.data ?? []) as Array<{ staff_id: string }>).map((row) => row.staff_id)
    : null;
  const filteredUserIdsByRole: string[] | null = query.role
    ? ((roleResult.data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id)
    : null;
  const filteredStaffIdsBySubject: string[] | null = query.subjectId
    ? ((subjectResult.data ?? []) as Array<{ staff_id: string }>).map((row) => row.staff_id)
    : null;
  const matchingUserIds: string[] = ((searchResult.data ?? []) as Array<{ id: string }>).map(
    (user) => user.id,
  );

  // 條件是 `campusIds` 不是 `query.campusId` —— 受分校限制的管理員即使沒指定分校，
  // 查不到人也要回空，不能落下去變成「看到全部」
  if (campusIds && filteredStaffIdsByCampus && filteredStaffIdsByCampus.length === 0) {
    return c.json(
      {
        data: [],
        summary: { ...emptyStaffSummary(), byRole: EMPTY_BY_ROLE },
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
        summary: { ...emptyStaffSummary(), byRole: EMPTY_BY_ROLE },
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
        summary: { ...emptyStaffSummary(), byRole: EMPTY_BY_ROLE },
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

  if (query.search) {
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

  // summary 不套用 status filter，永遠反映全機構（含封存）的真實總數。
  // 章節計數（byRole）也走同一組篩選，兩者才不會對同一份名單給出兩個總數
  const withSummaryFilters = <Q>(q: Q): Q => {
    let next = (q as unknown as StaffFilterable).eq('org_id', orgId);
    if (query.search) {
      next =
        matchingUserIds.length > 0
          ? next.or(
              `display_name.ilike.%${query.search}%,user_id.in.(${matchingUserIds.join(',')})`,
            )
          : next.ilike('display_name', `%${query.search}%`);
    }
    if (filteredStaffIdsByCampus) next = next.in('id', filteredStaffIdsByCampus);
    if (filteredStaffIdsBySubject) next = next.in('id', filteredStaffIdsBySubject);
    if (filteredUserIdsByRole) next = next.in('user_id', filteredUserIdsByRole);
    return next as unknown as Q;
  };
  const summaryQuery = withSummaryFilters(supabase.from('staff').select('user_id, status'));

  // #949：主查詢與 summary 互不相依（summary 只用篩選條件，不用主查詢的結果）——
  // 同一輪發出去；兩邊各自的關聯（主查詢的 loadStaffRelations、summary 的角色）再一輪。
  const [{ data, count, error }, { data: summaryRows, error: summaryError }] = await Promise.all([
    dbQuery,
    summaryQuery,
  ]);

  if (error) {
    return c.json({ error: error.message, code: 'DB_ERROR' }, 400);
  }
  if (summaryError) {
    return c.json({ error: summaryError.message, code: 'DB_ERROR' }, 400);
  }

  const staffRows = (data || []) as Record<string, unknown>[];
  const summaryUserIds = Array.from(
    new Set(((summaryRows || []) as Array<{ user_id: string }>).map((row) => row.user_id)),
  );

  const [{ campusMap, subjectMap, roleInfoMap, baUserMap }, summaryRoleResult] = await Promise.all([
    loadStaffRelations(supabase, staffRows),
    summaryUserIds.length > 0
      ? supabase
          .from('user_roles')
          .select('user_id, role, permissions')
          .in('user_id', summaryUserIds)
      : Promise.resolve({ data: [] as UserRoleRow[], error: null }),
  ]);

  const staffList = staffRows.map((row) =>
    mapStaff(row, campusMap, subjectMap, roleInfoMap, baUserMap),
  );
  const total = count || 0;

  if (summaryRoleResult.error) {
    return c.json({ error: summaryRoleResult.error.message, code: 'DB_ERROR' }, 400);
  }
  const summaryRoleInfoMap = toRoleInfoMap(
    ((summaryRoleResult.data || []) as UserRoleRow[]).filter(
      (row) => row.role === 'admin' || row.role === 'teacher',
    ),
  );

  const typedSummaryRows = (summaryRows || []) as Array<{ user_id: string; status: string }>;
  const byRole = await countStaffByRole(supabase, withSummaryFilters);
  if ('error' in byRole) {
    return c.json({ error: byRole.error, code: 'DB_ERROR' }, 400);
  }
  const summary = { ...buildStaffSummary(typedSummaryRows, summaryRoleInfoMap), byRole };

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
      id: DbUuidSchema.openapi({ description: '人員 ID' }),
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
  const orgId = c.get('orgId');
  const { id } = c.req.valid('param');

  const staffRow = await getStaffById(supabase, orgId, id);
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

  /**
   * **掃碼機台（#1127）**：只能單獨當 kiosk、剛好一個分校、不帶權限與科目。
   * email 由系統給佔位值（同家長的 `@phone.internal`，從不寄信）—— 機台不是人，沒有信箱。
   * 綁兩個分校的機台在打卡時會被 403（不猜是哪一校），所以在這裡就擋，不讓它建出來。
   */
  const isKiosk = body.roles.includes('kiosk');
  if (isKiosk) {
    if (
      body.roles.length !== 1 ||
      new Set(body.campusIds).size !== 1 ||
      (body.permissions?.length ?? 0) > 0 ||
      (body.subjectIds?.length ?? 0) > 0 ||
      body.email !== undefined
    ) {
      return c.json(
        {
          error: '掃碼機台只能單獨建立、綁一個分校，不能帶權限、科目或 email',
          code: 'INVALID_KIOSK',
        },
        400,
      );
    }
  } else if (!body.email) {
    return c.json({ error: '請填寫 Email', code: 'EMAIL_REQUIRED' }, 400);
  }
  const email =
    body.email ??
    generatePlaceholderEmail(`kiosk-${crypto.randomUUID()}`, c.env.PLACEHOLDER_EMAIL_DOMAIN);

  // 建立帳號一定會指定角色，所以一定要 `manage_roles` —— 否則「能建人」就等於
  // 「能給自己開一個權限全開的帳號」。mount 那層的 `manage_staff` 只管到人事資料。
  const assignment = checkRoleAssignment({
    permissions: c.get('permissions') ?? [],
    requesterUserId,
    targetUserId: null,
    // kiosk 只開得了打卡、發不出任何權限，建它不是提權 —— `manage_staff`（mount）就夠
    touchesRoleAssignment: !isKiosk,
    // 新帳號沒有「原本的」權限，帶的全部都是發出去的（非 admin 的權限會被清空，見 normalizeAdminPermissions）
    grantedPermissions: body.roles.includes('admin') ? (body.permissions ?? []) : [],
  });
  if (!assignment.ok) {
    return c.json({ error: assignment.message, code: 'FORBIDDEN' }, 403);
  }

  const hasTeacherRole = body.roles.includes('teacher');
  if (hasTeacherRole && (!body.subjectIds || body.subjectIds.length === 0)) {
    return c.json({ error: '老師必須至少有一個教學科目', code: 'SUBJECTS_REQUIRED' }, 400);
  }

  // `validateCampusIdsInOrg` 只驗「屬於這個 org」，不驗「屬於請求者的範圍」——
  // 少了下面這段，只管 A 校的管理員可以把人員指派到 B 校（等於發出 B 校的存取權）
  if (!campusIdsWithinScope(getCampusScope(c), body.campusIds)) {
    return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
  }
  // 同一件事的另一個載體：發 `all_campuses` 就是發出不受限的帳號（#966 A 批）
  if (grantsWiderThanScope(getCampusScope(c), body.permissions)) {
    return c.json({ error: '你的範圍受分校限制，不能發出「跨分校」權限', code: 'FORBIDDEN' }, 403);
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

  /**
   * **#833：這個 email 已經有 `ba_user` 時，先看它是不是完全脫離的孤兒。**
   *
   * `ba_user.email` 有 UNIQUE 索引而 `ba_*` 可讀不可寫（c2），所以孤兒列
   * **把那個 email 永久佔住了** —— 而孤兒會持續產生（下面的 `rollbackCreatedUser()`
   * 呼叫的 `removeUser` 在這個專案必定 403，見 DELETE handler 的說明）。
   * 三張表都空才接管，判準與「為什麼是三張」寫在 `lib/orphan-auth-user.ts`。
   *
   * ⚠️ **這裡是精確比對 email。** Better Auth 可能有自己的正規化（大小寫等），
   * 所以比對不到的情況仍然存在 —— 那時會落到下面的 `createUser`，
   * 而它會回既有的 409。**退路是安全的那一邊：接管不到就照舊拒絕。**
   */
  const { data: existingAuthUser } = await supabase
    .from('ba_user')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  let reclaimedUserId: string | null = null;
  if (existingAuthUser) {
    const existingId = (existingAuthUser as { id: string }).id;
    if (!(await isOrphanAuthUser(supabase, existingId))) {
      // 掛著 staff / parents / user_roles 任一 → 那是別人的帳號
      return c.json({ error: 'Email 已被使用', code: 'DUPLICATE_EMAIL' }, 409);
    }
    reclaimedUserId = existingId;
  }

  // ⚠️ **`createdUserId` 只填「我們真的建出來的」** —— 接管來的那一列不能進這個變數，
  // 否則 `rollbackCreatedUser()` 會去刪一個不是我們建的帳號（#833）。
  let createdUserId: string | null = null;
  // 接管路徑不建帳號，所以沒有東西要 rollback
  let rollbackCreatedUser: () => Promise<void> = async () => {};

  if (!reclaimedUserId) {
    // **`getAuth(c)` 也移進來**：它要開 DB 連線（`c.env.HYPERDRIVE`），
    // 而接管路徑根本不呼叫 Better Auth —— 少一次連線，也讓「接管不碰 auth」
    // 這件事在結構上看得出來。
    const auth = getAuth(c);
    // **刻意不給 password** —— Better Auth 的 createUser 明說不給就是「magic link 或
    // social login only user」。給了會做一次 scrypt，那正是撞爆 Workers 10ms CPU 的東西。
    try {
      const newUser = await (auth.api as any).createUser({
        body: {
          name: body.displayName,
          email: email,
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

    rollbackCreatedUser = async () => {
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
        // ⚠️ **這個 catch 從來沒有不被觸發過**：`removeUser` 有 `adminMiddleware` 且要
        // `user:delete` 權限，而這個專案沒有人的 `ba_user.role` 是 admin（#833）。
        // 所以這裡留下的孤兒是真的，而它們由 `POST` 開頭的接管路徑救回來。
        console.error(`[staff] rollback 失敗，孤兒 ba_user=${createdUserId}:`, rollbackError);
      }
    };
  }

  /**
   * 這次要用的 auth 使用者 —— 接管來的或剛建出來的。
   * **`createdUserId` 保持「只有我們建的」**，所以 rollback 不會去動接管的那一列。
   */
  const authUserId = reclaimedUserId ?? createdUserId;
  if (!authUserId) {
    // 走不到：上面兩條路都會 return。留著是因為型別要收斂，而「靜靜地用 null 去建 staff」
    // 會是一筆 user_id 為 null 的孤兒列 —— 那比 500 難查。
    return c.json({ error: '建立帳號失敗', code: 'CREATE_AUTH_USER_FAILED' }, 400);
  }

  const { error: updateUserError } = await supabase
    .from('ba_user')
    .update({ orgId: orgId })
    .eq('id', authUserId);

  if (updateUserError) {
    await rollbackCreatedUser();
    return c.json({ error: updateUserError.message, code: 'UPDATE_USER_ORG_FAILED' }, 400);
  }

  const { data: staffRow, error: insertStaffError } = await supabase
    .from('staff')
    .insert({
      user_id: authUserId,
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
    user_id: authUserId,
    role,
    permissions: role === 'admin' ? normalizeAdminPermissions('admin', body.permissions) : [],
  }));

  const { error: roleError } = await supabase.from('user_roles').insert(roleRows);

  if (roleError) {
    await inOrg(supabase.from('staff').delete().eq('id', staffRow.id), orgId);
    await rollbackCreatedUser();
    return c.json({ error: roleError.message, code: 'CREATE_ROLE_FAILED' }, 400);
  }

  const campusRows = Array.from(new Set(body.campusIds)).map((campusId) => ({
    staff_id: staffRow.id as string,
    campus_id: campusId,
  }));

  const { error: staffCampusError } = await supabase.from('staff_campuses').insert(campusRows);
  if (staffCampusError) {
    await inOrg(supabase.from('staff').delete().eq('id', staffRow.id), orgId);
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
      await inOrg(supabase.from('staff').delete().eq('id', staffRow.id), orgId);
      await rollbackCreatedUser();
      return c.json(
        { error: staffSubjectError.message, code: 'CREATE_STAFF_SUBJECTS_FAILED' },
        400,
      );
    }
  }

  const freshStaffRow = await getStaffById(supabase, orgId, staffRow.id as string);
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
      // **接管要在稽核上看得出來**（#833）：同一個 `action: 'create'`，
      // 但這一筆用的是一個**早就存在的 `ba_user`** —— 而那個 email 上一次屬於誰
      // 只有 audit 回答得出來。不記的話，「這個帳號怎麼會有舊的 session 紀錄」
      // 這種問題查不到源頭。
      ...(reclaimedUserId
        ? { details: { reclaimed_orphan_ba_user: reclaimedUserId, email: email } }
        : {}),
    },
    waitUntilFrom(c),
  );

  const { campusMap, subjectMap, roleInfoMap, baUserMap } = await loadStaffRelations(supabase, [
    freshStaffRow,
  ]);

  // 建立完就產生連結 —— 櫃檯當場把它變成 QR 給對方掃
  const loginUrl = await mintLoginLinkForRequest(c, email);

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
      id: DbUuidSchema,
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
  const orgId = c.get('orgId');
  const requesterUserId = c.get('userId');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const staffRow = await getStaffById(supabase, orgId, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可更新人員', code: 'FORBIDDEN' }, 403);
  }

  const userId = staffRow['user_id'] as string;

  // 掃碼機台（#1127）的角色、權限、科目不能改，分校只能換成另一個（仍然剛好一個）——
  // 建立時那組限制在這裡也要成立，否則 PUT 一次就把機台變成人、或變成綁兩校的機台。
  const touchesKioskShape =
    body.roles !== undefined ||
    body.permissions !== undefined ||
    body.subjectIds !== undefined ||
    (body.campusIds !== undefined && new Set(body.campusIds).size !== 1);
  if (touchesKioskShape) {
    const { data: kioskRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'kiosk')
      .maybeSingle();
    if ((kioskRole as { role?: string } | null)?.role === 'kiosk') {
      return c.json(
        { error: '掃碼機台只能改名稱、狀態與綁定的分校（一個）', code: 'INVALID_KIOSK' },
        400,
      );
    }
  }

  // 「發出去的」只有新增的那幾個（#966 A2'）：對方原本就有的不算，拿掉的更不算。
  // 沒帶 `permissions` 時改角色會沿用原本的（#680），也沒有新增。
  let grantedPermissions: string[] = [];
  if (body.permissions !== undefined) {
    const { data: priorAdminRow } = await supabase
      .from('user_roles')
      .select('permissions')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    const prior = (priorAdminRow as { permissions?: unknown } | null)?.permissions;
    grantedPermissions = addedPermissions(
      Array.isArray(prior) ? (prior as string[]) : [],
      body.permissions,
    );
  }

  // 改人事資料是 `manage_staff`（mount 擋過了）；**指定角色與權限是 `manage_roles`**，
  // 而且不論有什麼權限都不能改自己 —— 提權的路要經過另一個人；也只能發出自己有的權限。
  const assignment = checkRoleAssignment({
    permissions: c.get('permissions') ?? [],
    requesterUserId,
    targetUserId: userId,
    touchesRoleAssignment: body.roles !== undefined || body.permissions !== undefined,
    grantedPermissions,
  });
  if (!assignment.ok) {
    return c.json({ error: assignment.message, code: 'FORBIDDEN' }, 403);
  }
  // 受限的管理員不能替別人加上 `all_campuses`（#966 A 批，見 `grantsWiderThanScope`）
  if (grantsWiderThanScope(getCampusScope(c), body.permissions)) {
    return c.json({ error: '你的範圍受分校限制，不能發出「跨分校」權限', code: 'FORBIDDEN' }, 403);
  }

  if (body.campusIds !== undefined) {
    // **這是自我提權那條路。** `campusScope` 直接來自請求者自己的 `staff_campuses`
    // （middleware/auth.ts:140-150），而上面的 `checkRoleAssignment` 只在動 roles /
    // permissions 時擋「改自己」—— `campusIds` 不在其中。沒有這段，一個只管 A 校的
    // 管理員可以把自己那筆 staff 的分校設成全部，下一個請求起就不受限了。
    // `all_campuses` 是 permission 所以早就被擋住，campusIds 是同一件事的另一個載體。
    if (!campusIdsWithinScope(getCampusScope(c), body.campusIds)) {
      return c.json({ error: '沒有這個分校的權限', code: 'FORBIDDEN' }, 403);
    }

    const campusesValid = await validateCampusIdsInOrg(supabase, orgId, body.campusIds);
    if (!campusesValid) {
      return c.json({ error: '分校資料不正確', code: 'INVALID_CAMPUSES' }, 400);
    }
  }

  if (body.subjectIds !== undefined) {
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
    const { error: updateStaffError } = await inOrg(
      supabase.from('staff').update(updateData).eq('id', id),
      orgId,
    );
    if (updateStaffError) {
      return c.json({ error: updateStaffError.message, code: 'UPDATE_STAFF_FAILED' }, 400);
    }
  }

  // Sync phone to ba_user (staff.phone column no longer exists)
  if (body.phone !== undefined) {
    await supabase.from('ba_user').update({ phone: body.phone }).eq('id', userId);
  }

  if (body.displayName !== undefined) {
    const { error: updateProfileError } = await inOrg(
      supabase.from('profiles').update({ display_name: body.displayName }).eq('id', userId),
      orgId,
    );

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
    /**
     * **改角色是「先刪光再重建」，所以要先把既有權限撈出來**（#680）。
     *
     * `permissions` 在 schema 上是 `.optional()`，而這個端點**沒有任何地方宣告
     * 自己是 PUT 的「整份取代」語意** —— 於是「不帶」原本被實作成「清空」。
     * `PUT /api/staff/{id}` 回 200、沒有警告，而洗掉的是權限：
     * **失效方向是「這個管理員突然看不到東西了」，且沒有任何紀錄說明為什麼。**
     *
     * 使用者裁定**甲：不帶就不動**。讀在 delete 之前 —— 刪完再讀就永遠是空的。
     *
     * **空陣列不等於沒帶**：`?? ` 只在 `undefined` 時退回既有值，
     * 明式送 `[]` 仍然清空 —— 那是前端唯一的清空路徑
     * （`staff-form-dialog.component.ts:187` 非 admin 時明式送 `[]`）。
     */
    const { data: priorRoleRows } = await supabase
      .from('user_roles')
      .select('role, permissions')
      .eq('user_id', userId)
      .eq('role', 'admin');

    const priorAdminPermissions = ((priorRoleRows || []).find(
      (row) => (row as { role?: string }).role === 'admin',
    )?.['permissions'] ?? []) as Permission[];

    const effectivePermissions = body.permissions ?? priorAdminPermissions;

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
      permissions: role === 'admin' ? normalizeAdminPermissions('admin', effectivePermissions) : [],
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

  const freshStaffRow = await getStaffById(supabase, orgId, id);
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
    params: z.object({ id: DbUuidSchema }),
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

  const staffRow = await getStaffById(supabase, orgId, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可封存人員', code: 'FORBIDDEN' }, 403);
  }

  // 停用帳號
  const { error: deactivateError } = await inOrg(
    supabase.from('staff').update({ status: 'archived' }).eq('id', id),
    orgId,
  );

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

  // 解除未來課堂指派 —— 台北時間，不是 UTC（見 lib/taipei-date.ts 檔頭）。
  // ⚠️ 這裡把 teacher_id 設回 null，不是軟刪除：算錯一天會連帶抹掉「誰教了
  // 台北昨天那堂已經發生的課」這個歷史事實，沒有留下任何痕跡（跟
  // cancel-future-sessions 的軟刪除性質不同，那邊還留著 schedule_change）。
  const today = getCurrentTaipeiDateString();
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
    params: z.object({ id: DbUuidSchema }),
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
  const orgId = c.get('orgId');
  const requesterUserId = c.get('userId');
  const { id } = c.req.valid('param');

  const staffRow = await getStaffById(supabase, orgId, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可停用人員', code: 'FORBIDDEN' }, 403);
  }

  const { error } = await inOrg(
    supabase.from('staff').update({ status: 'inactive' }).eq('id', id),
    orgId,
  );
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
    params: z.object({ id: DbUuidSchema }),
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
  const orgId = c.get('orgId');
  const requesterUserId = c.get('userId');
  const { id } = c.req.valid('param');

  const staffRow = await getStaffById(supabase, orgId, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可啟用人員', code: 'FORBIDDEN' }, 403);
  }

  const { error } = await inOrg(
    supabase.from('staff').update({ status: 'active' }).eq('id', id),
    orgId,
  );
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
      id: DbUuidSchema,
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
    409: {
      description: '人員不能刪除，只能封存（#833）',
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
  const orgId = c.get('orgId');
  const requesterUserId = c.get('userId');
  const { id } = c.req.valid('param');

  const staffRow = await getStaffById(supabase, orgId, id);
  if (!staffRow) {
    return c.json({ error: '人員不存在', code: 'NOT_FOUND' }, 404);
  }

  const isAdmin = await checkUserIsAdmin(supabase, requesterUserId);
  if (!isAdmin) {
    return c.json({ error: '僅管理員可刪除人員', code: 'FORBIDDEN' }, 403);
  }

  /**
   * **#833：人員不能刪除，只能封存。**
   *
   * 這支端點原本刪掉 `staff` 與 `user_roles` 而 **`ba_user` 留著** ——
   * 而 `ba_user.email` 有 UNIQUE 索引、`ba_*` 表可讀不可寫（憲法 c2），
   * 所以那個 email **從此不能再建任何帳號**，而 app 裡沒有任何東西清得掉它。
   * 補習班常見的「老師離職 → 半年後回來」因此用不回自己的公司信箱。
   *
   * **為什麼不是「刪掉 ba_user 就好」**：`auth.api.removeUser` 有
   * `use: [adminMiddleware]`（`createUser` 沒有），而它要
   * `hasPermission({ role: session.user.role, permissions: { user: ['delete'] } })` ——
   * 這個專案的 `ba_user.role` 全部是 `DEFAULT 'user'`（角色在 `user_roles`，
   * 見 `20260223000002_ba_user_role.sql` 的註解）、`auth.ts` 是零選項的
   * `adminPlugin()`，所以**沒有任何人過得了那道檢查**。
   * 上面 `rollbackCreatedUser()` 呼叫的是同一支，而它的 catch 訊息逐字寫著
   * 「rollback 失敗，孤兒 ba_user=」—— **它從來沒成功過。**
   *
   * 要讓它成功只有三條路，三條都不可接受：`adminUserIds` 白名單（Better Auth 層的
   * 超級權限）、自訂 AC 讓 `user` 角色有 `user:delete`（**等於每個登入者都能刪任何帳號**）、
   * 直寫 `ba_user`（c2）。
   *
   * **所以這裡止血**：不刪，回 409 並說出該走哪條路。UI 本來就沒有刪除入口
   * （封存才是正規路徑），`staff.service.ts` 的 `delete()` 也沒有任何畫面在呼叫。
   * **不回 404**：404 會被讀成「這個人不存在」，而那是另一件事。
   * 既有的孤兒由 `POST /api/staff` 的接管路徑救回來（同一支 PR）。
   */
  return c.json(
    {
      error: '人員不能刪除，只能封存。刪除會讓這個 email 永久無法再建立帳號。',
      code: 'STAFF_DELETE_NOT_ALLOWED',
    },
    409,
  );
});

export default app;
