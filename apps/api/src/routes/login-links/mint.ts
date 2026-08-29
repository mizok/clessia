import type { Context } from 'hono';

import { createAuth, type Auth, type AuthBindings, type MagicLinkPayload } from '../../auth';
import { getAuth } from '../../lib/get-auth';
import { loginLinkCallbackUrl } from '../../scripts/login-link.util';
import type { AppEnv } from '../../index';

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
async function signInMagicLink(auth: Auth, webUrl: string, email: string): Promise<void> {
  await auth.api.signInMagicLink({
    body: { email, callbackURL: loginLinkCallbackUrl(webUrl) },
    headers: new Headers(),
  });
}

/**
 * API 用的版本 —— 共用這個請求的 auth 實例與連線池（見
 * `kb/wiki/architecture/auth-pool-lifecycle.md`）。
 *
 * 這裡不能自己 `createAuth(c.env, capture)`：那會在 authMiddleware 已經開了一個池的
 * 請求裡再開第二個。共用實例的代價是 capture 不能綁在實例上，所以改成寫進
 * `magicLinkCapture` 這個每請求的槽，**用完立刻清掉** —— 留著的話同一個請求後續
 * 任何 magic-link 流程都會被這個閉包攔走。
 */
export async function mintLoginLinkForRequest(
  c: Context<AppEnv>,
  email: string,
): Promise<string | null> {
  let url: string | undefined;

  c.set('magicLinkCapture', (payload: MagicLinkPayload) => {
    url = payload.url;
  });

  try {
    await signInMagicLink(getAuth(c), c.env.WEB_URL, email);
  } finally {
    c.set('magicLinkCapture', undefined);
  }

  return url ?? null;
}

/**
 * CLI 用的版本 —— 沒有 Hono context，自己建一個實例。process 跑完就結束，
 * 連線池的生命週期不是問題。
 */
export async function mintLoginLink(env: AuthBindings, email: string): Promise<string | null> {
  let url: string | undefined;

  const auth = createAuth(env, (payload: MagicLinkPayload) => {
    url = payload.url;
  });

  await signInMagicLink(auth, env.WEB_URL, email);

  return url ?? null;
}
