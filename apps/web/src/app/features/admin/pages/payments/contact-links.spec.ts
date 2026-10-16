import { contactMessage, mailtoHref, smsHref, telHref } from './contact-links';

/** #1625 快速聯絡家長：連結字串（jsdom 只驗字串；iOS／Android 實機另驗） */
describe('contact-links（#1625）', () => {
  it('tel：只留數字與開頭的 +', () => {
    expect(telHref('0912-345 678')).toBe('tel:0912345678');
    expect(telHref('+886 912 345 678')).toBe('tel:+886912345678');
  });

  it('sms：`?&body=` 兩邊通吃（計畫席 gate：先試這種，不判 UA）', () => {
    expect(smsHref('0912-345-678', '王小明 家長您好')).toBe(
      `sms:0912345678?&body=${encodeURIComponent('王小明 家長您好')}`,
    );
  });

  it('mailto：主旨與內文都 encode', () => {
    expect(mailtoHref('mom@example.com', '繳費提醒 & 說明', '第一行\n第二行')).toBe(
      `mailto:mom@example.com?subject=${encodeURIComponent('繳費提醒 & 說明')}&body=${encodeURIComponent('第一行\n第二行')}`,
    );
  });

  it('內文：學生、未收金額（千分位）、期限、匯款帳戶', () => {
    const text = contactMessage({
      studentName: '王小明',
      outstanding: 12500,
      dueDate: '2026-10-15',
      paymentInfo: [{ campusName: null, text: '總校帳戶 012-3456' }],
    });
    expect(text).toBe(
      '王小明 家長您好：本期帳單尚有 NT$12,500 未繳，繳費期限 10/15。\n匯款資訊：總校帳戶 012-3456',
    );
  });

  it('內文：沒有期限、沒有匯款資料就省略那一段；多筆匯款資料標分校', () => {
    expect(
      contactMessage({ studentName: '王小明', outstanding: 100, dueDate: null, paymentInfo: [] }),
    ).toBe('王小明 家長您好：本期帳單尚有 NT$100 未繳。');
    expect(
      contactMessage({
        studentName: '王小明',
        outstanding: 100,
        dueDate: null,
        paymentInfo: [
          { campusName: '總校', text: 'A 帳戶' },
          { campusName: '二校', text: 'B 帳戶' },
        ],
      }),
    ).toBe('王小明 家長您好：本期帳單尚有 NT$100 未繳。\n匯款資訊：\n總校：A 帳戶\n二校：B 帳戶');
  });
});
