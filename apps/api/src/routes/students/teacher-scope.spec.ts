import { describe, expect, it } from 'vitest';

import { resolveStudentScope } from './teacher-scope';

const OWN = 'staff-me';

describe('resolveStudentScope', () => {
  it('管理員看全部，不受 taughtByMe 影響', () => {
    expect(resolveStudentScope({ roles: ['admin'], taughtByMe: true, ownStaffId: null })).toEqual({
      teacherStaffId: null,
    });
  });

  // 只擋 UI 不擋 API 等於沒擋：老師沒帶參數也要被縮限
  it('老師一律縮限到自己任課的班，不管有沒有帶參數', () => {
    expect(resolveStudentScope({ roles: ['teacher'], taughtByMe: false, ownStaffId: OWN })).toEqual(
      { teacherStaffId: OWN },
    );
  });

  it('老師沒有對應的 staff 列時拒絕，而不是放行', () => {
    expect(resolveStudentScope({ roles: ['teacher'], taughtByMe: true, ownStaffId: null })).toEqual({
      forbidden: true,
    });
  });

  it('同時是管理員與老師時以管理員為準', () => {
    expect(
      resolveStudentScope({ roles: ['admin', 'teacher'], taughtByMe: false, ownStaffId: OWN }),
    ).toEqual({ teacherStaffId: null });
  });

  it('既不是管理員也不是老師一律拒絕', () => {
    expect(resolveStudentScope({ roles: ['parent'], taughtByMe: false, ownStaffId: null })).toEqual({
      forbidden: true,
    });
  });
});
