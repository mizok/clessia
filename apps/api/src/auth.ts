import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { admin as adminPlugin, username } from 'better-auth/plugins';
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
}): Record<string, { clientId: string; clientSecret: string }> {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};

  if (env.LINE_CLIENT_ID && env.LINE_CLIENT_SECRET) {
    providers['line'] = {
      clientId: env.LINE_CLIENT_ID,
      clientSecret: env.LINE_CLIENT_SECRET,
    };
  }

  return providers;
}

export function createAuth(env: AuthBindings) {
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
    plugins: [username(), adminPlugin()],
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
