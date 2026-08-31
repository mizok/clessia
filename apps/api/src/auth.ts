import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { admin as adminPlugin, magicLink } from 'better-auth/plugins';
import type { Bindings } from './index';
import { allowedOrigins, resolveTrustedOrigins } from './lib/origins';
import { resolveDatabaseUrl } from './lib/database-url';

export type AuthBindings = Pick<
  Bindings,
  | 'DATABASE_URL'
  | 'HYPERDRIVE'
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_URL'
  | 'WEB_URL'
  | 'ALLOWED_ORIGINS'
  | 'LINE_CLIENT_ID'
  | 'LINE_CLIENT_SECRET'
>;

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
/**
 * LINE 的 profile → Better Auth 的 user 欄位。
 *
 * **LINE 預設不回傳 email。** 我們有要求 `email` scope，但那需要另外向 LINE 送審
 * 「Email address permission」才會真的給。而 better-auth 的 OAuth callback 在
 * `if (!userInfo.email)` 就直接 `redirectOnError("email_not_found")` —— 跟
 * `ba_user.email` 欄位能不能為 NULL 無關。正式站實測到，登入從來沒成功過。
 *
 * 所以合成一個佔位 email。這跟專案既有的做法一致：只有手機的家長用
 * `0912345678@phone.internal`，那個 domain 不存在於公開網路，我們也從不寄信。
 *
 * **合成的 email 不影響比對** —— `findOAuthUser(email, accountId, providerId)` 是
 * 「email 或 (accountId, providerId)」，綁定過的人靠 account 就找得到。
 */
export function lineProfileToUser(profile: { sub?: string; userId?: string; email?: string }): {
  email: string;
  emailVerified: boolean;
} {
  if (profile.email) {
    // 真的 LINE email：我們無從得知 LINE 有沒有驗證過它，所以不宣稱已驗證。
    // 代價是這種帳號的綁定會被擋 —— 但目前 LINE 根本不給 email，走不到這條。
    return { email: profile.email, emailVerified: false };
  }

  const lineUserId = profile.sub ?? profile.userId;
  if (!lineUserId) {
    // 合成出 `undefined@line.internal` 的話兩個不同的人會撞到同一個帳號，
    // 而 ba_user.email 是 UNIQUE —— 症狀會是「第二個人登入變成第一個人」
    throw new Error('LINE profile 沒有 id（sub / userId），無法合成識別用的 email');
  }

  // **標成已驗證是必要的，也是誠實的。**
  //
  // 必要：better-auth 擋綁定的條件是 `!信任的provider && !emailVerified`
  // （`oauth2/link-account.mjs`）。LINE provider 寫死 `emailVerified: false`，
  // 而 `line` 不在 trustedProviders 裡 —— 兩個都成立就擋，link-social 回
  // `unable_to_link_account`。正式站實測踩到。
  //
  // 誠實：這個 email 是從**OAuth 驗證過的** LINE user id 推導出來的，所有權由這條
  // 流程本身證明。這比把整個 LINE 加進 trustedProviders 安全 —— 那等於信任它給的
  // 任何 email，而 email 可以拿來對上既有帳號。
  return { email: `${lineUserId}@line.internal`, emailVerified: true };
}

export function socialProvidersFromEnv(env: {
  LINE_CLIENT_ID?: string;
  LINE_CLIENT_SECRET?: string;
}): Record<string, Record<string, unknown>> {
  const providers: Record<string, Record<string, unknown>> = {};

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
      // LINE 不給 email，而 better-auth 的 callback 硬性要求它
      mapProfileToUser: lineProfileToUser,
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
  captureMagicLink?: (payload: MagicLinkPayload) => void,
) {
  const pool = new Pool({ connectionString: resolveDatabaseUrl(env) });

  const auth = betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: (request) =>
      resolveTrustedOrigins({
        requestOrigin: request?.headers.get('origin'),
        allowed: allowedOrigins(env),
      }),
    // **關掉密碼登入**。scrypt 超過 Workers 的 10ms CPU 上限，登入間歇性 503，
    // 而且任何安全的密碼雜湊都會超過 —— 快到能塞進 10ms 的雜湊等於沒有保護。
    // 見 kb/wiki/architecture/line-oauth-login.md
    emailAndPassword: {
      enabled: false,
    },
    socialProviders: socialProvidersFromEnv(env),
    // username plugin 拿掉：它提供的 /sign-in/username 也是密碼登入
    plugins: [adminPlugin(), magicLink(magicLinkOptions(captureMagicLink))],
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
      accountLinking: {
        // 綁定時 better-auth 比對「OAuth 回來的 email」與「目前 session 的 email」。
        // 合成的 `<LINE sub>@line.internal` 永遠不等於使用者真正的 email，不放行的話
        // link-social 一律回 `email_doesn't_match`。
        //
        // 型別註解警告這可能導致帳號被奪取。**在這個設定下不適用**：
        // - 它只影響**明確綁定**（account.mjs:149 / callback.mjs:107），那條路要求
        //   呼叫者已經登入；真正危險的自動綁定在 link-account.mjs，那裡不看這個選項
        // - 合成的 email 有 `@line.internal` 命名空間，**不可能撞到真人的 email**
        // - `disableSignUp: true` 讓登入不會建新帳號、也不會自動接上
        //
        // ⚠️ 哪天拿掉 email 的合成（例如 LINE 給了 email 權限、改用真的），
        // 上面第二點就不成立，這個選項要跟著重新評估。
        allowDifferentEmails: true,
      },
    },
    verification: {
      modelName: 'ba_verification',
    },
  });

  // 把 pool 掛在回傳物件上，讓 `lib/get-auth.ts` 的收尾拿得到它。對外介面不變 ——
  // 既有呼叫端（含 CLI script）照舊只用 `auth.api` / `auth.handler`。
  return Object.assign(auth, { pool });
}

export type Auth = ReturnType<typeof createAuth>;
