import { describe, expect, it } from 'vitest';

import { loginLinkCallbackUrl } from './login-link.util';

// 兌換連結之後要落在前端，不是 API。落錯地方的話使用者會看到一坨 JSON。
describe('loginLinkCallbackUrl', () => {
  it('導到前端的角色選擇頁', () => {
    expect(loginLinkCallbackUrl('https://app.example.com')).toBe(
      'https://app.example.com/select-role'
    );
  });

  it('尾斜線不會變成雙斜線', () => {
    expect(loginLinkCallbackUrl('https://app.example.com/')).toBe(
      'https://app.example.com/select-role'
    );
  });

  it('本機開發也要能用', () => {
    expect(loginLinkCallbackUrl('http://localhost:4200')).toBe(
      'http://localhost:4200/select-role'
    );
  });

  // WEB_URL 沒設時導到 API 自己的網域，使用者會看到 JSON 而不是登入畫面 —— 寧可早點爆
  it('WEB_URL 空的時候丟錯，不要默默產生壞連結', () => {
    expect(() => loginLinkCallbackUrl('')).toThrow(/WEB_URL/);
    expect(() => loginLinkCallbackUrl('   ')).toThrow(/WEB_URL/);
  });

  it('不是合法網址就丟錯', () => {
    expect(() => loginLinkCallbackUrl('not-a-url')).toThrow(/WEB_URL/);
  });
});
