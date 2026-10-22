import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { notifyLeaveForTeachers } from '../lib/notify-leave';
import { createMultiOrgDb } from '../test-utils/multi-org-db';

vi.mock('../lib/notify-leave', () => ({ notifyLeaveForTeachers: vi.fn(async () => undefined) }));
vi.mock('../lib/leave-streak', () => ({ notifyLeaveStreaks: vi.fn(async () => undefined) }));
// 分校範圍：OUT_OF_SCOPE 那位在範圍外，其他人照真的判斷（studentWriteScope 本身由 campus-write-guard 的 spec 守）
vi.mock('../lib/campus-write-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/campus-write-guard')>();
  return {
    ...actual,
    studentWriteScope: vi.fn(async (...args: Parameters<typeof actual.studentWriteScope>) =>
      args[3] === OUT_OF_SCOPE ? 'out-of-scope' : actual.studentWriteScope(...args),
    ),
  };
});

import leavesApp from './leaves';

const noticed = vi.mocked(notifyLeaveForTeachers);
afterEach(() => noticed.mockClear());

/**
 * #1100 #32：批次請假（計畫席 10-23 裁 A：逐筆，跟單筆 POST 共用 createLeave）。
 * 用會照條件過濾的 multi-org-db：要證明「哪幾位真的建了假、寫了 on_leave」，回固定資料的替身證明不了。
 */
const ORG = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [A, B, C, OUT_OF_SCOPE, NOT_ENROLLED] = [id(1), id(2), id(3), id(4), id(5)];
const CLS = id(11);
const D = '2026-10-06';
const S = id(101);
const S_OTHER_ORG = id(102);
const EV = id(201);

function seed(extra: Record<string, Record<string, unknown>[]> = {}) {
  const enrolled = [A, B, C, OUT_OF_SCOPE].map((student_id) => ({
    org_id: ORG,
    student_id,
    class_id: CLS,
    status: 'active',
    effective_from: '2026-01-01',
    effective_to: null,
  }));
  const session = {
    id: S,
    org_id: ORG,
    class_id: CLS,
    session_date: D,
    start_time: '09:00:00',
    end_time: '11:00:00',
    status: 'scheduled',
  };
  return createMultiOrgDb({
    students: [A, B, C, OUT_OF_SCOPE, NOT_ENROLLED].map((sid, i) => ({
      id: sid,
      org_id: ORG,
      name: `學生${i + 1}`,
    })),
    enrollments: enrolled,
    sessions: [session, { ...session, id: S_OTHER_ORG, org_id: ORG_B }],
    events: [
      {
        id: EV,
        org_id: ORG,
        event_type: 'session',
        event_date: D,
        start_time: '09:00:00',
        end_time: '11:00:00',
        attendance_taken_at: null,
        sessions: { id: S, class_id: CLS, status: 'scheduled' },
      },
    ],
    leave_requests: [],
    leave_request_sessions: [],
    attendance_records: [],
    audit_logs: [],
    profiles: [],
    ...extra,
  });
}

function batch(db: ReturnType<typeof createMultiOrgDb>, body: Record<string, unknown>) {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', db.client);
    set('orgId', ORG);
    set('campusScope', null);
    set('userId', 'user-1');
    set('roles', ['admin']);
    await next();
  });
  app.route('/api/leaves', leavesApp);
  return app.request('/api/leaves/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: S, ...body }),
  });
}

type Res = {
  created: number;
  failed: number;
  results: Array<{ studentId: string; status: string; code?: string; error?: string }>;
};
const onLeave = (db: ReturnType<typeof createMultiOrgDb>) =>
  db
    .rows('attendance_records')
    .filter((r) => r['status'] === 'on_leave')
    .map((r) => r['student_id'])
    .sort();

describe('POST /api/leaves/batch（#1100 #32）', () => {
  it('全部成功：每位一張綁那一堂的假、各自寫 on_leave、各發一則通知（照單筆現狀）', async () => {
    const db = seed();
    const res = await batch(db, { studentIds: [A, B, C], reason: '校外教學' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Res;
    expect(body).toMatchObject({ created: 3, failed: 0 });
    expect(body.results.map((r) => r.status)).toEqual(['success', 'success', 'success']);
    const leaves = db.rows('leave_requests');
    expect(
      leaves.map((l) => [l['student_id'], l['start_date'], l['end_date'], l['reason']]).sort(),
    ).toEqual([A, B, C].map((s) => [s, D, D, '校外教學']).sort());
    expect(db.rows('leave_request_sessions').every((r) => r['session_id'] === S)).toBe(true);
    expect(onLeave(db)).toEqual([A, B, C].sort());
    expect(noticed).toHaveBeenCalledTimes(3);
  });

  it('範圍外那位失敗、其他人照樣成功', async () => {
    const db = seed();
    const body = (await (await batch(db, { studentIds: [A, OUT_OF_SCOPE, B] })).json()) as Res;
    expect(body).toMatchObject({ created: 2, failed: 1 });
    expect(body.results[1]).toMatchObject({
      studentId: OUT_OF_SCOPE,
      status: 'failed',
      code: 'FORBIDDEN',
      error: '沒有這個分校的權限',
    });
    expect(onLeave(db)).toEqual([A, B].sort());
  });

  it('已有重疊的假那位失敗（寫出原因），其他人成功', async () => {
    const db = seed({
      leave_requests: [
        {
          id: id(301),
          org_id: ORG,
          student_id: B,
          start_date: D,
          end_date: D,
          start_time: null,
          end_time: null,
        },
      ],
    });
    const body = (await (await batch(db, { studentIds: [A, B] })).json()) as Res;
    expect(body).toMatchObject({ created: 1, failed: 1 });
    expect(body.results[1]).toMatchObject({ studentId: B, status: 'failed' });
    expect(body.results[1]!.error).toContain('已有請假紀錄');
  });

  it('全部失敗：沒有報名這班的學生 → 每位都 failed，沒有任何寫入', async () => {
    const db = seed();
    const body = (await (await batch(db, { studentIds: [NOT_ENROLLED] })).json()) as Res;
    expect(body).toMatchObject({ created: 0, failed: 1 });
    expect(body.results[0]).toMatchObject({ status: 'failed', code: 'INVALID_SESSION' });
    expect(db.rows('leave_requests')).toEqual([]);
    expect(db.rows('attendance_records')).toEqual([]);
  });

  it('同一位帶兩次只建一張', async () => {
    const db = seed();
    const body = (await (await batch(db, { studentIds: [A, A] })).json()) as Res;
    expect(body.results).toHaveLength(1);
    expect(db.rows('leave_requests')).toHaveLength(1);
  });

  it('別 org／不存在的堂 → 404，誰都沒建', async () => {
    const db = seed();
    const res = await batch(db, { sessionId: S_OTHER_ORG, studentIds: [A] });
    expect(res.status).toBe(404);
    expect(db.rows('leave_requests')).toEqual([]);
  });

  it('一次最多 100 位', async () => {
    const db = seed();
    const ids = Array.from({ length: 101 }, (_, i) => id(1000 + i));
    expect((await batch(db, { studentIds: ids })).status).toBe(400);
  });
});
