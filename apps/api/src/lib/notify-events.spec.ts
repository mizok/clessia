import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import { notifyNewApplication } from './notify-events';

/**
 * #1693 各事件的排入點。替身真的套條件（`createMultiOrgDb`）：拿掉 org 或權限條件，
 * 「別的 org／沒有權限的收不到」那幾條就會紅。收件人推導本身由 `notify.spec.ts` 守。
 */

const A = 'org-a';
const B = 'org-b';

afterEach(() => vi.restoreAllMocks());

describe('notifyNewApplication（公開表單的申請 → 分校範圍＋manage_students 的管理員）', () => {
  const seed = () =>
    createMultiOrgDb({
      classes: [
        { id: 'k1', org_id: A, campus_id: 'c1' },
        { id: 'k2', org_id: A, campus_id: 'c2' },
        // 別的 org 的班，分校 id 剛好是 c2 —— 只有 classes 的 org 條件擋得住
        { id: 'kx', org_id: B, campus_id: 'c2' },
      ],
      courses: [
        { id: 'r1', org_id: A, campus_id: 'c1' },
        { id: 'rx', org_id: B, campus_id: 'c2' },
      ],
      staff: [
        { id: 's-c1', user_id: 'u-c1', org_id: A, status: 'active' },
        { id: 's-c2', user_id: 'u-c2', org_id: A, status: 'active' },
        { id: 's-noperm', user_id: 'u-noperm', org_id: A, status: 'active' },
      ],
      user_roles: [
        { user_id: 'u-c1', role: 'admin', permissions: ['manage_students'] },
        { user_id: 'u-c2', role: 'admin', permissions: ['manage_students'] },
        // 全分校但沒有 manage_students：點進申請頁是 403，不該收
        { user_id: 'u-noperm', role: 'admin', permissions: ['all_campuses'] },
      ],
      staff_campuses: [
        { staff_id: 's-c1', campus_id: 'c1' },
        { staff_id: 's-c2', campus_id: 'c2' },
      ],
      notifications: [],
    });

  const recipients = (db: ReturnType<typeof seed>) =>
    db
      .rows('notifications')
      .map((n) => n['user_id'])
      .sort();

  it('報名：班所在分校、有 manage_students 的管理員收到；內容、去重鍵、連結、不推播', async () => {
    const db = seed();
    await notifyNewApplication(db.client as SupabaseClient, {
      orgId: A,
      applicationId: 'app-1',
      kind: 'enrollment',
      studentName: '王小明',
      classIds: ['k1'],
    });
    expect(db.rows('notifications')).toEqual([
      expect.objectContaining({
        org_id: A,
        user_id: 'u-c1',
        role: 'admin',
        kind: 'application_received',
        dedupe_key: 'application:app-1',
        payload: { title: '新的報名申請', body: '王小明 送出報名申請', url: '/admin/applications' },
        push_status: 'skipped',
        push_error: 'ROLE_PUSH_DISABLED',
      }),
    ]);
  });

  it('跨分校的報名：取聯集', async () => {
    const db = seed();
    await notifyNewApplication(db.client as SupabaseClient, {
      orgId: A,
      applicationId: 'app-2',
      kind: 'enrollment',
      studentName: '王小明',
      classIds: ['k1', 'k2'],
    });
    expect(recipients(db)).toEqual(['u-c1', 'u-c2']);
  });

  it('別的 org 的班不算（就算分校 id 撞到）', async () => {
    const db = seed();
    await notifyNewApplication(db.client as SupabaseClient, {
      orgId: A,
      applicationId: 'app-3',
      kind: 'enrollment',
      studentName: '王小明',
      classIds: ['kx'],
    });
    expect(recipients(db)).toEqual([]);
  });

  it('試聽：看課程所在分校；別的 org 的課程不算', async () => {
    const db = seed();
    await notifyNewApplication(db.client as SupabaseClient, {
      orgId: A,
      applicationId: 'app-4',
      kind: 'trial',
      studentName: '李小華',
      courseIds: ['r1', 'rx'],
    });
    expect(db.rows('notifications')).toEqual([
      expect.objectContaining({
        user_id: 'u-c1',
        payload: { title: '新的試聽申請', body: '李小華 送出試聽申請', url: '/admin/applications' },
      }),
    ]);
  });

  it('查詢失敗不丟例外，只記 [notify] log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      from: () => {
        throw new Error('db down');
      },
    } as unknown as SupabaseClient;
    await expect(
      notifyNewApplication(broken, {
        orgId: A,
        applicationId: 'app-5',
        kind: 'enrollment',
        studentName: '王小明',
        classIds: ['k1'],
      }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[notify]'), 'db down');
  });
});
