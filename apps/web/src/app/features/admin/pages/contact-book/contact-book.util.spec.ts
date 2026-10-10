import {
  dateRangeOf,
  groupEntriesByDay,
  groupMissingByClass,
  missingDayOptions,
  signedSummary,
  signedTimeText,
} from './contact-book.util';
import type { ContactBookEntry } from '@core/contact-book.service';

function entry(overrides: Partial<ContactBookEntry> = {}): ContactBookEntry {
  return {
    id: 'e1',
    studentId: 's1',
    studentName: '陳小明',
    entryDate: '2026-08-29',
    content: '今天上課很專心。',
    lastEditedByName: '王老師',
    signedBy: null,
    signedAt: null,
    isSigned: false,
    ...overrides,
  };
}

describe('dateRangeOf', () => {
  // 7 天的窗含今天，所以往回退 6 天而不是 7 —— 差一天的錯在這裡最容易發生
  it('7 天的區間含今天，往回退 6 天', () => {
    expect(dateRangeOf(7, '2026-08-29')).toEqual({ from: '2026-08-23', to: '2026-08-29' });
  });

  it('1 天的區間就是今天', () => {
    expect(dateRangeOf(1, '2026-08-29')).toEqual({ from: '2026-08-29', to: '2026-08-29' });
  });

  // 月初往回退要跨到上個月，而且上個月有幾天要算對
  it('月初往回退會跨月', () => {
    expect(dateRangeOf(7, '2026-09-02')).toEqual({ from: '2026-08-27', to: '2026-09-02' });
  });

  it('三月初往回退落在二月，非閏年是 28 天', () => {
    expect(dateRangeOf(7, '2026-03-03')).toEqual({ from: '2026-02-25', to: '2026-03-03' });
  });

  // 2028 是閏年，2/29 存在 —— 用固定 30 天的算法會算成 3/1
  it('閏年的二月底算得對', () => {
    expect(dateRangeOf(3, '2028-03-01')).toEqual({ from: '2028-02-28', to: '2028-03-01' });
  });

  it('跨年往回退', () => {
    expect(dateRangeOf(7, '2027-01-03')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });

  // 30 天是另一個會用到的窗
  it('30 天的區間', () => {
    expect(dateRangeOf(30, '2026-08-29')).toEqual({ from: '2026-07-31', to: '2026-08-29' });
  });
});

describe('signedSummary', () => {
  it('空清單三個數字都是零', () => {
    expect(signedSummary([])).toEqual({ total: 0, signed: 0, unsigned: 0 });
  });

  it('數已簽與未簽', () => {
    const entries = [
      entry({ id: 'e1', isSigned: true }),
      entry({ id: 'e2', isSigned: false }),
      entry({ id: 'e3', isSigned: false }),
    ];

    expect(signedSummary(entries)).toEqual({ total: 3, signed: 1, unsigned: 2 });
  });

  it('全簽了未簽是零', () => {
    const entries = [entry({ id: 'e1', isSigned: true }), entry({ id: 'e2', isSigned: true })];

    expect(signedSummary(entries)).toEqual({ total: 2, signed: 2, unsigned: 0 });
  });

  // isSigned 是後端算好的，不要從 signedAt 再推一次 —— 兩個版本的真相會分岔
  it('只看 isSigned，不從 signedAt 自己推', () => {
    const weird = entry({ isSigned: true, signedAt: null });

    expect(signedSummary([weird])).toEqual({ total: 1, signed: 1, unsigned: 0 });
  });
});

describe('groupMissingByClass', () => {
  const stu = (id: string, ...classes: string[]) => ({
    studentId: id,
    studentName: id,
    classes: classes.map((c) => ({ classId: c, className: `班${c}` })),
  });

  it('一班一組，同生跨兩班只歸第一個班', () => {
    const groups = groupMissingByClass([stu('a', 'B', 'A'), stu('b', 'A'), stu('c', 'B')]);

    expect(groups.map((g) => [g.classId, g.students.map((s) => s.studentId)])).toEqual([
      ['A', ['b']],
      ['B', ['a', 'c']],
    ]);
  });

  it('沒有班的學生歸未分班，不丟掉', () => {
    expect(groupMissingByClass([stu('x')])[0].className).toBe('未分班');
  });
});

describe('groupEntriesByDay', () => {
  it('新的日子在上，每日統計未簽收', () => {
    const days = groupEntriesByDay([
      entry({ id: '1', entryDate: '2026-08-28', isSigned: true }),
      entry({ id: '2', entryDate: '2026-08-29' }),
      entry({ id: '3', entryDate: '2026-08-28' }),
    ]);

    expect(days.map((d) => [d.date, d.entries.length, d.unsigned])).toEqual([
      ['2026-08-29', 1, 1],
      ['2026-08-28', 2, 1],
    ]);
  });
});

describe('signedTimeText', () => {
  // UTC 12:15 = 台北 20:15；UTC 前一天 16:30 = 台北當天 00:30（不能顯示成 24:30）
  it('轉成台北時間', () => {
    expect(signedTimeText('2026-08-29T12:15:00Z')).toBe('20:15');
    expect(signedTimeText('2026-08-28T16:30:00Z')).toBe('00:30');
  });

  it('沒有或壞掉的時間回空字串', () => {
    expect(signedTimeText(null)).toBe('');
    expect(signedTimeText('不是時間')).toBe('');
  });
});

describe('missingDayOptions', () => {
  // 2026-08-29 是週六：今天照列（可能補寫），往回只留週一到週五，最後一項是「其他日期…」
  it('週末的今天仍可選，其餘只列上課日，最後是其他日期', () => {
    const options = missingDayOptions('2026-08-29');

    expect(options.map((o) => o.value)).toEqual([
      '2026-08-29',
      '2026-08-28',
      '2026-08-27',
      '2026-08-26',
      '2026-08-25',
      '2026-08-24',
      'other',
    ]);
    expect(options[0].label).toBe('今天 08-29（六）');
    expect(options[1].label).toBe('昨天 08-28（五）');
  });

  it('跨月往回也對', () => {
    expect(missingDayOptions('2026-09-01')[1].value).toBe('2026-08-31');
  });
});
