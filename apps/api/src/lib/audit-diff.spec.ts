import { describe, expect, it } from 'vitest';

import { auditDeleteSnapshot, auditFieldDiff } from './audit-diff';

describe('auditFieldDiff（#837）', () => {
  const before = { name: '中正分校', address: '舊地址', phone: null, is_active: true };

  it('只記這次送出的欄位，不是整列', () => {
    const diff = auditFieldDiff(before, { name: '中正旗艦校' });

    expect(diff.fields).toEqual(['name']);
    expect(diff.from).toEqual({ name: '中正分校' });
    expect(diff.to).toEqual({ name: '中正旗艦校' });
    // address 沒送 → 不該出現在任何一邊
    expect(diff.from).not.toHaveProperty('address');
  });

  it('多個欄位一起改時 from / to 逐欄對齊', () => {
    const diff = auditFieldDiff(before, { name: '新名', is_active: false });

    expect(diff.from).toEqual({ name: '中正分校', is_active: true });
    expect(diff.to).toEqual({ name: '新名', is_active: false });
  });

  /**
   * **讀不到 before 時每個欄位給 `null`，而不是把 `from` 整個省略** ——
   * 省略的話「原本是空的」與「我沒讀到」在稽核上長得一樣。
   */
  it('before 讀不到時 from 的每個欄位是 null，不是缺席', () => {
    const diff = auditFieldDiff(null, { name: '新名' });

    expect(diff.from).toEqual({ name: null });
    expect('name' in diff.from).toBe(true);
  });

  it('before 有那個欄位但值是 null 時照實記 null', () => {
    const diff = auditFieldDiff(before, { phone: '02-1234' });

    expect(diff.from).toEqual({ phone: null });
  });
});

describe('auditDeleteSnapshot（#837）', () => {
  it('只挑指定的欄位 —— 不把 created_at 這類「不是人改的」欄位塞進去', () => {
    const snapshot = auditDeleteSnapshot(
      { name: '中正分校', address: '台北', created_at: '2026-01-01', updated_at: '2026-09-01' },
      ['name', 'address'],
    );

    expect(snapshot).toEqual({ name: '中正分校', address: '台北' });
    expect(snapshot).not.toHaveProperty('created_at');
  });

  it('讀不到 before 時回空物件，不是一堆 null', () => {
    expect(auditDeleteSnapshot(null, ['name'])).toEqual({});
  });
});
