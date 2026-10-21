import { describe, expect, it } from 'vitest';

import { createMultiOrgDb } from '../test-utils/multi-org-db';
import type { LeaveWindow } from './leave-covers-session';
import {
  detectLeaveStreaks,
  formatLeaveStreakNotice,
  notifyLeaveStreaks,
  reviewCovering,
  type StreakSession,
} from './leave-streak';

let seq = 0;
const s = (date: string, extra: Partial<StreakSession> = {}): StreakSession => ({
  sessionId: `s${++seq}`,
  classId: 'c-math',
  className: '國二數學',
  campusId: 'campus-1',
  date,
  startTime: '18:00',
  endTime: '20:00',
  attended: false,
  ...extra,
});
const leave = (startDate: string, endDate = startDate, extra: Partial<LeaveWindow> = {}) => ({
  startDate,
  endDate,
  startTime: null,
  endTime: null,
  boundSessions: [],
  ...extra,
});
const days = (r: ReturnType<typeof detectLeaveStreaks>) => r.map((x) => x.days.map((d) => d.date));

// 2026-10：12 一、13 二、14 三、15 四、16 五、17 六、19 一
describe('detectLeaveStreaks（#1732 設計稿 §2）', () => {
  it('週四、週五、下週一＝連續 3 個上課日（週末不算中斷）', () => {
    const sessions = [s('2026-10-15'), s('2026-10-16'), s('2026-10-19')];
    const r = detectLeaveStreaks(sessions, [leave('2026-10-15', '2026-10-19')], 3);
    expect(days(r)).toEqual([['2026-10-15', '2026-10-16', '2026-10-19']]);
    expect(r[0]).toMatchObject({ firstDay: '2026-10-15', lastDay: '2026-10-19' });
  });

  it('沒課的日子不在序列裡：週一、週三、週五三堂連請＝3 天', () => {
    const sessions = [s('2026-10-12'), s('2026-10-14'), s('2026-10-16')];
    expect(days(detectLeaveStreaks(sessions, [leave('2026-10-12', '2026-10-16')], 3))).toHaveLength(
      1,
    );
  });

  it('未達門檻不算', () => {
    const sessions = [s('2026-10-15'), s('2026-10-16'), s('2026-10-19')];
    expect(detectLeaveStreaks(sessions, [leave('2026-10-15', '2026-10-16')], 3)).toEqual([]);
  });

  it('門檻邊界：剛好 N 天算、N−1 天不算', () => {
    const sessions = [s('2026-10-12'), s('2026-10-13')];
    expect(detectLeaveStreaks(sessions, [leave('2026-10-12', '2026-10-13')], 2)).toHaveLength(1);
    expect(detectLeaveStreaks(sessions, [leave('2026-10-12', '2026-10-13')], 3)).toEqual([]);
  });

  it('相鄰的假單接起來合併（裁定 2）', () => {
    const sessions = [s('2026-10-12'), s('2026-10-13'), s('2026-10-14')];
    const r = detectLeaveStreaks(
      sessions,
      [leave('2026-10-12'), leave('2026-10-13'), leave('2026-10-14')],
      3,
    );
    expect(days(r)).toEqual([['2026-10-12', '2026-10-13', '2026-10-14']]);
  });

  it('跨班：同一天兩個班都請才算；只請其中一班那天不算、而且斷開（裁定 1）', () => {
    const sessions = [
      s('2026-10-12'),
      s('2026-10-13'),
      s('2026-10-13', {
        classId: 'c-eng',
        className: '英文',
        startTime: '20:00',
        endTime: '21:00',
      }),
      s('2026-10-14'),
    ];
    // 13 號那張只蓋 18:00–20:00 的數學、沒蓋 20:00 的英文
    const leaves = [
      leave('2026-10-12'),
      leave('2026-10-13', '2026-10-13', { startTime: '18:00', endTime: '20:00' }),
      leave('2026-10-14'),
    ];
    expect(detectLeaveStreaks(sessions, leaves, 2)).toEqual([]);
    // 整天請 → 兩班都蓋到 → 連 3 天，那天兩堂都列在明細
    const all = detectLeaveStreaks(sessions, [leave('2026-10-12', '2026-10-14')], 3);
    expect(all[0]!.days[1]!.sessions.map((x) => x.className)).toEqual(['國二數學', '英文']);
  });

  it('綁定堂次的假只蓋綁的那堂', () => {
    const a = s('2026-10-12');
    const b = s('2026-10-13');
    const other = s('2026-10-13', { classId: 'c-eng', className: '英文' });
    const bound = leave('2026-10-12', '2026-10-13', {
      boundSessions: [
        { sessionId: a.sessionId, date: a.date },
        { sessionId: b.sessionId, date: b.date },
      ],
    });
    expect(detectLeaveStreaks([a, b, other], [bound], 2)).toEqual([]);
  });

  it('請了假但有出席的那天不算、而且斷開（Q4）', () => {
    const sessions = [s('2026-10-12'), s('2026-10-13', { attended: true }), s('2026-10-14')];
    expect(detectLeaveStreaks(sessions, [leave('2026-10-12', '2026-10-14')], 2)).toEqual([]);
  });

  it('中間夾一個沒請假的上課日就斷開；兩段各自達標就各一段', () => {
    const sessions = ['12', '13', '14', '15', '16', '19', '20'].map((d) => s(`2026-10-${d}`));
    const r = detectLeaveStreaks(
      sessions,
      [leave('2026-10-12', '2026-10-14'), leave('2026-10-16', '2026-10-20')],
      3,
    );
    expect(r.map((x) => [x.firstDay, x.lastDay])).toEqual([
      ['2026-10-12', '2026-10-14'],
      ['2026-10-16', '2026-10-20'],
    ]);
  });

  it('輸入順序打亂也一樣', () => {
    const sessions = [s('2026-10-19'), s('2026-10-15'), s('2026-10-16')];
    expect(days(detectLeaveStreaks(sessions, [leave('2026-10-15', '2026-10-19')], 3))).toEqual([
      ['2026-10-15', '2026-10-16', '2026-10-19'],
    ]);
  });
});

