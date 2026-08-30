import { describe, expect, it } from 'vitest';

import { isAttendanceEditable } from './attendance-window';

const base = { responsible: 'teacher' as const, retroactiveDays: 7, today: '2026-08-30' };

describe('isAttendanceEditable', () => {
  it('窗內可以改', () => {
    expect(isAttendanceEditable({ ...base, isAdmin: false, eventDate: '2026-08-25' })).toBe(true);
  });

  it('剛好在窗上可以改，超過一天就不行', () => {
    expect(isAttendanceEditable({ ...base, isAdmin: false, eventDate: '2026-08-23' })).toBe(true);
    expect(isAttendanceEditable({ ...base, isAdmin: false, eventDate: '2026-08-22' })).toBe(false);
  });

  /**
   * **`0` 代表無限制，不是「只有當天」** —— 欄位的 COMMENT 就是這樣寫的
   * （`20260401000001:21`），而且這是目前**所有機構的值**。寫反的話一上線就把
   * 全部的人鎖在當天。
   */
  it('0 是無限制', () => {
    expect(
      isAttendanceEditable({
        ...base,
        retroactiveDays: 0,
        isAdmin: false,
        eventDate: '2020-01-01',
      }),
    ).toBe(true);
  });

  /**
   * 前端的鎖有**兩個**條件，伺服器要照抄 —— 這個切片是把限制搬到伺服器，不是改規則。
   * 行政負責點名的機構，老師本來就不受這個窗管。
   */
  it('行政負責點名的機構不鎖', () => {
    expect(
      isAttendanceEditable({
        ...base,
        responsible: 'admin',
        isAdmin: false,
        eventDate: '2020-01-01',
      }),
    ).toBe(true);
  });

  // B1：管理員豁免。現行 spec 就寫「修改過期出勤需找管理員」，擋住管理員等於把
  // 逃生門焊死，會逼出「改設定 → 改資料 → 改回設定」這個更難稽核的繞道
  it('管理員不受窗限制', () => {
    expect(isAttendanceEditable({ ...base, isAdmin: true, eventDate: '2020-01-01' })).toBe(true);
  });

  it('未來的課堂不受補登窗影響（那是另一回事）', () => {
    expect(isAttendanceEditable({ ...base, isAdmin: false, eventDate: '2026-09-10' })).toBe(true);
  });
});
