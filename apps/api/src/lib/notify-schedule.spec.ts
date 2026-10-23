import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import { notifyScheduleChange } from './notify-schedule';

/**
 * #1693 課務異動 → 任課老師。替身真的套條件（`createMultiOrgDb`）：拿掉 org 條件或分組，
 * 「別的 org／別班的老師收不到」就會紅。收件人的 SQL 語意由 `contract/notify.contract.ts` 對真 DB 驗。
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
        teacher_id: 'st-main',
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
      // 別的 org 的課堂，老師卻是本 org 的人 —— 只有 sessions 的 org 條件擋得住
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
      { id: 'st-k2', user_id: 'u-k2', org_id: A, status: 'active' },
      { id: 'st-sub', user_id: 'u-sub', org_id: A, status: 'active' },
    ],
    user_roles: [
      { user_id: 'u-main', role: 'teacher' },
      { user_id: 'u-k2', role: 'teacher' },
      { user_id: 'u-sub', role: 'teacher' },
    ],
    notifications: [],
  });

const sent = (db: ReturnType<typeof seed>) =>
  db
    .rows('notifications')
    .map((n) => `${n['user_id']}|${(n['payload'] as { body: string }).body}`)
    .sort();

describe('notifyScheduleChange（#1693：課務異動 → 任課老師，一批一班一則）', () => {
  it('同一批跨兩班：每班的老師只收自己班那則；內容、去重鍵、連結、不推播', async () => {
    const db = seed();
    await notifyScheduleChange(db.client as SupabaseClient, {
      orgId: A,
      actorUserId: 'u-admin',
      rows: [
        { session_id: 'ses-1', change_type: 'cancellation', batch_id: 'b1' },
        { session_id: 'ses-2', change_type: 'cancellation', batch_id: 'b1' },
        { session_id: 'ses-3', change_type: 'cancellation', batch_id: 'b1' },
      ],
    });
    expect(sent(db)).toEqual(['u-k2|英文 B 班 10/21 停課', 'u-main|數學 A 班 10/20 等 2 堂停課']);
    expect(db.rows('notifications').find((n) => n['user_id'] === 'u-main')).toMatchObject({
      org_id: A,
      role: 'teacher',
      kind: 'schedule_change',
      dedupe_key: 'schedule_change:b1:k1',
      payload: { title: '課務異動：停課', url: '/teacher/schedule' },
      push_status: 'skipped',
      push_error: 'ROLE_PUSH_DISABLED',
    });
  });

  // 每一種的標題與內文都要斷言：換老師（assign_teacher）不是 DB 的 enum，是路由自己湊的列，
  // 只有這裡守得住它的文字（二讀 @aa973ca3 抓到）
  it.each([
    ['reschedule', '調課'],
    ['substitute', '代課'],
    ['cancellation', '停課'],
    ['uncancel', '復課'],
    ['time_change', '改時間'],
    ['makeup', '補課'],
    ['creation', '加開課堂'],
    ['assign_teacher', '換老師'],
  ] as const)('%s → 標題「課務異動：%s」，內文帶班名、日期與種類', async (kind, label) => {
    const db = seed();
    await notifyScheduleChange(db.client as SupabaseClient, {
      orgId: A,
      actorUserId: 'u-admin',
      rows: [{ session_id: 'ses-3', change_type: kind }],
    });
    expect(db.rows('notifications').map((n) => n['payload'])).toEqual([
      { title: `課務異動：${label}`, body: `英文 B 班 10/21 ${label}`, url: '/teacher/schedule' },
    ]);
  });

  it('代課：原老師與代課老師都收（代課老師不是任課老師也收）', async () => {
    const db = seed();
    await notifyScheduleChange(db.client as SupabaseClient, {
      orgId: A,
      actorUserId: 'u-admin',
      rows: [
        {
          session_id: 'ses-3',
          change_type: 'substitute',
          original_teacher_id: 'st-k2',
          substitute_teacher_id: 'st-sub',
        },
      ],
    });
    expect(sent(db)).toEqual(['u-k2|英文 B 班 10/21 代課', 'u-sub|英文 B 班 10/21 代課']);
  });

  it('做異動的人自己不收', async () => {
    const db = seed();
    await notifyScheduleChange(db.client as SupabaseClient, {
      orgId: A,
      actorUserId: 'u-main',
      rows: [{ session_id: 'ses-1', change_type: 'reschedule' }],
    });
    expect(sent(db)).toEqual([]);
  });

  it('別的 org 的課堂不算（就算老師是本 org 的人）', async () => {
    const db = seed();
    await notifyScheduleChange(db.client as SupabaseClient, {
      orgId: A,
      actorUserId: 'u-admin',
      rows: [{ session_id: 'ses-x', change_type: 'cancellation' }],
    });
    expect(sent(db)).toEqual([]);
  });

  it('單堂沒有 batch_id：每次一顆新的鍵（同一堂改兩次收兩則）', async () => {
    const db = seed();
    const once = () =>
      notifyScheduleChange(db.client as SupabaseClient, {
        orgId: A,
        actorUserId: 'u-admin',
        rows: [{ session_id: 'ses-3', change_type: 'time_change' }],
      });
    await once();
    await once();
    expect(sent(db)).toEqual(['u-k2|英文 B 班 10/21 改時間', 'u-k2|英文 B 班 10/21 改時間']);
  });

  it('查詢失敗不丟例外，只記 [notify] log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      from: () => {
        throw new Error('db down');
      },
    } as unknown as SupabaseClient;
    await expect(
      notifyScheduleChange(broken, {
        orgId: A,
        actorUserId: 'u-admin',
        rows: [{ session_id: 'ses-1', change_type: 'cancellation' }],
      }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[notify]'), 'db down');
  });
});

/**
 * #1023（使用者 10-23 裁定）：課務異動也發給管理員，依分校範圍。計畫席裁：要 `basic_operations`
 * （同請假通知 leave_received）、種類跟老師同一組全部發。判準就是 `adminsForCampuses`。
 */
