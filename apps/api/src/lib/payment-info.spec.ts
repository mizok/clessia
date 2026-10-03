import { describe, expect, it } from 'vitest';

import { paymentInfoEntries, pickPaymentInfo } from './payment-info';

describe('pickPaymentInfo', () => {
  it('分校有值用分校的，空白或 null 退回機構預設', () => {
    expect(pickPaymentInfo('分校帳戶', '機構帳戶')).toBe('分校帳戶');
    expect(pickPaymentInfo(null, '機構帳戶')).toBe('機構帳戶');
    expect(pickPaymentInfo('  \n', '機構帳戶')).toBe('機構帳戶');
    expect(pickPaymentInfo(null, null)).toBeNull();
  });
});

/** 家長帳單頁的帳戶資訊：這個孩子在籍分校的生效值，以內容去重（#1073） */
describe('paymentInfoEntries', () => {
  const ORG = '機構：台銀 004 帳號 111';

  it('沒有在籍分校 → 機構預設一筆，不標分校', () => {
    expect(paymentInfoEntries([], ORG)).toEqual([{ campusName: null, text: ORG }]);
  });

  it('兩個分校都沿用機構預設 → 一筆，不標分校', () => {
    const campuses = [
      { name: '中正', paymentInfo: null },
      { name: '信義', paymentInfo: null },
    ];
    expect(paymentInfoEntries(campuses, ORG)).toEqual([{ campusName: null, text: ORG }]);
  });

  it('只有一筆生效值時不標分校（家長不需要知道是哪一層的設定）', () => {
    expect(paymentInfoEntries([{ name: '中正', paymentInfo: '中正專戶' }], ORG)).toEqual([
      { campusName: null, text: '中正專戶' },
    ]);
  });

  it('跨分校、帳戶不同 → 每筆標分校名；沿用機構的那筆也標上它的分校', () => {
    const campuses = [
      { name: '中正', paymentInfo: '中正專戶' },
      { name: '信義', paymentInfo: null },
      { name: '大安', paymentInfo: '中正專戶' },
    ];
    expect(paymentInfoEntries(campuses, ORG)).toEqual([
      { campusName: '中正、大安', text: '中正專戶' },
      { campusName: '信義', text: ORG },
    ]);
  });

  it('全都沒設定 → 空陣列（前端顯示「請洽行政人員」）', () => {
    expect(paymentInfoEntries([{ name: '中正', paymentInfo: null }], null)).toEqual([]);
    expect(paymentInfoEntries([], null)).toEqual([]);
  });
});
