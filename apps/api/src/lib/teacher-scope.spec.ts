import { describe, it, expect } from 'vitest';
import { resolveTeachingScope } from './teacher-scope';

/**
 * 聯絡簿與教務日誌共用這條規則：管理員不受限，老師只能碰自己固定任課的班。
 *
 * 跟 `routes/students/teacher-scope.ts`、`routes/attendance/teacher-scope.ts` 同一個模式 ——
 * **範圍限制放在伺服器，而且不看請求怎麼說**。前端隱藏不構成授權（c1）。
 */
describe('resolveTeachingScope', () => {
  it('管理員不受限', () => {
    expect(resolveTeachingScope({ roles: ['admin'], ownStaffId: null })).toEqual({
      teacherStaffId: null,
    });
  });

  it('管理員即使同時是老師也不受限 —— 權限取聯集', () => {
    expect(resolveTeachingScope({ roles: ['teacher', 'admin'], ownStaffId: 'staff-1' })).toEqual({
      teacherStaffId: null,
    });
  });

  it('老師縮限到自己的 staff id', () => {
    expect(resolveTeachingScope({ roles: ['teacher'], ownStaffId: 'staff-1' })).toEqual({
      teacherStaffId: 'staff-1',
    });
  });

  /** 沒有 staff 列就無法安全地縮限，放行等於把全校的紀錄交出去 */
  it('老師但查不到 staff 列 → 拒絕，不是放行', () => {
    expect(resolveTeachingScope({ roles: ['teacher'], ownStaffId: null })).toEqual({
      forbidden: true,
    });
  });

  it('家長碰不到這兩個資源', () => {
    expect(resolveTeachingScope({ roles: ['parent'], ownStaffId: null })).toEqual({
      forbidden: true,
    });
  });

  it('沒有角色 → 拒絕', () => {
    expect(resolveTeachingScope({ roles: [], ownStaffId: null })).toEqual({ forbidden: true });
  });
});
