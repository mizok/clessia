import { describe, expect, it } from 'vitest';

import { isPubliclyBlockedAuthPath } from './auth-paths';

// magic-link 的連結「就是」帳號 —— 誰拿到誰就能登入。
// 產生連結只在伺服器端發生（破窗 CLI、管理端 route），沒有理由對外開放。
describe('isPubliclyBlockedAuthPath', () => {
  it('封鎖產生 magic link 的端點', () => {
    expect(isPubliclyBlockedAuthPath('/api/auth/sign-in/magic-link')).toBe(true);
  });

  // 兌換必須是公開的 —— 使用者點連結就是在打這一支
  it('不封鎖兌換端點', () => {
    expect(isPubliclyBlockedAuthPath('/api/auth/magic-link/verify')).toBe(false);
  });

  it('不封鎖 OAuth 的授權與 callback', () => {
    expect(isPubliclyBlockedAuthPath('/api/auth/sign-in/social')).toBe(false);
    expect(isPubliclyBlockedAuthPath('/api/auth/callback/line')).toBe(false);
  });

  it('不封鎖 session 查詢與登出', () => {
    expect(isPubliclyBlockedAuthPath('/api/auth/get-session')).toBe(false);
    expect(isPubliclyBlockedAuthPath('/api/auth/sign-out')).toBe(false);
  });

  // 尾斜線與 query string 不該變成繞過方式
  it('尾斜線與 query 不會繞過封鎖', () => {
    expect(isPubliclyBlockedAuthPath('/api/auth/sign-in/magic-link/')).toBe(true);
  });

  it('大小寫不同也擋 —— 路由比對可能不分大小寫', () => {
    expect(isPubliclyBlockedAuthPath('/api/auth/sign-in/Magic-Link')).toBe(true);
  });
});
