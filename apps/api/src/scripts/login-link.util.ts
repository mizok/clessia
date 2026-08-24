/**
 * magic-link 兌換完成後要導去的位置。
 *
 * **一定要是前端**。導到 API 自己的網域的話，使用者兌換完會看到一坨 JSON 而不是
 * 登入後的畫面 —— 而且那個狀態下 session 其實已經建立了，症狀會很難懂。
 */
export function loginLinkCallbackUrl(webUrl: string): string {
  const trimmed = webUrl.trim();

  if (!trimmed) {
    throw new Error('WEB_URL 未設定 —— 沒有它就不知道兌換後要把人導去哪');
  }

  let origin: string;
  try {
    origin = new URL(trimmed).origin;
  } catch {
    throw new Error(`WEB_URL 不是合法網址：${trimmed}`);
  }

  return `${origin}/select-role`;
}
