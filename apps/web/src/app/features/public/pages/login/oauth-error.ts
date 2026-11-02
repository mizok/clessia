import { PROVIDER_NAMES, isProviderId } from '@core/auth-providers.service';

export interface OauthError {
  readonly message: string;
  /**
   * 未登記的人需要的是**怎麼被登記**，不是「再試一次」。
   *
   * #694 之前這裡是一條連到 `/enrollment` 的連結 —— **而那一頁是純佔位殼**，
   * 於是被擋在門外的人唯一的出路是一扇畫在牆上的門。
   * 使用者裁定改成一句「請聯絡補習班登記」，欄位跟著改名。
   */
  readonly showRegisterHint: boolean;
}

/**
 * 把 Better Auth 導回來時網址上的 `?error=` 翻成使用者看得懂的話。
 *
 * OAuth 的失敗不是函式回傳值 —— 使用者會被導去 LINE、再被導回來，錯誤寫在網址上。
 */
export function oauthErrorFor(
  code: string | null | undefined,
  provider?: string | null,
): OauthError | null {
  if (!code) {
    return null;
  }
  // 回跳網址帶 `?provider=`（#1842）；舊網址沒帶就是 LINE
  const name = PROVIDER_NAMES[isProviderId(provider) ? provider : 'line'];

  switch (code) {
    // disableSignUp 擋下來的：這個帳號不在系統裡。看到招生宣傳連過來的人會撞到。
    // **他不是「稍後再試」就會成功**，他根本還不是客戶 —— 訊息要指向報名，不是重試。
    case 'signup_disabled':
      return {
        message: `這個 ${name} 帳號還沒有被登記。如果你已經報名，請向補習班索取專屬連結。`,
        showRegisterHint: true,
      };

    // 使用者在授權畫面按了取消。不是錯誤，語氣不要嚇人。
    case 'access_denied':
      return { message: `已取消 ${name} 登入。`, showRegisterHint: false };

    // 綁定時：這個帳號已經綁在別人身上（better-auth 的 link-social callback）。重試不會好
    case 'account_already_linked_to_different_user':
      return {
        message: `這個 ${name} 帳號已經綁定在別的帳號上了。請改用另一個 ${name} 帳號，或聯絡補習班。`,
        showRegisterHint: false,
      };

    default:
      return { message: `${name} 登入沒有完成，請稍後再試。`, showRegisterHint: false };
  }
}
