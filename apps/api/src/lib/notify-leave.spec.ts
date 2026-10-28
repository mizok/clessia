import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import { notifyLeaveForAdmins, notifyLeaveForTeachers } from './notify-leave';

/**
 * #1693 有學生請了老師的課 → 那幾堂的老師。替身真的套條件：拿掉 org 條件或分組，
 * 「別的 org／別班的老師收不到」就會紅。蓋到哪幾堂由 `leaves-session-binding.spec` 守。
 */

const A = 'org-a';
const B = 'org-b';

afterEach(() => vi.restoreAllMocks());

const SESSIONS = [
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
  // 跟 ses-3 同一天、同一班：同日取 id 小的那個分支要靠它
  {
    id: 'ses-4',
    org_id: A,
    class_id: 'k2',
    session_date: '2026-10-21',
    teacher_id: 'st-k2',
    classes: { name: '英文 B 班' },
  },
];

/** `reversed`：DB 回列的順序沒有保證（查詢沒有 order），反過來種一次模擬另一種順序 */
const seed = (reversed = false) =>
  createMultiOrgDb({
    sessions: reversed ? [...SESSIONS].reverse() : SESSIONS,
    schedules: [
      {
        class_id: 'k1',
        teacher_id: 'st-main',
        effective_from: '2000-01-01',
        effective_to: null,
        classes: { org_id: A },
      },
      {
        class_id: 'k2',
        teacher_id: 'st-k2',
        effective_from: '2000-01-01',
        effective_to: null,
        classes: { org_id: A },
      },
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

  it('同一批、DB 回列的順序不同 → 同一個去重鍵（跨日取最早、同日取 id 小的）', async () => {
    const keys = async (reversed: boolean, sessionIds: string[]) => {
      const db = seed(reversed);
      await notifyLeaveForTeachers(db.client as SupabaseClient, input({ sessionIds }));
      return db
        .rows('notifications')
        .map((n) => n['dedupe_key'])
        .sort();
    };
    // 跨日：k1 的 ses-2（10/20）比 ses-1（10/27）早
    expect(await keys(false, ['ses-1', 'ses-2'])).toEqual(await keys(true, ['ses-2', 'ses-1']));
    expect(await keys(true, ['ses-1', 'ses-2'])).toEqual([
      'leave:leave-1:k1:ses-2',
      'leave:leave-1:k1:ses-2',
    ]);
    // 同日：k2 的 ses-3 與 ses-4 都是 10/21，取 id 小的 ses-3
    expect(await keys(false, ['ses-3', 'ses-4'])).toEqual(['leave:leave-1:k2:ses-3']);
    expect(await keys(true, ['ses-4', 'ses-3'])).toEqual(['leave:leave-1:k2:ses-3']);
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

/** #1695 家長請假 → 被請假的堂所屬分校、有 basic_operations 的管理員（`leave_received`） */
describe('notifyLeaveForAdmins（#1695：家長請假通知分校管理員）', () => {
  const adminDb = () =>
    createMultiOrgDb({
      sessions: [
        // 刻意晚的放前面：內文要取日期最早那堂
        {
          id: 'ses-late',
          org_id: A,
          session_date: '2026-10-27',
          classes: { name: '數學 A 班', campus_id: 'c1' },
        },
        {
          id: 'ses-c1',
          org_id: A,
          session_date: '2026-10-20',
          classes: { name: '數學 A 班', campus_id: 'c1' },
        },
        {
          id: 'ses-c2',
          org_id: A,
          session_date: '2026-10-21',
          classes: { name: '英文 B 班', campus_id: 'c2' },
        },
        {
          id: 'ses-x',
          org_id: B,
          session_date: '2026-10-22',
          classes: { name: '別人的班', campus_id: 'c2' },
        },
      ],
      staff: [
        { id: 's-c1', user_id: 'u-c1', org_id: A, status: 'active' },
        { id: 's-c2', user_id: 'u-c2', org_id: A, status: 'active' },
        { id: 's-star', user_id: 'u-star', org_id: A, status: 'active' },
        { id: 's-weak', user_id: 'u-weak', org_id: A, status: 'active' },
        { id: 's-other', user_id: 'u-other', org_id: B, status: 'active' },
      ],
      user_roles: [
        { user_id: 'u-c1', role: 'admin', permissions: ['basic_operations'] },
        { user_id: 'u-c2', role: 'admin', permissions: ['basic_operations'] },
        { user_id: 'u-star', role: 'admin', permissions: ['*'] },
        { user_id: 'u-weak', role: 'admin', permissions: ['manage_finance'] },
        { user_id: 'u-other', role: 'admin', permissions: ['*'] },
      ],
      staff_campuses: [
        { staff_id: 's-c1', campus_id: 'c1' },
        { staff_id: 's-c2', campus_id: 'c2' },
        { staff_id: 's-star', campus_id: 'c1' },
        { staff_id: 's-weak', campus_id: 'c1' },
        { staff_id: 's-other', campus_id: 'c2' },
      ],
      notifications: [],
    });

  const adminInput = (over: Partial<Parameters<typeof notifyLeaveForAdmins>[1]> = {}) => ({
    orgId: A,
    leaveId: 'leave-1',
    studentName: '王小明',
    reason: '發燒',
    sessionIds: ['ses-late', 'ses-c1'],
    retroactive: false,
    ...over,
  });

  const got = (db: ReturnType<typeof adminDb>) =>
    db
      .rows('notifications')
      .map((n) => {
        const p = n['payload'] as { title: string; body: string };
        return `${n['user_id']}|${p.title}|${p.body}`;
      })
      .sort();

  it('只發給這幾堂所屬分校、有 basic_operations（或 *）的管理員；內容取最早那堂、去重鍵、連結、不推播', async () => {
    const db = adminDb();
    await notifyLeaveForAdmins(db.client as SupabaseClient, adminInput());
    expect(got(db)).toEqual([
      'u-c1|家長請假|王小明的家長請假：10/20（二）數學 A 班 等 2 堂，原因：發燒',
      'u-star|家長請假|王小明的家長請假：10/20（二）數學 A 班 等 2 堂，原因：發燒',
    ]);
    expect(db.rows('notifications').find((n) => n['user_id'] === 'u-c1')).toMatchObject({
      org_id: A,
      role: 'admin',
      kind: 'leave_received',
      dedupe_key: 'leave:leave-1:u-c1',
      payload: { url: '/admin/leave' },
      push_status: 'skipped',
      push_error: 'ROLE_PUSH_DISABLED',
    });
  });

  it('跨分校的假：兩邊分校的管理員都收，一人一則', async () => {
    const db = adminDb();
    await notifyLeaveForAdmins(
      db.client as SupabaseClient,
      adminInput({ sessionIds: ['ses-c1', 'ses-c2'], reason: null }),
    );
    expect(got(db)).toEqual([
      'u-c1|家長請假|王小明的家長請假：10/20（二）數學 A 班 等 2 堂',
      'u-c2|家長請假|王小明的家長請假：10/20（二）數學 A 班 等 2 堂',
      'u-star|家長請假|王小明的家長請假：10/20（二）數學 A 班 等 2 堂',
    ]);
  });

  it('蓋到已開始的課：標題標「補請」；重送同一張不重複', async () => {
    const db = adminDb();
    await notifyLeaveForAdmins(
      db.client as SupabaseClient,
      adminInput({ sessionIds: ['ses-c2'], retroactive: true, reason: '  ' }),
    );
    await notifyLeaveForAdmins(
      db.client as SupabaseClient,
      adminInput({ sessionIds: ['ses-c2'], retroactive: true, reason: '  ' }),
    );
    expect(got(db)).toEqual([
      'u-c2|家長請假（補請）|王小明的家長請假：10/21（三）英文 B 班',
      // `*` 是全分校
      'u-star|家長請假（補請）|王小明的家長請假：10/21（三）英文 B 班',
    ]);
  });

  it('別的 org 的課堂不算；沒蓋到任何堂就不發', async () => {
    const db = adminDb();
    await notifyLeaveForAdmins(db.client as SupabaseClient, adminInput({ sessionIds: ['ses-x'] }));
    await notifyLeaveForAdmins(db.client as SupabaseClient, adminInput({ sessionIds: [] }));
    expect(got(db)).toEqual([]);
  });

  it('查詢失敗不丟例外，只記 [notify] log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      from: () => {
        throw new Error('db down');
      },
    } as unknown as SupabaseClient;
    await expect(notifyLeaveForAdmins(broken, adminInput())).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[notify]'), 'db down');
  });
});
