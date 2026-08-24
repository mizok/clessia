import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { admin as adminPlugin, magicLink, username } from 'better-auth/plugins';
import type { Bindings } from './index';
import { allowedOrigins, resolveTrustedOrigins } from './lib/origins';

type AuthBindings = Pick<
  Bindings,
  | 'DATABASE_URL'
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_URL'
  | 'WEB_URL'
  | 'ALLOWED_ORIGINS'
  | 'LINE_CLIENT_ID'
  | 'LINE_CLIENT_SECRET'
>;

/**
 * 跨站 session cookie 的屬性。
 *
 * 前端與 API 在不同的 eTLD+1 時（`clessia.pages.dev` vs `*.workers.dev` —— 兩者都在
 * Public Suffix List 上，是不同 site），瀏覽器**不會**把預設 `SameSite=Lax` 的 cookie
 * 帶到跨站請求上。症狀是登入本身成功（`POST /api/login` 回 200），但緊接著的
 * `/api/me` 一律 401，前端因此以為使用者沒有角色。第一次上線時就是這樣。
 *
 * `SameSite=None; Secure; Partitioned` 讓 Chrome / Edge / Firefox 與 **Safari 18.4 以上**
 * 接受它（`Partitioned` 是 CHIPS，Safari 18.4 才支援）。
 *
 * ⚠️ **這是權宜之計，不是根治。** iOS 18.3 以下的 Safari 完全封鎖第三方 cookie，
 * 這個設定救不了它們 —— 而且失敗症狀是看不見的（使用者只會看到「尚未被指派角色」）。
 * 根治是把前端與 API 放到同一個 eTLD+1 底下（`app.example.com` / `api.example.com`）：
 * 那時兩邊同站，預設的 Lax 就會被帶出去，這整段可以直接刪掉。
 * 見 `kb/wiki/architecture/deploying.md`。
 */
export function crossSiteCookieAttributes(baseUrl: string) {
  // http 只出現在本機開發，而 localhost:4200 → localhost:8787 是同站，Lax 就夠用。
  // 且瀏覽器會丟掉 http 上的 Secure cookie —— 無條件套用會把本機開發弄壞。
  if (!baseUrl.startsWith('https://')) {
    return undefined;
  }

  return { sameSite: 'none', secure: true, partitioned: true } as const;
}

/**
 * 從環境變數組出 social provider 設定。
 *
 * **刻意是一張 map，不是寫死的單一 provider。** Google 是延後不是排除
 * （見 `kb/wiki/architecture/line-oauth-login.md` 決策二）—— 加它就是多一個 if，
 * 不用回頭改形狀。
 *
 * 兩個變數缺一就整個不設定：半套的 OAuth 設定會在使用者按下按鈕之後才爆，
 * 比完全沒有更難查。
 */
export function socialProvidersFromEnv(env: {
  LINE_CLIENT_ID?: string;
  LINE_CLIENT_SECRET?: string;
}): Record<string, { clientId: string; clientSecret: string; disableSignUp: boolean }> {
  const providers: Record<
    string,
    { clientId: string; clientSecret: string; disableSignUp: boolean }
  > = {};

  if (env.LINE_CLIENT_ID && env.LINE_CLIENT_SECRET) {
    providers['line'] = {
      clientId: env.LINE_CLIENT_ID,
      clientSecret: env.LINE_CLIENT_SECRET,
      // Better Auth 預設 false —— 任何路人按下「使用 LINE 登入」就會被建一個
      // 沒有角色、沒有 orgId 的孤兒帳號。看到招生宣傳來的家長會製造一堆這種帳號。
      //
      // **帳號一律由校方建立**（臨櫃註冊、Excel 匯入），OAuth 只負責「認人」。
      // 所以流程一定是：拿到一次性連結 → 登入 → 綁定 LINE → 之後才用 LINE 登入。
      disableSignUp: true,
    };
  }

  return providers;
}


/** `sendMagicLink` 拿到的東西。我們不寄信，直接把 `url` 攔下來。 */
export interface MagicLinkPayload {
  email: string;
  url: string;
  token: string;
}

/**
 * magic-link 的設定。**綁定連結、破窗 CLI、重發連結三個用途共用這一套**
 * （見 `kb/wiki/architecture/line-oauth-login.md`）。
 *
 * 一般用法是在 `sendMagicLink` 裡把 url 寄出去。**這個專案不寄信** —— 沒有任何寄信管道，
 * 而且家長的 email 可能是佔位值（`0912345678@phone.internal`，那個 domain 不存在於公開網路）。
 * 所以改成把 url 交給呼叫端：管理端變成畫面上的 QR、CLI 變成 stdout。
 */
export function magicLinkOptions(capture?: (payload: MagicLinkPayload) => void) {
  return {
    // 連結被拿去建新帳號 = 任何人都能自助註冊成使用者。只能用在既有帳號上。
    disableSignUp: true,
    // 櫃檯當場掃是主流程，但一定會有人說「我回家再用」。可重發，所以不必更長。
    expiresIn: 60 * 60 * 24,
    sendMagicLink: async (payload: MagicLinkPayload) => {
      capture?.(payload);
    },
  };
}

export function createAuth(
  env: AuthBindings,
  captureMagicLink?: (payload: MagicLinkPayload) => void
) {
  const pool = new Pool({ connectionString: env.DATABASE_URL });

  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: (request) =>
      resolveTrustedOrigins({
        requestOrigin: request?.headers.get('origin'),
        allowed: allowedOrigins(env),
      }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    advanced: {
      defaultCookieAttributes: crossSiteCookieAttributes(env.BETTER_AUTH_URL),
    },
    socialProviders: socialProvidersFromEnv(env),
    plugins: [username(), adminPlugin(), magicLink(magicLinkOptions(captureMagicLink))],
    user: {
      modelName: 'ba_user',
      additionalFields: {
        phone: {
          type: 'string',
          required: false,
          input: true,
        },
        orgId: {
          type: 'string',
          required: false,
          input: false,
        },
      },
    },
    session: {
      modelName: 'ba_session',
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    account: {
      modelName: 'ba_account',
    },
    verification: {
      modelName: 'ba_verification',
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
