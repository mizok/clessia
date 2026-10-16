import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { adminsForCampuses, notify, teachersForSessions } from './notify';

/**
 * #1693 收件人推導與寫入。替身是**真的會套用過濾條件**的記憶體表 —— 拿掉 org／狀態／範圍任何一個條件，
 * 「別的 org／別的分校／停用的／沒任這個班的收不到」那幾條就會紅。
 * SQL 語意（PostgREST 的 `!inner`、jsonb 權限）由 `contract/notify.contract.ts` 對真 DB 驗。
 */

type Row = Record<string, unknown>;

function memoryDb(tables: Record<string, Row[]>) {
  const get = (r: Row, k: string): unknown =>
    k.split('.').reduce<unknown>((v, part) => (v as Row | undefined)?.[part], r);
  const upserts: Row[][] = [];
  let failUpsert = false;
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let upserted: Row[] | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push((r) => get(r, k) === v), b),
      in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(get(r, k))), b),
      upsert: (rows: Row[]) => ((upserted = rows), upserts.push(rows), b),
      then: (ok: (v: unknown) => unknown, ng: (e: unknown) => unknown) =>
        Promise.resolve(
          upserted
            ? failUpsert
              ? { data: null, error: { message: 'boom' } }
              : { data: upserted, error: null }
            : {
                data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))),
                error: null,
              },
        ).then(ok, ng),
    };
    return b;
  };
  return {
    client: { from } as unknown as SupabaseClient,
    upserts,
    fail: () => (failUpsert = true),
  };
}

const A = 'org-a';
const B = 'org-b';

describe('adminsForCampuses（#1693：resolveCampusScope 反過來用）', () => {
  const db = () =>
    memoryDb({
      staff: [
        { id: 's-all', user_id: 'u-all', org_id: A, status: 'active' },
        { id: 's-c1', user_id: 'u-c1', org_id: A, status: 'active' },
        { id: 's-c2', user_id: 'u-c2', org_id: A, status: 'active' },
        { id: 's-off', user_id: 'u-off', org_id: A, status: 'inactive' },
        { id: 's-other', user_id: 'u-other', org_id: B, status: 'active' },
        { id: 's-t', user_id: 'u-t', org_id: A, status: 'active' },
      ],
      user_roles: [
        { user_id: 'u-all', role: 'admin', permissions: ['all_campuses'] },
        { user_id: 'u-c1', role: 'admin', permissions: ['manage_finance'] },
        { user_id: 'u-c2', role: 'admin', permissions: [] },
        { user_id: 'u-off', role: 'admin', permissions: ['*'] },
        { user_id: 'u-other', role: 'admin', permissions: ['*'] },
        { user_id: 'u-t', role: 'teacher', permissions: [] },
      ],
      staff_campuses: [
        { staff_id: 's-c1', campus_id: 'c1' },
        { staff_id: 's-c2', campus_id: 'c2' },
        { staff_id: 's-off', campus_id: 'c1' },
        { staff_id: 's-other', campus_id: 'c1' },
        { staff_id: 's-t', campus_id: 'c1' },
      ],
    });

  it('分校 c1：全分校的＋被指派 c1 的；別的分校、停用的、別的 org、老師都收不到', async () => {
    expect((await adminsForCampuses(db().client, A, ['c1'])).sort()).toEqual(['u-all', 'u-c1']);
  });

  it('跨分校的申請：聯集', async () => {
    expect((await adminsForCampuses(db().client, A, ['c1', 'c2'])).sort()).toEqual([
      'u-all',
      'u-c1',
      'u-c2',
    ]);
  });

  it('財務類：再要求 manage_finance（沒有權限的全分校管理員也不收）', async () => {
    expect(
      await adminsForCampuses(db().client, A, ['c1', 'c2'], { permission: 'manage_finance' }),
    ).toEqual(['u-c1']);
  });

  it('做這件事的人自己不收', async () => {
    expect(await adminsForCampuses(db().client, A, ['c1'], { excludeUserId: 'u-c1' })).toEqual([
      'u-all',
    ]);
  });
});

