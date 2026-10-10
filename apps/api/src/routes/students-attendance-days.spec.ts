import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import studentsRoute from './students';

/**
 * #1314 SD2：`GET /students/{id}/attendance-days`。時鐘釘在 2026-03-10 10:00（台北）。
 *
 * 兩個班：日到班分校（看打卡）與逐堂分校（看出勤紀錄）—— 模式依班的分校逐天判。
 * 逐堂那班 03-08 退班，03-09 那堂不該出現。
 */

const ORG = 'org-a';
const SID = '00000000-0000-0000-0000-0000000000a1';
const NOW = new Date('2026-03-10T10:00:00+08:00');

const session = (
  id: string,
  classId: string,
  date: string,
  start: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  org_id: ORG,
  event_id: `ev-${id}`,
  class_id: classId,
  session_date: date,
  start_time: `${start}:00`,
  end_time: null,
  status: 'scheduled',
  events: null,
  classes: {
    name: classId === 'c-daily' ? '數學' : '英文',
    campus_id: classId === 'c-daily' ? 'campus-d' : 'campus-s',
  },
  ...extra,
});

function seed() {
  return createMultiOrgDb({
    students: [
      {
        id: SID,
        org_id: ORG,
        name: '小明',
        enrollments: [
          { classes: { campus_id: 'campus-d' } },
          { classes: { campus_id: 'campus-s' } },
        ],
      },
    ],
    enrollments: [
      {
        org_id: ORG,
        student_id: SID,
        class_id: 'c-daily',
        status: 'active',
        effective_from: '2026-03-01',
        effective_to: null,
      },
      {
        org_id: ORG,
        student_id: SID,
        class_id: 'c-sess',
        status: 'withdrawal',
        effective_from: '2026-03-01',
        effective_to: '2026-03-08',
      },
      // 作廢的報名不算
      {
        org_id: ORG,
        student_id: SID,
        class_id: 'c-void',
        status: 'void',
        effective_from: '2026-03-01',
        effective_to: null,
      },
    ],
    sessions: [
      session('s02', 'c-daily', '2026-03-02', '18:00'),
      session('s03', 'c-daily', '2026-03-03', '18:00'),
      session('s04', 'c-daily', '2026-03-04', '18:00', { status: 'cancelled' }),
      session('s05', 'c-sess', '2026-03-05', '18:00'),
      session('s06', 'c-sess', '2026-03-06', '18:00'),
      session('s09', 'c-sess', '2026-03-09', '18:00'),
      session('s10', 'c-daily', '2026-03-10', '15:00'),
      session('s12', 'c-daily', '2026-03-12', '18:00'),
      session('sv', 'c-void', '2026-03-05', '10:00'),
    ],
    organizations: [{ id: ORG, attendance_mode: 'daily_checkin' }],
    campuses: [
      { id: 'campus-d', org_id: ORG, attendance_mode: 'daily_checkin' },
      { id: 'campus-s', org_id: ORG, attendance_mode: 'per_session' },
    ],
    daily_checkins: [
      { org_id: ORG, student_id: SID, checkin_date: '2026-03-02' },
      // 逐堂分校那天有打卡也不算到 —— 那個模式看出勤紀錄
      { org_id: ORG, student_id: SID, checkin_date: '2026-03-06' },
    ],
    attendance_records: [
      { org_id: ORG, student_id: SID, event_id: 'ev-s05', status: 'present' },
      { org_id: ORG, student_id: SID, event_id: 'ev-s06', status: 'absent' },
    ],
    leave_requests: [
      {
        org_id: ORG,
        student_id: SID,
        start_date: '2026-03-03',
        end_date: '2026-03-03',
        start_time: null,
        end_time: null,
        leave_request_sessions: [],
      },
    ],
  });
}

function request(path: string, campusScope: string[] | null = null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const set = (c as unknown as { set: (k: string, v: unknown) => void }).set.bind(c);
    set('supabase', seed().client);
    set('orgId', ORG);
    set('userId', 'u1');
    set('roles', ['admin']);
    set('campusScope', campusScope);
    await next();
  });
  app.route('/', studentsRoute as unknown as Hono);
  return app.request(path);
}

describe('GET /students/{id}/attendance-days（#1314 SD2）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('一天一格，模式依班的分校判；退班後與作廢報名的課不算', async () => {
    const res = await request(`/${SID}/attendance-days?from=2026-03-01&to=2026-03-31`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      days: Array<{ date: string; state: string }>;
      summary: { due: number; came: number; absentDates: string[] };
      today: { startTime: string | null } | null;
      nextSession: { date: string; startTime: string | null; className: string } | null;
    };

    expect(Object.fromEntries(body.days.map((d) => [d.date, d.state]))).toEqual({
      '2026-03-02': 'came', // 日到班：有打卡
      '2026-03-03': 'on_leave',
      '2026-03-04': 'cancelled',
      '2026-03-05': 'came', // 逐堂：出勤 present
      '2026-03-06': 'absent', // 逐堂：有打卡也不算
      '2026-03-10': 'future', // 今天 15:00 還沒開始
      '2026-03-12': 'future',
    });
    expect(body.summary).toEqual({ due: 4, came: 2, absentDates: ['2026-03-06'] });
    expect(body.today).toEqual({ startTime: '15:00' });
    expect(body.nextSession).toEqual({ date: '2026-03-12', startTime: '18:00', className: '數學' });
  });

  it('今天的課已經開始還沒打卡 → absent（不是 future）', async () => {
    vi.setSystemTime(new Date('2026-03-10T15:30:00+08:00'));
    const res = await request(`/${SID}/attendance-days?from=2026-03-10&to=2026-03-10`);
    const body = (await res.json()) as { days: Array<{ state: string }> };
    expect(body.days.map((d) => d.state)).toEqual(['absent']);
  });

  it('區間不合法 → 400；超過 366 天 → 400', async () => {
    expect((await request(`/${SID}/attendance-days?from=2026-03-10&to=2026-03-01`)).status).toBe(
      400,
    );
    expect((await request(`/${SID}/attendance-days?from=2025-01-01&to=2026-03-01`)).status).toBe(
      400,
    );
  });

  it('別 org 的學生 404；受限管理員範圍外 404（同 GET /students/{id}）', async () => {
    const other = '00000000-0000-0000-0000-0000000000b9';
    expect((await request(`/${other}/attendance-days?from=2026-03-01&to=2026-03-31`)).status).toBe(
      404,
    );
    expect(
      (await request(`/${SID}/attendance-days?from=2026-03-01&to=2026-03-31`, ['campus-x'])).status,
    ).toBe(404);
    expect(
      (await request(`/${SID}/attendance-days?from=2026-03-01&to=2026-03-31`, ['campus-s'])).status,
    ).toBe(200);
  });
});
