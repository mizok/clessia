import type { Session } from '@core/sessions.service';
import {
  groupByDate,
  groupByStart,
  isLive,
  layoutDay,
  pickRange,
  summarizeWeek,
} from './schedule-day.util';

function s(over: Partial<Session> & { id: string }): Session {
  return {
    sessionDate: '2026-10-01',
    startTime: '17:00',
    endTime: '19:00',
    status: 'scheduled',
    assignmentStatus: 'assigned',
    classId: 'c',
    className: '班',
    courseId: 'co',
    courseName: '課',
    campusId: 'ca',
    campusName: '校',
    teacherId: 't1',
    teacherName: '甲',
    hasChanges: false,
    ...over,
  };
}

describe('layoutDay', () => {
  it('沒有課回 null', () => {
    expect(layoutDay([])).toBeNull();
  });

  it('軸從最早開始的整點到最晚結束的整點；位置是百分比', () => {
    const l = layoutDay([s({ id: 'a', startTime: '17:30', endTime: '19:00' })])!;
    expect([l.startHour, l.endHour]).toEqual([17, 19]);
    expect(l.rows[0].blocks[0]).toMatchObject({ left: 25, width: 75, lane: 0 });
  });

  it('一列一位老師，依最早開課排；還沒指派老師的那列永遠在最後', () => {
    const l = layoutDay([
      s({
        id: 'u',
        teacherId: null,
        teacherName: null,
        assignmentStatus: 'unassigned',
        startTime: '15:00',
        endTime: '16:00',
      }),
      s({ id: 'b', teacherId: 't2', teacherName: '乙', startTime: '18:00', endTime: '19:00' }),
      s({ id: 'a', teacherId: 't1', teacherName: '甲', startTime: '16:00', endTime: '17:00' }),
    ])!;
    expect(l.rows.map((r) => r.teacherId)).toEqual(['t1', 't2', null]);
  });

  it('同一位老師時間重疊就往下疊一條車道，並標成撞堂；停課不算撞', () => {
    const l = layoutDay([
      s({ id: 'a', startTime: '17:00', endTime: '19:00' }),
      s({ id: 'b', startTime: '18:00', endTime: '20:00' }),
      s({ id: 'c', startTime: '19:00', endTime: '21:00' }),
      s({ id: 'x', startTime: '17:00', endTime: '18:00', status: 'cancelled' }),
    ])!;
    const row = l.rows[0];
    const lane = Object.fromEntries(row.blocks.map((b) => [b.session.id, b.lane]));
    expect(lane['a']).toBe(0);
    expect(lane['b']).toBe(1);
    expect(lane['c']).toBe(0); // a 19:00 結束，c 19:00 開始：接得上
    expect(row.lanes).toBe(2); // 停課那堂也要有位置（17:00 跟 a 同時開始，落在第二條，b 接在它後面）
    expect([...l.clashIds].sort()).toEqual(['a', 'b', 'c']);
  });

  it('沒指派老師的課彼此重疊不算撞堂', () => {
    const none = { teacherId: null, teacherName: null, assignmentStatus: 'unassigned' as const };
    const l = layoutDay([s({ id: 'a', ...none }), s({ id: 'b', ...none })])!;
    expect(l.clashIds.size).toBe(0);
  });

  it('最滿時段：每 15 分鐘數同時幾班（不含停課），取第一段最大值的連續區間', () => {
    const l = layoutDay([
      s({ id: 'a', teacherId: 't1', startTime: '17:00', endTime: '19:00' }),
      s({ id: 'b', teacherId: 't2', startTime: '18:00', endTime: '20:00' }),
      s({ id: 'c', teacherId: 't3', startTime: '18:30', endTime: '19:30', status: 'cancelled' }),
    ])!;
    expect(l.peak).toEqual({ count: 2, from: '18:00', to: '19:00' });
  });

  it('同時不到兩班就不標最滿', () => {
    expect(layoutDay([s({ id: 'a' })])!.peak).toBeNull();
  });

  it('接受 HH:mm:ss', () => {
    const l = layoutDay([s({ id: 'a', startTime: '17:00:00', endTime: '18:00:00' })])!;
    expect([l.startHour, l.endHour]).toEqual([17, 18]);
  });
});

