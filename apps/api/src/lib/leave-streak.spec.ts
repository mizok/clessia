import { describe, expect, it } from 'vitest';

import type { LeaveWindow } from './leave-covers-session';
import {
  detectLeaveStreaks,
  formatLeaveStreakNotice,
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
