/**
 * 推播服務的網域白名單（#1659，擋 SSRF）。#1661 的 Worker 會對 endpoint 發 POST —— 不限制的話，
 * 任何登入的人都能讓我們的 Worker 去打任意網址。**訂閱時檢查一次，發送前再檢查一次**
 * （不信 DB 裡存的值）。只收 https；主機逐字比對，只有 WNS 用後綴（它的主機帶區域前綴）。
 * 新瀏覽器的推播服務不在這裡，就加一行。
 */
const EXACT_HOSTS = new Set([
  'fcm.googleapis.com', // Chrome、新版 Edge、Samsung Internet、Opera
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com', // Safari（macOS 13+、iOS 16.4+ 加入主畫面）
]);
const HOST_SUFFIXES = ['.notify.windows.com']; // 舊版 Edge（WNS），例：db5p.notify.windows.com

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname;
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((s) => host.endsWith(s));
}
