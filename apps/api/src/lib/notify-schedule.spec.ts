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