describe('isLive', () => {
  const now = new Date(2026, 9, 1, 17, 40);
  it('今天、已開始、還沒結束、沒停課', () => {
    expect(isLive(s({ id: 'a' }), now)).toBe(true);
    expect(isLive(s({ id: 'a', status: 'cancelled' }), now)).toBe(false);
    expect(isLive(s({ id: 'a', startTime: '18:00' }), now)).toBe(false);
    expect(isLive(s({ id: 'a', endTime: '17:40' }), now)).toBe(false);
    expect(isLive(s({ id: 'a', sessionDate: '2026-10-02' }), now)).toBe(false);
  });
});

describe('groupByStart / groupByDate', () => {
  it('依開始時間分組，組內依老師名', () => {
    const g = groupByStart([
      s({ id: 'b', startTime: '18:00' }),
      s({ id: 'a2', startTime: '17:00', teacherName: 'B' }),
      s({ id: 'a1', startTime: '17:00', teacherName: 'A' }),
    ]);
    expect(g.map((x) => [x.start, x.sessions.map((y) => y.id)])).toEqual([
      ['17:00', ['a1', 'a2']],
      ['18:00', ['b']],
    ]);
  });

  it('依日期分章、章內再依開始時間分組', () => {
    const d = groupByDate([
      s({ id: 'b', sessionDate: '2026-10-02' }),
      s({ id: 'a', sessionDate: '2026-10-01' }),
    ]);
    expect(d.map((x) => x.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(d[0].groups[0].sessions[0].id).toBe('a');
  });
});

describe('summarizeWeek', () => {
  const days = ['2026-09-28', '2026-09-29', '2026-09-30'];

  it('每天一格（沒課的天也有），各自分組、數同時最多幾班', () => {
    const w = summarizeWeek(days, [
      s({ id: 'a', sessionDate: '2026-09-28' }),
      s({ id: 'b', sessionDate: '2026-09-28', teacherId: 't2', teacherName: 'B' }),
      s({ id: 'c', sessionDate: '2026-09-30', startTime: '09:00', endTime: '10:00' }),
    ]);
    expect(w.map((d) => d.date)).toEqual(days);
    expect(w.map((d) => d.sessions.length)).toEqual([2, 0, 1]);
    expect(w.map((d) => d.maxConcurrent)).toEqual([2, 0, 1]);
    expect(w[0].peak).toEqual({ count: 2, from: '17:00', to: '19:00' });
    expect(w[2].peak).toBeNull();
    expect(w[2].groups[0].start).toBe('09:00');
  });

  it('異動＝停課、有異動、撞堂；停課另外數，不算同時', () => {
    const [d] = summarizeWeek(
      ['2026-10-01'],
      [
        s({ id: 'x', status: 'cancelled' }),
        s({ id: 'h', teacherId: 't2', hasChanges: true }),
        s({ id: 'c1', teacherId: 't3', startTime: '09:00', endTime: '10:00' }),
        s({ id: 'c2', teacherId: 't3', startTime: '09:30', endTime: '10:30' }),
        s({ id: 'ok', teacherId: 't4', startTime: '12:00', endTime: '13:00' }),
      ],
    );
    expect(d.cancelled).toBe(1);
    expect(d.changed).toBe(4);
    expect([...d.clashIds].sort()).toEqual(['c1', 'c2']);
    expect(d.maxConcurrent).toBe(2);
  });

  it('整天停課：同時 0 班', () => {
    const [d] = summarizeWeek(['2026-10-01'], [s({ id: 'x', status: 'cancelled' })]);
    expect(d.maxConcurrent).toBe(0);
  });
});

describe('pickRange（Shift 範圍勾，A6 toggle）', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('從上一次勾的到這一次，中間全部加進去（不分方向）', () => {
    expect([...pickRange(new Set(['b']), order, 'b', 'd')].sort()).toEqual(['b', 'c', 'd']);
    expect([...pickRange(new Set(['d']), order, 'd', 'b')].sort()).toEqual(['b', 'c', 'd']);
  });

  it('範圍勾只加不減：已勾的留著', () => {
    expect([...pickRange(new Set(['a', 'c']), order, 'c', 'e')].sort()).toEqual([
      'a',
      'c',
      'd',
      'e',
    ]);
  });

  it('沒有上一次、或上一次不在畫面上：當成單勾切換', () => {
    expect([...pickRange(new Set(), order, null, 'c')]).toEqual(['c']);
    expect([...pickRange(new Set(['c']), order, 'zz', 'c')]).toEqual([]);
  });
});
