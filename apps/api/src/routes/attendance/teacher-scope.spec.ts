import { describe, expect, it } from 'vitest';

import { resolveTeacherScope } from './teacher-scope';

const OWN = 'staff-me';
const OTHER = 'staff-someone-else';

describe('resolveTeacherScope', () => {
  it('管理員不受限，沒指定就是全部', () => {
    expect(resolveTeacherScope({ roles: ['admin'], requested: undefined, ownStaffId: null })).toEqual(
      { teacherId: undefined },
    );
  });

  it('管理員可以指定看某位老師', () => {
    expect(
      resolveTeacherScope({ roles: ['admin'], requested: OTHER, ownStaffId: null }),
    ).toEqual({ teacherId: OTHER });
  });

  // 這是整個修正的重點：老師打開課表看到的必須是自己的課
  it('老師強制套用自己的 id', () => {
    expect(
      resolveTeacherScope({ roles: ['teacher'], requested: undefined, ownStaffId: OWN }),
    ).toEqual({ teacherId: OWN });
  });

  // 只擋 UI 不擋 API 等於沒擋 —— 直接打 API 指定別人也要被蓋掉
  it('老師指定別人也會被蓋成自己', () => {
    expect(resolveTeacherScope({ roles: ['teacher'], requested: OTHER, ownStaffId: OWN })).toEqual({
      teacherId: OWN,
    });
  });

  // 沒有 staff 列就無法安全地縮限範圍，這時放行等於全開
  it('老師沒有對應的 staff 列時拒絕，而不是放行', () => {
    expect(resolveTeacherScope({ roles: ['teacher'], requested: undefined, ownStaffId: null })).toEqual(
      { forbidden: true },
    );
  });

  it('同時是管理員與老師時以管理員為準', () => {
    expect(
      resolveTeacherScope({ roles: ['teacher', 'admin'], requested: OTHER, ownStaffId: OWN }),
    ).toEqual({ teacherId: OTHER });
  });

  it('既不是管理員也不是老師一律拒絕', () => {
    expect(resolveTeacherScope({ roles: ['parent'], requested: undefined, ownStaffId: null })).toEqual(
      { forbidden: true },
    );
  });
});
