import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createChildDb } from '../lib/child-db';
import { createMultiOrgDb } from '../test-utils/multi-org-db';
import notificationsRoute from './notifications';

/**
 * #1100 #49 第二張：家長展開課務異動通知的「原本／改為」。
 * **payload 不當授權依據** —— sessionIds 裡混了別人孩子的班、別 org 的堂，只能回自己孩子那天在籍的。
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = 'org-1';
const CHILD = id(1);
const [S_RESCHED, S_SUB, S_CANCEL, S_OTHER_KID, S_OTHER_ORG, S_LEFT] = [11, 12, 13, 14, 15, 16].map(
  id,
);
const S_VOID = id(17);
const NOTE = id(99);

const sess = (sid: string, over: Record<string, unknown> = {}) => ({
  id: sid,
  org_id: ORG,
  class_id: 'k1',
  session_date: '2026-10-09',
  start_time: '15:30:00',
  end_time: '17:00:00',
  status: 'scheduled',
  classes: { name: '國一數學 A 班' },
  teacher: { display_name: '王老師' },
  ...over,
});

function seed(over: Record<string, Record<string, unknown>[]> = {}) {
  return createMultiOrgDb({
    notifications: [
      {
        id: NOTE,
        user_id: 'me',
        org_id: ORG,
        role: 'parent',
        kind: 'schedule_change',
        payload: {
          title: '課務異動：調課',
          body: 'x',
          sessionIds: [
            S_RESCHED,
            S_SUB,
            S_CANCEL,
            S_OTHER_KID,
            S_OTHER_ORG,
            S_LEFT,
            S_VOID,
            'not-a-uuid',
          ],
        },
      },
      // 別人的那則：同 id 不同人拿不到
      {
        id: id(98),
        user_id: 'someone',
        org_id: ORG,
        role: 'parent',
        kind: 'schedule_change',
        payload: { sessionIds: [S_RESCHED] },
      },
    ],
    enrollments: [
      {
        student_id: CHILD,
        class_id: 'k1',
        status: 'active',
        effective_from: '2026-09-01',
        effective_to: null,
      },
      // 退班：10/1 就離開 k3
      {
        student_id: CHILD,
        class_id: 'k3',
        status: 'active',
        effective_from: '2026-09-01',
        effective_to: '2026-10-01',
      },
      // 作廢的報名：k4 不算在籍
      {
        student_id: CHILD,
        class_id: 'k4',
        status: 'void',
        effective_from: '2026-09-01',
        effective_to: null,
      },
      // 別人的孩子在 k2
      {
        student_id: id(2),
        class_id: 'k2',
        status: 'active',
        effective_from: '2026-09-01',
        effective_to: null,
      },
    ],
    sessions: [
      sess(S_RESCHED),
      sess(S_SUB, { session_date: '2026-10-10', teacher: { display_name: '江老師' } }),
      sess(S_CANCEL, { session_date: '2026-10-11', status: 'cancelled' }),
      sess(S_OTHER_KID, { class_id: 'k2' }),
      sess(S_OTHER_ORG, { org_id: 'org-2' }),
      sess(S_LEFT, { class_id: 'k3' }),
      sess(S_VOID, { class_id: 'k4' }),
    ],
    schedule_changes: [
      // 調課：舊的一筆、新的一筆 —— 取最新那筆的原值
      {
        org_id: ORG,
        session_id: S_RESCHED,
        change_type: 'reschedule',
        original_session_date: '2026-10-01',
        original_start_time: '15:30:00',
        original_end_time: '17:00:00',
        reason: '老師私事',
        created_at: '2026-09-20T00:00:00Z',
      },
      {
        org_id: ORG,
        session_id: S_RESCHED,
        change_type: 'reschedule',
        original_session_date: '2026-10-08',
        original_start_time: '15:30:00',
        original_end_time: '17:00:00',
        reason: '老師私事',
        created_at: '2026-09-25T00:00:00Z',
      },
      {
        org_id: ORG,
        session_id: S_SUB,
        change_type: 'substitute',
        original_teacher_name: '王老師',
        reason: '請假',
        created_at: '2026-09-25T00:00:00Z',
      },
      {
        org_id: ORG,
        session_id: S_CANCEL,
        change_type: 'cancellation',
        reason: '颱風',
        created_at: '2026-09-25T00:00:00Z',
      },
    ],
    ...over,
  });
}

function call(db: ReturnType<typeof seed>, noteId = NOTE, roles = ['parent']) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('userId', 'me');
    set('roles', roles);
    set('activeRole', roles[0]);
    set('childDb', createChildDb(db.client as never, [CHILD], ORG));
    await next();
  });
  app.route('/', notificationsRoute as unknown as Hono);
  return app.request(`/${noteId}/schedule-change`);
}

describe('GET /api/notifications/{id}/schedule-change（#1100 #49）', () => {
  it('只回自己孩子那天在籍的堂（別人孩子的班、別 org、已退班的都不回）；原本／改為；原因只給停課', async () => {
    const res = await call(seed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toEqual([
      {
        sessionId: S_RESCHED,
        className: '國一數學 A 班',
        changeType: 'reschedule',
        was: { date: '2026-10-08', startTime: '15:30', endTime: '17:00', teacherName: '王老師' },
        now: { date: '2026-10-09', startTime: '15:30', endTime: '17:00', teacherName: '王老師' },
        reason: null,
      },
      {
        sessionId: S_SUB,
        className: '國一數學 A 班',
        changeType: 'substitute',
        was: { date: '2026-10-10', startTime: '15:30', endTime: '17:00', teacherName: '王老師' },
        now: { date: '2026-10-10', startTime: '15:30', endTime: '17:00', teacherName: '江老師' },
        reason: null,
      },
      {
        sessionId: S_CANCEL,
        className: '國一數學 A 班',
        changeType: 'cancellation',
        was: { date: '2026-10-11', startTime: '15:30', endTime: '17:00', teacherName: '王老師' },
        now: null,
        reason: '颱風',
      },
    ]);
  });

  it('別人的那則、不存在、不是家長身分 → 404', async () => {
    expect((await call(seed(), id(98))).status).toBe(404);
    expect((await call(seed(), id(97))).status).toBe(404);
    expect((await call(seed(), NOTE, ['teacher'])).status).toBe(404);
  });

  it('不是課務異動那種（沒有 sessionIds）→ 404', async () => {
    const db = seed({
      notifications: [
        {
          id: NOTE,
          user_id: 'me',
          org_id: ORG,
          role: 'parent',
          kind: 'invoice_due',
          payload: { sessionIds: [S_RESCHED] },
        },
      ],
    });
    expect((await call(db)).status).toBe(404);
  });
});
