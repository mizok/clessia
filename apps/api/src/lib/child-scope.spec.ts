import { describe, expect, it } from 'vitest';

import { isChildAllowed, resolveStudentScope } from './child-scope';

describe('resolveStudentScope', () => {
  it('不是家長身分回 null（不受限，跟 campusScope 對管理員的約定一致）', () => {
    expect(resolveStudentScope({ roles: ['admin'], relatedStudentIds: ['s1'] })).toBeNull();
    expect(resolveStudentScope({ roles: ['teacher'], relatedStudentIds: [] })).toBeNull();
  });

  // 這條是設計文件點名「最容易寫錯的地方」：[] 不能被當成 null 處理，
  // 不然沒綁小孩的家長會看到全部。
  it('是家長但沒有任何 parent_student_relations 回空陣列，不是 null', () => {
    const scope = resolveStudentScope({ roles: ['parent'], relatedStudentIds: [] });
    expect(scope).toEqual([]);
    expect(scope).not.toBeNull();
  });

  it('是家長時回關聯到的 student id 清單', () => {
    expect(resolveStudentScope({ roles: ['parent'], relatedStudentIds: ['s1', 's2'] })).toEqual([
      's1',
      's2',
    ]);
  });

  it('同時是老師又是家長時仍受學生範圍限制（家長維度不因兼職而放寬）', () => {
    expect(
      resolveStudentScope({ roles: ['teacher', 'parent'], relatedStudentIds: ['s1'] }),
    ).toEqual(['s1']);
  });
});

describe('isChildAllowed', () => {
  it('childId 在 scope 裡放行', () => {
    expect(isChildAllowed(['s1', 's2'], 's1')).toBe(true);
  });

  it('childId 不在 scope 裡拒絕（越權指名）', () => {
    expect(isChildAllowed(['s1'], 's9')).toBe(false);
  });

  it('沒綁任何孩子時（空陣列）一律拒絕', () => {
    expect(isChildAllowed([], 's1')).toBe(false);
  });

  // 跟 isCampusAllowed 刻意不同：那裡 scope===null 代表「不受限」放行，
  // 這裡 scope===null 代表「根本不是家長」，對這三支端點是異常狀態，fail-closed
  it('scope 是 null 時一律拒絕，不是當成不受限放行', () => {
    expect(isChildAllowed(null, 's1')).toBe(false);
  });
});
