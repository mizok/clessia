import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import * as staffRoute from './staff';

/**
 * #1100 #38：人員列表的「還沒登入過」—— 同家長列表（`parents.ts` ParentListItemSchema），
 * 來源 `ba_user."emailVerified"`（這個系統裡＝成功登入過）。查不到 ba_user 回 true（寧可漏報不誤報）。
 */
const ORG = '00000000-0000-0000-0000-0000000000aa';
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const users = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const ORPHAN = '55555555-5555-4555-8555-555555555555';

function fakeSupabase() {
  const selects: Array<{ table: string; columns: string }> = [];
  const rows = (table: string): unknown[] => {
    if (table === 'staff')
      return [...ids, ORPHAN].map((id, i) => ({
        id,
        user_id: i < 2 ? users[i] : ORPHAN,
        org_id: ORG,
        display_name: `人員 ${i}`,
        status: 'active',
        created_at: '2026-10-22T00:00:00Z',
        updated_at: '2026-10-22T00:00:00Z',
      }));
    // 第一位登入過、第二位沒有；ORPHAN 沒有 ba_user
    if (table === 'ba_user')
      return [
        { id: users[0], email: 'a@example.com', phone: null, emailVerified: true },
        { id: users[1], email: 'b@example.com', phone: null, emailVerified: false },
      ];
    return [];
  };
  const make = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder as never;
    Object.assign(builder, {
      select: (columns?: string) => (selects.push({ table, columns: columns ?? '' }), chain()),
      eq: () => chain(),
      neq: () => chain(),
      or: () => chain(),
      ilike: () => chain(),
      order: () => chain(),
      range: () => chain(),
      limit: () => chain(),
      in: () => chain(),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: { data: unknown[]; count: number; error: null }) => unknown) => {
        const data = rows(table);
        return resolve({ data, count: data.length, error: null });
      },
    });
    return builder;
  };
  return { selects, from: (table: string) => make(table) };
}

describe('GET /api/staff —— hasLoggedIn（#1100 #38）', () => {
  it('取自 ba_user.emailVerified；查不到 ba_user 的回 true', async () => {
    const supabase = fakeSupabase();
    const app = new Hono();
    app.use('*', async (c, next) => {
      const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
      set('supabase', supabase);
      set('orgId', ORG);
      set('userId', 'user-1');
      set('roles', ['admin']);
      set('permissions', ['*']);
      set('campusScope', null);
      await next();
    });
    app.route('/', staffRoute.default as unknown as Hono);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ id: string; hasLoggedIn: boolean }> };
    expect(Object.fromEntries(data.map((s) => [s.id, s.hasLoggedIn]))).toEqual({
      [ids[0]!]: true,
      [ids[1]!]: false,
      [ORPHAN]: true,
    });
    expect(supabase.selects).toContainEqual({
      table: 'ba_user',
      columns: 'id, email, phone, emailVerified',
    });
  });
});
