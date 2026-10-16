import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import { notifyLeaveForTeachers } from './notify-leave';

/**
 * #1693 有學生請了老師的課 → 那幾堂的老師。替身真的套條件：拿掉 org 條件或分組，
 * 「別的 org／別班的老師收不到」就會紅。蓋到哪幾堂由 `leaves-session-binding.spec` 守。
 */

const A = 'org-a';
const B = 'org-b';

afterEach(() => vi.restoreAllMocks());

const seed = () =>
  createMultiOrgDb({
    sessions: [
      {
        id: 'ses-1',
        org_id: A,
        class_id: 'k1',
        session_date: '2026-10-27',
        teacher_id: 'st-sub', // 這堂代課：任課老師和代課老師都收
        classes: { name: '數學 A 班' },
      },
      {
        id: 'ses-2',
        org_id: A,
        class_id: 'k1',
        session_date: '2026-10-20',
        teacher_id: 'st-main',
        classes: { name: '數學 A 班' },
      },
      {
        id: 'ses-3',
        org_id: A,
        class_id: 'k2',
        session_date: '2026-10-21',
        teacher_id: 'st-k2',
        classes: { name: '英文 B 班' },
      },
      {
        id: 'ses-x',
        org_id: B,
        class_id: 'k9',
        session_date: '2026-10-22',
        teacher_id: 'st-k2',
        classes: { name: '別人的班' },
      },
    ],
    schedules: [
      { class_id: 'k1', teacher_id: 'st-main', classes: { org_id: A } },
      { class_id: 'k2', teacher_id: 'st-k2', classes: { org_id: A } },
    ],
    staff: [
      { id: 'st-main', user_id: 'u-main', org_id: A, status: 'active' },
      { id: 'st-sub', user_id: 'u-sub', org_id: A, status: 'active' },
      { id: 'st-k2', user_id: 'u-k2', org_id: A, status: 'active' },
    ],
    user_roles: [
      { user_id: 'u-main', role: 'teacher' },
      { user_id: 'u-sub', role: 'teacher' },
      { user_id: 'u-k2', role: 'teacher' },
    ],
    notifications: [],
  });

const sent = (db: ReturnType<typeof seed>) =>
  db
    .rows('notifications')
    .map((n) => `${n['user_id']}|${(n['payload'] as { body: string }).body}`)
    .sort();

const input = (over: Partial<Parameters<typeof notifyLeaveForTeachers>[1]> = {}) => ({
  orgId: A,
  actorUserId: 'u-admin',
  leaveId: 'leave-1',
  studentName: '王小明',
  sessionIds: ['ses-1', 'ses-2', 'ses-3'],
  ...over,
});

describe('notifyLeaveForTeachers（#1693：學生請了老師的課）', () => {
  it('依班分組：每班的老師只收自己班那則；內容、去重鍵、連結、不推播', async () => {
    const db = seed();
    await notifyLeaveForTeachers(db.client as SupabaseClient, input());
    expect(sent(db)).toEqual([
      'u-k2|王小明 請假：英文 B 班 10/21',
      'u-main|王小明 請假：數學 A 班 10/20 等 2 堂',
      'u-sub|王小明 請假：數學 A 班 10/20 等 2 堂',
    ]);
    expect(db.rows('notifications').find((n) => n['user_id'] === 'u-k2')).toMatchObject({
      org_id: A,
      role: 'teacher',
      kind: 'leave_for_my_class',
      dedupe_key: 'leave:leave-1:k2:ses-3',
      payload: { title: '學生請假', url: '/teacher/schedule' },
      push_status: 'skipped',
      push_error: 'ROLE_PUSH_DISABLED',
    });
  });

  it('只請了一班的課：別班的老師收不到', async () => {
    const db = seed();
    await notifyLeaveForTeachers(db.client as SupabaseClient, input({ sessionIds: ['ses-3'] }));
    expect(sent(db)).toEqual(['u-k2|王小明 請假：英文 B 班 10/21']);
  });

  it('同一張假延長（同班新的堂）收第二則；同一批重送不重複', async () => {
    const db = seed();
    await notifyLeaveForTeachers(db.client as SupabaseClient, input({ sessionIds: ['ses-2'] }));
    await notifyLeaveForTeachers(db.client as SupabaseClient, input({ sessionIds: ['ses-2'] }));
    await notifyLeaveForTeachers(db.client as SupabaseClient, input({ sessionIds: ['ses-1'] }));
    expect(sent(db)).toEqual([
      'u-main|王小明 請假：數學 A 班 10/20',
      'u-main|王小明 請假：數學 A 班 10/27',
      'u-sub|王小明 請假：數學 A 班 10/27',
    ]);
  });

  it('替學生請假的人自己不收（管理員同時是任課老師）', async () => {
    const db = seed();
    await notifyLeaveForTeachers(
      db.client as SupabaseClient,
      input({ actorUserId: 'u-k2', sessionIds: ['ses-3'] }),
    );
    expect(sent(db)).toEqual([]);
  });

  it('別的 org 的課堂不算；沒蓋到任何堂就不發', async () => {
    const db = seed();
    await notifyLeaveForTeachers(db.client as SupabaseClient, input({ sessionIds: ['ses-x'] }));
    await notifyLeaveForTeachers(db.client as SupabaseClient, input({ sessionIds: [] }));
    expect(sent(db)).toEqual([]);
  });

  it('查詢失敗不丟例外，只記 [notify] log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      from: () => {
        throw new Error('db down');
      },
    } as unknown as SupabaseClient;
    await expect(notifyLeaveForTeachers(broken, input())).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[notify]'), 'db down');
  });
});
