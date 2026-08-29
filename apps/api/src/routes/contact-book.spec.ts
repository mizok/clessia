import { describe, it, expect } from 'vitest';
import { toContactBookEntryResponse } from './contact-book';

/**
 * 聯絡簿是「國小模式」：每生每日唯一一則自由文字（rules 1）。
 * 見 kb/wiki/rules/contact-book-rules.md。
 */
const ROW = {
  id: 'entry-1',
  student_id: 'student-1',
  entry_date: '2026-08-29',
  content: '今天上課很專心，數學小考 95 分。',
  last_edited_by: 'user-teacher',
  signed_by: null,
  signed_at: null,
  students: { name: '陳小明' },
  editor: { name: '林老師' },
};

describe('toContactBookEntryResponse', () => {
  it('把 snake_case 的 DB 列轉成 camelCase 回應', () => {
    expect(toContactBookEntryResponse(ROW)).toEqual({
      id: 'entry-1',
      studentId: 'student-1',
      studentName: '陳小明',
      entryDate: '2026-08-29',
      content: '今天上課很專心，數學小考 95 分。',
      lastEditedByName: '林老師',
      signedBy: null,
      signedAt: null,
      isSigned: false,
    });
  });

  /**
   * 老師端要看得到家長已讀／已簽（rules 4）—— `isSigned` 是列表那一欄的資料來源，
   * 不能讓前端自己從 signedAt 推導，否則每個呼叫端都要重寫一次判斷。
   */
  it('簽收後 isSigned 為 true，並帶出誰簽的、何時簽的', () => {
    const signed = {
      ...ROW,
      signed_by: 'user-parent',
      signed_at: '2026-08-29T12:00:00Z',
    };

    const result = toContactBookEntryResponse(signed);

    expect(result.isSigned).toBe(true);
    expect(result.signedBy).toBe('user-parent');
    expect(result.signedAt).toBe('2026-08-29T12:00:00Z');
  });

  it('關聯資料缺漏時給 null，不讓回應塌成 undefined', () => {
    const bare = { ...ROW, students: null, editor: null };

    const result = toContactBookEntryResponse(bare);

    expect(result.studentName).toBeNull();
    expect(result.lastEditedByName).toBeNull();
  });
});
