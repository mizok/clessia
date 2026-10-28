import {
  dateRangeOf,
  dayLabel,
  weekStart,
  groupEntriesByDay,
  groupMissingByClass,
  missingDayOptions,
  signedSummary,
  signedTimeText,
  signedCellText,
  PERIOD_OPTIONS,
  CUSTOM_PERIOD,
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
    signedByName: null,
    signedAt: null,
    isSigned: false,
    editedAfterSign: false,
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
    expect(options[0].label).toBe('今天 8/29（六）');
    expect(options[1].label).toBe('昨天 8/28（五）');
  });

  it('跨月往回也對', () => {
    expect(missingDayOptions('2026-09-01')[1].value).toBe('2026-08-31');
  });
});

describe('dayLabel —— A6 短日期不補零', () => {
  it('今天／昨天前綴；月日一位／兩位四種組合', () => {
    expect(dayLabel('2026-10-01', '2026-10-01')).toBe('今天 10/1（四）');
    expect(dayLabel('2026-09-30', '2026-10-01')).toBe('昨天 9/30（三）');
    expect(dayLabel('2026-09-05', '2026-10-01')).toBe('9/5（六）');
    expect(dayLabel('2026-10-15', '2026-10-20')).toBe('10/15（四）');
    expect(dayLabel('2026-11-05', '2026-12-20')).toBe('11/5（四）');
  });
});

describe('weekStart —— 「這週」從週一算（台北曆日字串）', () => {
  it('週一回自己；週二回前一天；週日回 6 天前（週一 ±1 邊界）', () => {
    expect(weekStart('2027-03-01')).toBe('2027-03-01'); // 週一
    expect(weekStart('2027-03-02')).toBe('2027-03-01'); // 週二
    expect(weekStart('2027-03-05')).toBe('2027-03-01'); // 週五
    expect(weekStart('2027-03-06')).toBe('2027-03-01'); // 週六
    expect(weekStart('2027-03-07')).toBe('2027-03-01'); // 週日
    expect(weekStart('2027-03-08')).toBe('2027-03-08'); // 下個週一
  });

  it('跨月、跨年、閏日', () => {
    expect(weekStart('2027-01-01')).toBe('2026-12-28'); // 週五，跨年
    expect(weekStart('2026-10-01')).toBe('2026-09-28'); // 週四，跨月
    expect(weekStart('2028-03-01')).toBe('2028-02-28'); // 週三，2028 閏年 2/29 在其後
    expect(weekStart('2028-02-29')).toBe('2028-02-28'); // 週二，閏日
  });
});

describe('signedCellText（C2）', () => {
  const base = { id: 'e', isSigned: true } as ContactBookEntry;

  it('有姓名＝「姓名 HH:mm 簽」（台北時間）', () => {
    expect(
      signedCellText({ ...base, signedByName: '林太太', signedAt: '2026-08-29T12:06:00Z' }),
    ).toBe('林太太 20:06 簽');
  });

  it('沒有姓名退回「已簽收 HH:mm」', () => {
    expect(signedCellText({ ...base, signedByName: null, signedAt: '2026-08-29T12:06:00Z' })).toBe(
      '已簽收 20:06',
    );
  });

  it('時間解析不了不留多餘空白', () => {
    expect(signedCellText({ ...base, signedByName: '林太太', signedAt: null })).toBe('林太太 簽');
    expect(signedCellText({ ...base, signedByName: null, signedAt: null })).toBe('已簽收');
  });
});

describe('PERIOD_OPTIONS（C2）', () => {
  it('選項依序是 7／14／30 天＋自訂區間', () => {
    expect(PERIOD_OPTIONS.map((o) => o.value)).toEqual(['7', '14', '30', CUSTOM_PERIOD]);
  });

  it('最後一項是「自訂區間…」，其餘 value 都是天數', () => {
    expect(PERIOD_OPTIONS.at(-1)).toEqual({ label: '自訂區間…', value: CUSTOM_PERIOD });
    expect(PERIOD_OPTIONS.slice(0, -1).every((o) => /^\d+$/.test(o.value))).toBe(true);
  });
});
