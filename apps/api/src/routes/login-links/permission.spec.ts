import { describe, expect, it } from 'vitest';

import { requiredPermissionsForTarget } from './permission';

/**
 * #464：**登入連結就是憑證 —— 拿到就能登入。**
 *
 * 這支端點原本只有 `ADMIN_ONLY` 的角色檢查，沒有任何細部權限：
 * 一個只有 `basic_operations`（負責點名收件）的行政，可以替**任何人**產生登入連結，
 * 包含替一個總管理員產生一條 —— **那是提權**。
 *
 * 計畫席的裁決：**「對象是家長 → `manage_students`；對象是職員 → `manage_staff`」**，
 * 並明講「route 層讀不到 body 的對象，掛單一權限不是太鬆就是太緊」。
 * 所以規則住在這裡，由 handler 在知道對象是誰之後呼叫。
 */
describe('requiredPermissionsForTarget（#464）', () => {
  it('對象是家長 → manage_students', () => {
    expect(requiredPermissionsForTarget(['parent'])).toEqual(['manage_students']);
  });

  it('對象是老師 → manage_staff', () => {
    expect(requiredPermissionsForTarget(['teacher'])).toEqual(['manage_staff']);
  });

  it('對象是管理員 → manage_staff', () => {
    expect(requiredPermissionsForTarget(['admin'])).toEqual(['manage_staff']);
  });

  /**
   * **兩個角色都有的對象要兩個權限都有。**
   *
   * 這不是假設的情況：`seed.sql` 的 `teacher0005` / `teacher0006` 就是
   * 「老師同時也是家長」（教職員的小孩在自家補習班上課）。
   *
   * 失效方向選「太嚴」不選「太鬆」—— **產不出連結的代價是找另一個管理員，
   * 產得出不該產的連結的代價是有人拿到別人的帳號。**
   */
  it('同時是老師與家長 → 兩個權限都要', () => {
    const required = requiredPermissionsForTarget(['teacher', 'parent']);

    expect(required).toContain('manage_staff');
    expect(required).toContain('manage_students');
    expect(required).toHaveLength(2);
  });

  /**
   * **反向對照**：沒有角色的對象不會變成「不需要任何權限」。
   *
   * 空陣列如果回空陣列，`every()` 之類的檢查會**全部通過** ——
   * 那是 fail-open，而這支端點是憑證。
   *
   * （實務上 `decideLoginLinkTarget` 會先用 `NO_ROLES` 擋掉，
   * 但這個函式不能靠呼叫端的順序來保證自己的安全。）
   */
  it('沒有角色時回傳一個不可能滿足的要求，不是空陣列', () => {
    const required = requiredPermissionsForTarget([]);

    expect(required.length).toBeGreaterThan(0);
  });

  it('不認得的角色也不放行', () => {
    const required = requiredPermissionsForTarget(['something-new']);

    expect(required.length).toBeGreaterThan(0);
  });
});
