import { dateRangeOf, signedSummary } from './contact-book.util';
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
