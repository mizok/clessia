import { describe, expect, it } from 'vitest';

import { resolveRecordedByRole } from './recorded-by-role';

describe('resolveRecordedByRole', () => {
  it('記老師就是老師 —— 原本這裡一律寫死 admin', () => {
    expect(resolveRecordedByRole(['teacher'])).toBe('teacher');
  });

  it('管理員優先於老師，跟 resolveTeachingScope 同一個優先序', () => {
    expect(resolveRecordedByRole(['teacher', 'admin'])).toBe('admin');
  });

  it('只有管理員', () => {
    expect(resolveRecordedByRole(['admin'])).toBe('admin');
  });

  it('兩者都不是就壞掉，不要記一個假的角色', () => {
    // 出勤路由掛在 ['admin','teacher'] 底下，走到這裡代表 middleware 跟這裡對不上
    expect(() => resolveRecordedByRole(['parent'])).toThrow('無法判斷');
    expect(() => resolveRecordedByRole([])).toThrow('無法判斷');
  });
});
