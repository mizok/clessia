import { describe, expect, it } from 'vitest';

import {
  formatAuditClassResourceName,
  formatAuditCourseResourceName,
  logAudit,
  logAuditMany,
} from './audit';

describe('formatAuditCourseResourceName', () => {
  it('joins course and campus names for course management logs', () => {
    expect(
      formatAuditCourseResourceName({
        courseName: '社會課',
        campusName: '示範分校',
      }),
    ).toBe('社會課 / 示範分校');
  });

  it('falls back to the available course name when campus is missing', () => {
    expect(
      formatAuditCourseResourceName({
        courseName: '社會課',
        campusName: null,
      }),
    ).toBe('社會課');
  });
});

describe('formatAuditClassResourceName', () => {
  it('joins class, course, and campus names for class management logs', () => {
    expect(
      formatAuditClassResourceName({
        className: '班級 A',
        courseName: '社會課',
        campusName: '示範分校',
      }),
    ).toBe('班級 A / 社會課 / 示範分校');
  });

  it('falls back to the available names in order', () => {
    expect(
      formatAuditClassResourceName({
        className: '班級 A',
        courseName: null,
        campusName: null,
      }),
    ).toBe('班級 A');
  });
});

/**
 * #1839 二讀：稽核的 `user_name` 是所有路由共用的「誰操作的」。原本讀 profiles（沒有人寫了，新人一律 null），
 * 改成 loadDisplayName —— 要拿到**這個 org** 的員工姓名，別 org 的同一個帳號不能露出來。
 */
describe('logAudit／logAuditMany 的 user_name（#1839）', () => {
  function fakeSupabase() {
    const inserted: unknown[] = [];
    const supabase = {
      from(table: string) {
        if (table === 'ba_user') {
          const chain = {
            select: () => chain,
            eq: () => chain,
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  name: '帳號名',
                  staff: [
                    { display_name: '別校的名字', org_id: 'org-2' },
                    { display_name: '王主任', org_id: 'org-1' },
                  ],
                  parents: [],
                },
                error: null,
              }),
          };
          return chain;
        }
        if (table === 'audit_logs') {
          return {
            insert: (rows: unknown) => {
              inserted.push(rows);
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    return { supabase, inserted };
  }

  it('logAudit：user_name 是本 org 的員工姓名', async () => {
    const { supabase, inserted } = fakeSupabase();
    const pending: Promise<unknown>[] = [];
    logAudit(
      supabase as never,
      { orgId: 'org-1', userId: 'u1', resourceType: 'class', resourceId: 'c1', action: 'update' },
      (p) => pending.push(p),
    );
    await Promise.all(pending);
    expect(inserted).toEqual([expect.objectContaining({ user_id: 'u1', user_name: '王主任' })]);
  });

  it('logAuditMany：每一筆的 user_name 都是本 org 的員工姓名（只查一次）', async () => {
    const { supabase, inserted } = fakeSupabase();
    const pending: Promise<unknown>[] = [];
    logAuditMany(
      supabase as never,
      { orgId: 'org-1', userId: 'u1', resourceType: 'class', action: 'update' },
      [{ resourceId: 'c1' }, { resourceId: 'c2' }],
      (p) => pending.push(p),
    );
    await Promise.all(pending);
    expect(inserted).toEqual([
      [
        expect.objectContaining({ resource_id: 'c1', user_name: '王主任' }),
        expect.objectContaining({ resource_id: 'c2', user_name: '王主任' }),
      ],
    ]);
  });
});