describe('notifyScheduleChange → 管理員（#1023：依班的分校範圍）', () => {
  const seedAdmins = () =>
    createMultiOrgDb({
      sessions: [
        {
          id: 'ses-c1',
          org_id: A,
          class_id: 'k1',
          session_date: '2026-10-27',
          teacher_id: 'st-dual',
          classes: { name: '數學 A 班', campus_id: 'c1' },
        },
        {
          id: 'ses-c2',
          org_id: A,
          class_id: 'k2',
          session_date: '2026-10-21',
          teacher_id: 'st-k2',
          classes: { name: '英文 B 班', campus_id: 'c2' },
        },
      ],
      schedules: [
        { class_id: 'k1', teacher_id: 'st-dual', classes: { org_id: A } },
        { class_id: 'k2', teacher_id: 'st-k2', classes: { org_id: A } },
      ],
      staff: [
        { id: 'st-k2', user_id: 'u-k2', org_id: A, status: 'active' },
        { id: 'st-dual', user_id: 'u-dual', org_id: A, status: 'active' },
        { id: 'st-c1', user_id: 'u-c1', org_id: A, status: 'active' },
        { id: 'st-c2', user_id: 'u-c2', org_id: A, status: 'active' },
        { id: 'st-all', user_id: 'u-all', org_id: A, status: 'active' },
        { id: 'st-fin', user_id: 'u-fin', org_id: A, status: 'active' },
        { id: 'st-act', user_id: 'u-act', org_id: A, status: 'active' },
      ],
      user_roles: [
        { user_id: 'u-k2', role: 'teacher' },
        // 同時是 k1 的任課老師與 c1 的管理員
        { user_id: 'u-dual', role: 'teacher' },
        { user_id: 'u-dual', role: 'admin', permissions: ['basic_operations'] },
        { user_id: 'u-c1', role: 'admin', permissions: ['basic_operations'] },
        { user_id: 'u-c2', role: 'admin', permissions: ['basic_operations'] },
        // 全部分校：不需要 staff_campuses
        { user_id: 'u-all', role: 'admin', permissions: ['basic_operations', 'all_campuses'] },
        // 只管財務：範圍內但沒有 basic_operations
        { user_id: 'u-fin', role: 'admin', permissions: ['manage_finance'] },
        { user_id: 'u-act', role: 'admin', permissions: ['basic_operations'] },
      ],
      staff_campuses: [
        { staff_id: 'st-dual', campus_id: 'c1' },
        { staff_id: 'st-c1', campus_id: 'c1' },
        { staff_id: 'st-c2', campus_id: 'c2' },
        { staff_id: 'st-fin', campus_id: 'c1' },
        { staff_id: 'st-act', campus_id: 'c1' },
      ],
      notifications: [],
    });

  const adminRows = (db: ReturnType<typeof seedAdmins>) =>
    db.rows('notifications').filter((n) => n['role'] === 'admin');
  const adminSent = (db: ReturnType<typeof seedAdmins>) =>
    adminRows(db)
      .map((n) => `${n['user_id']}|${(n['payload'] as { body: string }).body}`)
      .sort();

  const run = (db: ReturnType<typeof seedAdmins>, sessionId: string, actor = 'u-act') =>
    notifyScheduleChange(db.client as SupabaseClient, {
      orgId: A,
      actorUserId: actor,
      rows: [{ session_id: sessionId, change_type: 'cancellation', batch_id: 'b1' }],
    });

  it('c1 的班：c1 的管理員與全部分校的管理員收到；別分校、沒有 basic_operations、做異動的人都收不到', async () => {
    const db = seedAdmins();
    await run(db, 'ses-c1');
    expect(adminSent(db)).toEqual([
      'u-all|數學 A 班 10/27 停課',
      'u-c1|數學 A 班 10/27 停課',
      'u-dual|數學 A 班 10/27 停課',
    ]);
  });

  it('c2 的班：只有 c2 的管理員與全部分校的管理員', async () => {
    const db = seedAdmins();
    await run(db, 'ses-c2');
    expect(adminSent(db)).toEqual(['u-all|英文 B 班 10/21 停課', 'u-c2|英文 B 班 10/21 停課']);
  });

  it('同一批跨兩間分校：每間的管理員只收自己分校那個班；全部分校的兩則都收', async () => {
    const db = seedAdmins();
    await notifyScheduleChange(db.client as SupabaseClient, {
      orgId: A,
      actorUserId: 'u-act',
      rows: [
        { session_id: 'ses-c1', change_type: 'cancellation', batch_id: 'b1' },
        { session_id: 'ses-c2', change_type: 'cancellation', batch_id: 'b1' },
      ],
    });
    expect(adminSent(db)).toEqual([
      'u-all|數學 A 班 10/27 停課',
      'u-all|英文 B 班 10/21 停課',
      'u-c1|數學 A 班 10/27 停課',
      'u-c2|英文 B 班 10/21 停課',
      'u-dual|數學 A 班 10/27 停課',
    ]);
  });

  it('管理員那則：role admin、去重鍵加 admin: 前綴、連到課務異動頁、不推播', async () => {
    const db = seedAdmins();
    await run(db, 'ses-c1');
    expect(adminRows(db).find((n) => n['user_id'] === 'u-c1')).toMatchObject({
      org_id: A,
      role: 'admin',
      kind: 'schedule_change',
      dedupe_key: 'schedule_change:admin:b1:k1',
      payload: { title: '課務異動：停課', url: '/admin/changes' },
      push_status: 'skipped',
      push_error: 'ROLE_PUSH_DISABLED',
    });
  });

  it('同時是老師和管理員：兩個收件匣各一則（去重鍵不同，UNIQUE(user_id, dedupe_key) 不會吃掉一則）', async () => {
    const db = seedAdmins();
    await run(db, 'ses-c1');
    const mine = db
      .rows('notifications')
      .filter((n) => n['user_id'] === 'u-dual')
      .map((n) => `${n['role']}|${n['dedupe_key']}`)
      .sort();
    expect(mine).toEqual(['admin|schedule_change:admin:b1:k1', 'teacher|schedule_change:b1:k1']);
  });

  it('做異動的人就算在範圍內也不收（換一個人做，他就收得到）', async () => {
    const db = seedAdmins();
    await run(db, 'ses-c1', 'u-c1');
    expect(adminSent(db).map((s) => s.split('|')[0])).not.toContain('u-c1');
    expect(adminSent(db).map((s) => s.split('|')[0])).toContain('u-act');
  });

  it('管理員那批查詢失敗：老師那批照寫，不丟例外', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = seedAdmins();
    const client = db.client as SupabaseClient;
    const flaky = {
      from: (t: string) => {
        if (t === 'staff_campuses') throw new Error('campuses down');
        return client.from(t);
      },
    } as unknown as SupabaseClient;
    await notifyScheduleChange(flaky, {
      orgId: A,
      actorUserId: 'u-act',
      rows: [{ session_id: 'ses-c2', change_type: 'cancellation', batch_id: 'b1' }],
    });
    expect(db.rows('notifications').map((n) => `${n['role']}|${n['user_id']}`)).toEqual([
      'teacher|u-k2',
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[notify]'), 'campuses down');
  });
});

/**
 * #1100 #49：課務異動 → 該班家長（v1 不推播；同一位家長兩個孩子同班只收一則、兩個名字都列）。
 * 髒資料每一筆只讓一個條件擋住：拿掉哪個條件就會多一位家長收到。
 */
describe('notifyScheduleChange → 家長（#1100 #49）', () => {
  const par = (user_id: string | null, over: Record<string, unknown> = {}) => ({
    parents: { user_id, org_id: A, status: 'active', ...over },
  });
  const enr = (
    class_id: string,
    name: string,
    parents: ReturnType<typeof par>[],
    over: Record<string, unknown> = {},
  ) => ({
    org_id: A,
    class_id,
    status: 'active',
    effective_from: '2026-09-01',
    effective_to: null,
    students: { name, parent_student_relations: parents },
    ...over,
  });

  const seedWithParents = () => {
    const db = seed();
    return createMultiOrgDb({
      ...Object.fromEntries(
        ['sessions', 'schedules', 'staff', 'user_roles', 'notifications'].map((t) => [
          t,
          [...db.rows(t)],
        ]),
      ),
      enrollments: [
        // 王家兩個孩子都在 k1 → 一則、兩個名字
        enr('k1', '王小明', [par('u-wang')]),
        enr('k1', '王小美', [par('u-wang')]),
        // 林家：k1 一位、k2 一位 → 兩則（各班各一）
        enr('k1', '林大同', [par('u-lin')]),
        enr('k2', '林小同', [par('u-lin')]),
        // 只讓一個條件擋住的髒資料
        enr('k1', '已退班', [par('u-left')], { effective_to: '2026-10-01' }), // 異動日前就離開
        enr('k1', '還沒來', [par('u-later')], { effective_from: '2026-11-01' }), // 異動日後才加入
        enr('k1', '作廢的', [par('u-void')], { status: 'void' }),
        enr('k1', '別 org 家長', [par('u-other-org', { org_id: B })]),
        enr('k1', '停用家長', [par('u-inactive', { status: 'inactive' })]),
        enr('k1', '沒帳號', [par(null)]),
        enr('k1', '做異動的人', [par('u-admin')]),
        enr('k9', '別 org 的班', [par('u-b')], { org_id: B }),
        // 在整批的日期窗（10/20–10/27）裡，但 k1 那兩堂（10/20、10/27）都不在籍 —— 只有逐堂判在籍擋得住
        enr('k1', '中間短暫', [par('u-between')], {
          effective_from: '2026-10-22',
          effective_to: '2026-10-25',
        }),
        // 報名列的 org 是別人的（髒資料），家長是本 org 的 —— 只有 enrollments 的 org 條件擋得住
        enr('k1', '別 org 的報名', [par('u-wrong-org-enr')], { org_id: B }),
      ],
    });
  };

  const parentSent = (db: ReturnType<typeof createMultiOrgDb>) =>
    db
      .rows('notifications')
      .filter((n) => n['role'] === 'parent')
      .map((n) => `${n['user_id']}|${(n['payload'] as { body: string }).body}`)
      .sort();

  const run = (db: ReturnType<typeof createMultiOrgDb>) =>
    notifyScheduleChange(db.client as SupabaseClient, {
      orgId: A,
      actorUserId: 'u-admin',
      rows: [
        { session_id: 'ses-1', change_type: 'reschedule', batch_id: 'b1' },
        { session_id: 'ses-2', change_type: 'reschedule', batch_id: 'b1' },
        { session_id: 'ses-3', change_type: 'reschedule', batch_id: 'b1' },
      ],
    });

  it('那幾堂當天在籍的學生的家長：一班一則，同一位家長兩個孩子同班只一則、兩個名字都列', async () => {
    const db = seedWithParents();
    await run(db);
    expect(parentSent(db)).toEqual([
      'u-lin|林大同 數學 A 班 10/20 等 2 堂 調課',
      'u-lin|林小同 英文 B 班 10/21 調課',
      'u-wang|王小明、王小美 數學 A 班 10/20 等 2 堂 調課',
    ]);
  });

  it('role parent、kind schedule_change、去重鍵加 parent: 前綴、連家長課表、帶 sessionIds、不推播', async () => {
    const db = seedWithParents();
    await run(db);
    expect(
      db.rows('notifications').find((n) => n['user_id'] === 'u-wang' && n['role'] === 'parent'),
    ).toMatchObject({
      org_id: A,
      kind: 'schedule_change',
      dedupe_key: 'schedule_change:parent:b1:k1',
      payload: {
        title: '課務異動：調課',
        url: '/parent/schedule',
        sessionIds: ['ses-1', 'ses-2'],
      },
      push_status: 'skipped',
      push_error: 'KIND_PUSH_DISABLED',
    });
  });

  it('同一批重送：不重複', async () => {
    const db = seedWithParents();
    await run(db);
    await run(db);
    expect(parentSent(db)).toHaveLength(3);
  });

  it('家長那批查詢失敗：老師那批照寫，不丟例外', async () => {
    const db = seedWithParents();
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const from = client.from.bind(client);
    client.from = (t: string) => {
      if (t === 'enrollments') throw new Error('boom');
      return from(t);
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await run(db);
    expect(db.rows('notifications').some((n) => n['role'] === 'teacher')).toBe(true);
    expect(parentSent(db)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[notify]'), 'boom');
  });
});