describe('reviewCovering（§4.1 已處理）', () => {
  const streak = { firstDay: '2026-10-13', lastDay: '2026-10-15' };
  const r = (first_day: string, last_day: string) => ({
    id: 'r1',
    first_day,
    last_day,
    reviewed_by: 'u1',
    reviewed_at: 't',
  });
  it('完整涵蓋＝已處理（含縮短後仍在原區間內）', () => {
    expect(reviewCovering(streak, [r('2026-10-13', '2026-10-15')])?.id).toBe('r1');
    expect(reviewCovering(streak, [r('2026-10-12', '2026-10-16')])?.id).toBe('r1');
  });
  it('延長（往前或往後長出去）→ 不再涵蓋，重新出現', () => {
    expect(reviewCovering(streak, [r('2026-10-14', '2026-10-15')])).toBeNull();
    expect(reviewCovering(streak, [r('2026-10-13', '2026-10-14')])).toBeNull();
  });
});

describe('formatLeaveStreakNotice', () => {
  it('標題寫天數、內文列日期與星期，不寫金額', () => {
    const [streak] = detectLeaveStreaks(
      [s('2026-10-14'), s('2026-10-16'), s('2026-10-19')],
      [leave('2026-10-14', '2026-10-19')],
      3,
    );
    expect(formatLeaveStreakNotice('林小華', streak!)).toEqual({
      title: '林小華連續請假 3 個上課日',
      body: '10/14（三）、10/16（五）、10/19（一），這幾天的費用可以不收。點進去看明細。',
    });
  });
});

