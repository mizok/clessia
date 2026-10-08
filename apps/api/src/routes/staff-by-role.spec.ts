import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createMultiOrgDb, withMaxRows } from '../test-utils/multi-org-db';
import staffRoute from './staff';

/**
 * `GET /api/staff` 的 `summary.byRole`（#1314 ST1）：三章互斥 —— 在職且有 admin（兼老師的歸這章）／
 * 在職且只有 teacher／停用＋封存。跟列表同一組篩選（org、分校、科目、角色），不吃 status。
 */

const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const CA = '00000000-0000-0000-0000-0000000000ca';
const CB = '00000000-0000-0000-0000-0000000000cb';

let n = 0;
type Person = { status: string; roles: string[]; campus?: string; org?: string };
function seed(people: Person[], extraRoles: Array<{ user_id: string; role: string }> = []) {
  const staff: Array<Record<string, unknown>> = [];
  const user_roles: Array<Record<string, unknown>> = [...extraRoles];
  const staff_campuses: Array<Record<string, unknown>> = [];
  for (const p of people) {
    const i = ++n;
    const id = `staff-${i}`;
    const user = `user-${String(i).padStart(5, '0')}`;
    staff.push({
      id,
      user_id: user,
      org_id: p.org ?? ORG,
      status: p.status,
      created_at: '2026-10-01',
    });
    for (const role of p.roles) user_roles.push({ user_id: user, role, permissions: [] });
    staff_campuses.push({
      staff_id: id,
      campus_id: p.campus ?? CA,
      campuses: { id: p.campus ?? CA },
    });
  }
  return createMultiOrgDb({ staff, user_roles, staff_campuses });
}

async function list(
  db: ReturnType<typeof seed>,
  path = '/',
  scope: readonly string[] | null = null,
  maxRows?: number,
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', maxRows ? withMaxRows(db.client, maxRows) : db.client);
    set('orgId', ORG);
    set('userId', 'admin-a');
    set('roles', ['admin']);
    set('permissions', ['*']);
    set('campusScope', scope);
    await next();
  });
  app.route('/', staffRoute as unknown as Hono);
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as any };
}

const people: Person[] = [
  { status: 'active', roles: ['admin'] },
  { status: 'active', roles: ['admin', 'teacher'] }, // 兼任 → 管理員章
  { status: 'active', roles: ['teacher'] },
  { status: 'active', roles: ['teacher'], campus: CB },
  { status: 'inactive', roles: ['teacher'] },
  { status: 'archived', roles: ['admin'] },
  { status: 'active', roles: ['kiosk'] }, // 機台：三章都不算
  { status: 'active', roles: ['admin'], org: OTHER }, // 別 org
];

describe('GET /api/staff —— summary.byRole（#1314 ST1）', () => {
  it('三章互斥：兼任歸管理員章、停用與封存一章、機台與別 org 不算', async () => {
    const { status, body } = await list(seed(people));
    expect(status).toBe(200);
    expect(body.summary.byRole).toEqual({ admin: 2, teacher: 2, inactiveOrArchived: 2 });
    // 既有的重疊人次不動（開場副行要用）
    expect(body.summary.adminCount).toBe(3);
    expect(body.summary.teacherCount).toBe(4);
  });

  it('不吃 status 篩選', async () => {
    const { body } = await list(seed(people), '/?status=inactive');
    expect(body.summary.byRole).toEqual({ admin: 2, teacher: 2, inactiveOrArchived: 2 });
  });

  it('跟列表同一個分校範圍', async () => {
    const { body } = await list(seed(people), '/', [CB]);
    expect(body.summary.byRole).toEqual({ admin: 0, teacher: 1, inactiveOrArchived: 0 });
  });

  // 陷阱：角色名單破千時（user_roles 全表沒有 org 欄、含家長），撈一頁就停會漏人
  it('user_roles 破千：排在後面的管理員還在管理員章', async () => {
    const filler = Array.from({ length: 1000 }, (_, i) => ({
      user_id: `parent-${String(i).padStart(5, '0')}`,
      role: 'teacher',
    }));
    // user-xxxxx 照 user_id 排在 parent-xxxxx 之後
    const db = seed([{ status: 'active', roles: ['admin'] }], filler);
    const { body } = await list(db, '/', null, 1000);
    expect(body.summary.byRole.admin).toBe(1);
  });
});