describe('teachersForSessions（#1693：任課班的老師 ∪ 該堂上課的人）', () => {
  const db = () =>
    memoryDb({
      sessions: [
        { id: 'ses-1', org_id: A, class_id: 'k1', teacher_id: 'st-sub' }, // 這堂代課
        { id: 'ses-x', org_id: B, class_id: 'k9', teacher_id: 'st-other' },
      ],
      schedules: [
        { class_id: 'k1', teacher_id: 'st-main', classes: { org_id: A } },
        { class_id: 'k2', teacher_id: 'st-k2', classes: { org_id: A } }, // 別的班
        { class_id: 'k9', teacher_id: 'st-other', classes: { org_id: B } },
      ],
      staff: [
        { id: 'st-main', user_id: 'u-main', org_id: A, status: 'active' },
        { id: 'st-sub', user_id: 'u-sub', org_id: A, status: 'active' },
        { id: 'st-k2', user_id: 'u-k2', org_id: A, status: 'active' },
        { id: 'st-old', user_id: 'u-old', org_id: A, status: 'active' },
        { id: 'st-off', user_id: 'u-off', org_id: A, status: 'archived' },
        { id: 'st-admin', user_id: 'u-admin', org_id: A, status: 'active' },
        { id: 'st-other', user_id: 'u-other', org_id: B, status: 'active' },
      ],
      user_roles: [
        { user_id: 'u-main', role: 'teacher' },
        { user_id: 'u-sub', role: 'teacher' },
        { user_id: 'u-k2', role: 'teacher' },
        { user_id: 'u-old', role: 'teacher' },
        { user_id: 'u-off', role: 'teacher' },
        { user_id: 'u-admin', role: 'admin' },
        { user_id: 'u-other', role: 'teacher' },
      ],
    });

  it('任課老師＋代課的人；別的班的老師、別的 org 的課堂都收不到', async () => {
    expect((await teachersForSessions(db().client, A, ['ses-1', 'ses-x'])).sort()).toEqual([
      'u-main',
      'u-sub',
    ]);
  });

  it('額外指名（換任課老師的舊老師）也收；停用的、沒有 teacher 角色的不收', async () => {
    expect(
      (
        await teachersForSessions(db().client, A, ['ses-1'], {
          extraStaffIds: ['st-old', 'st-off', 'st-admin'],
        })
      ).sort(),
    ).toEqual(['u-main', 'u-old', 'u-sub']);
  });

  it('別的 org 的 staff 就算被指名也不收', async () => {
    expect(await teachersForSessions(db().client, A, [], { extraStaffIds: ['st-other'] })).toEqual(
      [],
    );
  });

  it('做這個異動的人自己不收', async () => {
    expect(
      await teachersForSessions(db().client, A, ['ses-1'], { excludeUserId: 'u-main' }),
    ).toEqual(['u-sub']);
  });
});

describe('notify', () => {
  const row = {
    orgId: A,
    userId: 'u1',
    role: 'admin' as const,
    kind: 'application_received' as const,
    dedupeKey: 'application:x',
    title: '新的報名申請',
    body: '王小明 申請 數學 A 班',
    url: '/admin/applications',
  };

  it('寫入時就是 skipped／ROLE_PUSH_DISABLED（老師、管理員不推播）', async () => {
    const db = memoryDb({});
    expect(await notify(db.client, [row])).toBe(1);
    expect(db.upserts[0]).toEqual([
      {
        org_id: A,
        user_id: 'u1',
        role: 'admin',
        kind: 'application_received',
        dedupe_key: 'application:x',
        payload: {
          title: '新的報名申請',
          body: '王小明 申請 數學 A 班',
          url: '/admin/applications',
        },
        push_status: 'skipped',
        push_error: 'ROLE_PUSH_DISABLED',
      },
    ]);
  });

  it('寫入失敗不丟例外（業務寫入已成功），回 0', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = memoryDb({});
    db.fail();
    await expect(notify(db.client, [row])).resolves.toBe(0);
  });

  it('沒有收件人就不打 DB', async () => {
    const db = memoryDb({});
    expect(await notify(db.client, [])).toBe(0);
    expect(db.upserts).toEqual([]);
  });
});