/**
 * #1739 二讀：通知的三道過濾要有測試守 —— 收件人要 manage_finance、已處理的段不發、只發跟這張假相交的段。
 * 走真的 `adminsForCampuses`／`notify`（替身照條件過濾），不是替身回固定收件人。
 */
describe('notifyLeaveStreaks（收件人與要發哪幾段）', () => {
  const ORG = 'org-1';
  const STU = 'stu-1';
  // 10/5–10/7 一段舊的（沒處理）、10/8 有來、10/12–10/14 這次的
  const DATES = ['05', '06', '07', '08', '12', '13', '14'].map((d) => `2026-10-${d}`);

  function seed(reviews: Array<Record<string, unknown>> = []) {
    return createMultiOrgDb({
      organizations: [{ id: ORG, leave_waiver_days: 3 }],
      students: [{ id: STU, org_id: ORG, name: '林小華' }],
      enrollments: [
        {
          org_id: ORG,
          student_id: STU,
          class_id: 'c1',
          status: 'active',
          effective_from: '2026-09-01',
          effective_to: null,
        },
      ],
      sessions: DATES.map((date) => ({
        id: `s-${date}`,
        org_id: ORG,
        class_id: 'c1',
        session_date: date,
        start_time: '18:00',
        end_time: '20:00',
        status: 'scheduled',
        event_id: null,
        events: null,
        classes: { name: '國二數學', campus_id: 'campus-1' },
      })),
      attendance_records: [],
      daily_checkins: [],
      leave_requests: [
        {
          id: 'l-old',
          org_id: ORG,
          student_id: STU,
          start_date: '2026-10-05',
          end_date: '2026-10-07',
        },
        {
          id: 'l-new',
          org_id: ORG,
          student_id: STU,
          start_date: '2026-10-12',
          end_date: '2026-10-14',
        },
      ],
      leave_streak_reviews: reviews,
      // 同分校兩位在職管理員：一位有財務權限、一位沒有；另一位有財務權限但在別的分校
      staff: [
        { id: 'st-fin', org_id: ORG, user_id: 'u-fin', status: 'active' },
        { id: 'st-ops', org_id: ORG, user_id: 'u-ops', status: 'active' },
        { id: 'st-far', org_id: ORG, user_id: 'u-far', status: 'active' },
      ],
      user_roles: [
        { user_id: 'u-fin', role: 'admin', permissions: ['manage_finance'] },
        { user_id: 'u-ops', role: 'admin', permissions: ['basic_operations', 'manage_students'] },
        { user_id: 'u-far', role: 'admin', permissions: ['manage_finance'] },
      ],
      staff_campuses: [
        { staff_id: 'st-fin', campus_id: 'campus-1' },
        { staff_id: 'st-ops', campus_id: 'campus-1' },
        { staff_id: 'st-far', campus_id: 'campus-2' },
      ],
      notifications: [],
    });
  }
  const run = (db: ReturnType<typeof seed>) =>
    notifyLeaveStreaks(db.client as never, {
      orgId: ORG,
      studentId: STU,
      from: '2026-10-12',
      to: '2026-10-14',
    });

  it('只發給那幾堂分校內有 manage_finance 的管理員；只發跟這張假相交的那一段', async () => {
    const db = seed();
    await run(db);
    expect(db.rows('notifications').map((n) => [n['user_id'], n['kind'], n['dedupe_key']])).toEqual(
      [['u-fin', 'leave_streak', `leave_streak:${STU}:2026-10-12:2026-10-14`]],
    );
  });

  it('那一段已經被「已處理」完整涵蓋：不發', async () => {
    const db = seed([
      {
        id: 'r1',
        org_id: ORG,
        student_id: STU,
        first_day: '2026-10-12',
        last_day: '2026-10-14',
        reviewed_by: 'u-fin',
        reviewed_at: 't',
      },
    ]);
    await run(db);
    expect(db.rows('notifications')).toEqual([]);
  });
});
