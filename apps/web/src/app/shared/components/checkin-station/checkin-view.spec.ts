import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import type { DailyCheckinConfirmation } from '@core/daily-checkins.service';
import { checkinFailure, checkinView } from './checkin-view';

type Session = DailyCheckinConfirmation['todaySessions'][number];
const s = (id: string, start: string, over: Partial<Session> = {}): Session => ({
  sessionId: id,
  className: `班${id}`,
  startTime: start,
  endTime: '18:30:00',
  onLeave: false,
  attendance: 'present',
  ...over,
});
const base = (over: Partial<DailyCheckinConfirmation> = {}): DailyCheckinConfirmation => ({
  id: 'c1',
  studentId: 'stu',
  campusId: 'c',
  checkinDate: '2026-10-03',
  checkedInAt: '2026-10-03T09:40:00Z', // 台北 17:40
  student: { name: '盧睿哲' },
  alreadyCheckedIn: false,
  attendanceMode: 'daily_checkin',
  todaySessions: [s('a', '17:00:00')],
  ...over,
});

/** 設計稿 b6 pub-qr-checkin 的每一種結果 */
describe('checkinView（#1127）', () => {
  it('ok（日到班、全部記到）：名字＋台北時間到班，「都記出席了」，每堂「已記出席」', () => {
    const v = checkinView(base());
    expect(v.headline).toBe('盧睿哲，17:40 到班');
    expect(v.summary).toBe('今天的課都記出席了。');
    expect(v.rows).toEqual([
      { sessionId: 'a', time: '17:00–18:30', className: '班a', label: '已記出席' },
    ]);
  });

  it('日到班但有堂沒記到（課堂還沒生成）：不說「都記出席了」', () => {
    const v = checkinView(base({ todaySessions: [s('a', '17:00:00', { attendance: null })] }));
    expect(v.summary).toBe('到班時間記下來了。');
    expect(v.rows[0]?.label).toBe('等老師點名');
  });

  it('per-session：出席由老師點名', () => {
    const v = checkinView(
      base({
        attendanceMode: 'per_session',
        todaySessions: [s('a', '17:00:00', { attendance: null })],
      }),
    );
    expect(v.summary).toContain('出席由老師上課時點名');
    expect(v.rows[0]?.label).toBe('等老師點名');
  });

  it('again：講第一次的時間、不用再打', () => {
    const v = checkinView(base({ alreadyCheckedIn: true }));
    expect(v.headline).toBe('盧睿哲 今天 17:40 已經打過卡了');
    expect(v.summary).toBe('不用再打。');
  });

  it('noclass：記下到班、不記出席、找櫃台', () => {
    const v = checkinView(base({ todaySessions: [] }));
    expect(v.summary).toBe('今天沒有你的課。');
    expect(v.note).toContain('不會記任何一堂出席');
  });

  it('leave（全部請假）：請假的課不會改成出席、找櫃台銷假', () => {
    const v = checkinView(
      base({ todaySessions: [s('a', '17:00:00', { onLeave: true, attendance: 'on_leave' })] }),
    );
    expect(v.tone).toBe('leave');
    expect(v.summary).toContain('請假的課不會改成出席');
    expect(v.note).toContain('銷假');
    expect(v.rows[0]?.label).toBe('請假（不變）');
  });

  it('一堂請假、一堂出席：照實際紀錄逐堂講，並提醒銷假', () => {
    const v = checkinView(
      base({
        todaySessions: [
          s('a', '17:00:00'),
          s('b', '19:00:00', { onLeave: true, attendance: null }),
        ],
      }),
    );
    expect(v.rows.map((r) => r.label)).toEqual(['已記出席', '請假']);
    expect(v.summary).toBe('到班時間記下來了。');
    expect(v.note).toContain('銷假');
  });
});

describe('checkinFailure', () => {
  const err = (status: number) => new HttpErrorResponse({ status });

  it('offline（status 0）：明說這次沒有記到，給「再掃一次」', () => {
    expect(checkinFailure(err(0))).toMatchObject({ title: '這次沒有記到', retry: true });
  });

  it.each([400, 404])('invalid（%i）：這張卡讀不到學生', (status) => {
    expect(checkinFailure(err(status))).toMatchObject({ title: '這張卡讀不到學生', retry: false });
  });

  it('403：不能在這裡打卡；401：機台已登出', () => {
    expect(checkinFailure(err(403)).title).toContain('不能在這裡打卡');
    expect(checkinFailure(err(401)).title).toBe('機台已登出');
  });
});
