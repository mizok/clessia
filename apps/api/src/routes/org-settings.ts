import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../index';

const AttendanceModeSchema = z
  .enum(['per_session', 'daily_checkin'])
  .openapi('AttendanceMode');

const AttendanceResponsibleSchema = z
  .enum(['admin', 'teacher'])
  .openapi('AttendanceResponsible');

const OrgSettingsSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    attendanceMode: AttendanceModeSchema,
    attendanceResponsible: AttendanceResponsibleSchema,
    attendanceRetroactiveDays: z.number().int().min(0),
  })
  .openapi('OrgSettings');

const UpdateOrgSettingsSchema = z
  .object({
    attendanceMode: AttendanceModeSchema.optional(),
    attendanceResponsible: AttendanceResponsibleSchema.optional(),
    attendanceRetroactiveDays: z.coerce.number().int().min(0).optional(),
  })
  .openapi('UpdateOrgSettings');

export function toOrgSettingsResponse(row: Record<string, unknown>) {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    attendanceMode: row['attendance_mode'] as 'per_session' | 'daily_checkin',
    attendanceResponsible: (row['attendance_responsible'] as 'admin' | 'teacher') ?? 'admin',
    attendanceRetroactiveDays: (row['attendance_retroactive_days'] as number) ?? 0,
  };
}

const app = new OpenAPIHono<AppEnv>();

const SELECT_FIELDS = 'id, name, attendance_mode, attendance_responsible, attendance_retroactive_days';

// GET /api/org/settings
app.openapi(
  createRoute({
    method: 'get',
    path: '/settings',
    tags: ['Org'],
    summary: '取得組織設定',
    responses: {
      200: {
        description: '組織設定',
        content: { 'application/json': { schema: OrgSettingsSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');

    const { data, error } = await supabase
      .from('organizations')
      .select(SELECT_FIELDS)
      .eq('id', orgId)
      .single();

    if (error || !data) {
      return c.json({ error: '讀取組織設定失敗' }, 500);
    }

    return c.json(toOrgSettingsResponse(data), 200);
  },
);

// PATCH /api/org/settings
app.openapi(
  createRoute({
    method: 'patch',
    path: '/settings',
    tags: ['Org'],
    summary: '更新組織設定',
    request: {
      body: { content: { 'application/json': { schema: UpdateOrgSettingsSchema } } },
    },
    responses: {
      200: {
        description: '更新後的組織設定',
        content: { 'application/json': { schema: OrgSettingsSchema } },
      },
      500: { description: '伺服器錯誤' },
    },
  }),
  async (c) => {
    const supabase = c.get('supabase');
    const orgId = c.get('orgId');
    const body = c.req.valid('json');

    const updates: Record<string, unknown> = {};
    if (body.attendanceMode !== undefined) updates['attendance_mode'] = body.attendanceMode;
    if (body.attendanceResponsible !== undefined) updates['attendance_responsible'] = body.attendanceResponsible;
    if (body.attendanceRetroactiveDays !== undefined) updates['attendance_retroactive_days'] = body.attendanceRetroactiveDays;

    const { data, error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('id', orgId)
      .select(SELECT_FIELDS)
      .single();

    if (error || !data) {
      return c.json({ error: '更新組織設定失敗' }, 500);
    }

    return c.json(toOrgSettingsResponse(data), 200);
  },
);

export default app;
