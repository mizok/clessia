/**
 * Better Auth 會把 plugin 的所有端點都掛上去，包含我們只想在伺服器端用的那些。
 *
 * **magic-link 的連結就是帳號** —— 誰拿到誰就能登入。產生連結只發生在伺服器端
 * （破窗 CLI、管理端產生綁定連結的 route），對外開放沒有任何用途，只會多一個
 * 可以拿來探測帳號存在與否、灌爆 `ba_verification` 的入口。
 *
 * 兌換端點必須保持公開 —— 使用者點連結就是在打它。
 */
const BLOCKED = new Set(['/api/auth/sign-in/magic-link']);

export function isPubliclyBlockedAuthPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '');

  return BLOCKED.has(normalized);
}
