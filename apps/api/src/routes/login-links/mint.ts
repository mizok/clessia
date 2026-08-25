import { createAuth, type AuthBindings, type MagicLinkPayload } from '../../auth';
import { loginLinkCallbackUrl } from '../../scripts/login-link.util';

/**
 * 產生一條一次性登入連結。三個呼叫端共用：建立員工、建立家長、以及
 * `POST /api/login-links`（重發）。
 *
 * **不寄信** —— `sendMagicLink` 把 url 交回來，由呼叫端決定怎麼送達（畫面上的 QR、
 * 可複製的文字）。見 `kb/wiki/architecture/line-oauth-login.md`。
 *
 * 回傳 null 表示 Better Auth 沒有交出連結 —— 實務上只會發生在 magic-link plugin
 * 沒掛上的時候。
 */
export async function mintLoginLink(env: AuthBindings, email: string): Promise<string | null> {
  let url: string | undefined;

  const auth = createAuth(env, (payload: MagicLinkPayload) => {
    url = payload.url;
  });

  await auth.api.signInMagicLink({
    body: { email, callbackURL: loginLinkCallbackUrl(env.WEB_URL) },
    headers: new Headers(),
  });

  return url ?? null;
}
