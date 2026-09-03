import { describe, expect, it } from 'vitest';

// **靜態 import，不要在 test body 裡動態 import。**
// 原本兩個測試各寫 `await import('./parents')`，於是**模組轉譯的時間被算進
// 5 秒的 test timeout**。這支路由檔很大，轉譯本身就要好幾秒 —— 本機連跑三次
// 分別是 2.5s 過、3.0s 過、5.0s **失敗**。
// 隨機紅在跟改動無關的地方，比慢更貴：它會讓所有人開始不信任 CI。
import { toParentResponse } from './parents';

describe('toParentResponse', () => {
  it('maps snake_case DB row to camelCase, email 優先作為 loginAccount', () => {
    const row = {
      id: 'parent-uuid',
      user_id: 'ba-user-id',
      org_id: 'org-uuid',
      name: '林志明',
      phone: '0912345678',
      email: 'lin@example.com',
      status: 'active',
      notes: null,
      created_at: '2026-03-17T00:00:00Z',
      updated_at: '2026-03-17T00:00:00Z',
    };

    const result = toParentResponse(row, 2);
    expect(result).toMatchObject({
      id: 'parent-uuid',
      userId: 'ba-user-id',
      orgId: 'org-uuid',
      name: '林志明',
      phone: '0912345678',
      email: 'lin@example.com',
      loginAccount: 'lin@example.com',
      status: 'active',
      studentCount: 2,
    });
  });

  it('無 email 時 loginAccount 使用 phone', () => {
    const row = {
      id: 'parent-uuid',
      user_id: 'ba-user-id',
      org_id: 'org-uuid',
      name: '陳淑芬',
      phone: '0987654321',
      email: null,
      status: 'inactive',
      notes: null,
      created_at: '2026-03-17T00:00:00Z',
      updated_at: '2026-03-17T00:00:00Z',
    };

    const result = toParentResponse(row, 0);
    expect(result.loginAccount).toBe('0987654321');
  });
});
