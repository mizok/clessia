/**
 * 產生一次性登入連結。**這是這個系統唯一的破窗管道。**
 *
 *   LOGIN_EMAIL=owner@example.com npx tsx apps/api/src/scripts/login-link.ts
 *
 * 環境變數同 apps/api 的執行期設定（DATABASE_URL / BETTER_AUTH_SECRET /
 * BETTER_AUTH_URL / WEB_URL）。
 *
 * **為什麼是 CLI 而不是永久的 root 帳號**（見 kb/wiki/architecture/line-oauth-login.md）：
 * 能拿到 DATABASE_URL 的人本來就掌握全部資料，用它換一個 session 不新增任何能力；
 * 而一組永久密碼會新增一個可被猜測、外洩、重複使用的秘密。更重要的是**客戶換掉
 * DATABASE_URL 就能切斷供應商的存取** —— 拿不掉的後門與憲法 c12 直接衝突。
 *
 * **為什麼不是 API endpoint**：一支「給我管理員 session」的端點，就算加了檢查也是攻擊面。
 *
 * 連結一次有效、24 小時過期（`magicLinkOptions`）。用完就沒了，需要就再跑一次。
 */
import { Pool } from 'pg';
import { createAuth, type MagicLinkPayload } from '../auth';
import { loginLinkCallbackUrl } from './login-link.util';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✖ 缺少環境變數 ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const email = required('LOGIN_EMAIL');
  const env = {
    DATABASE_URL: required('DATABASE_URL'),
    BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET'),
    BETTER_AUTH_URL: required('BETTER_AUTH_URL'),
    WEB_URL: required('WEB_URL'),
    ALLOWED_ORIGINS: process.env['ALLOWED_ORIGINS'] ?? '',
    LINE_CLIENT_ID: '',
    LINE_CLIENT_SECRET: '',
  };

  // WEB_URL 壞掉的話早點爆，不要產生一條會把人導到 JSON 的連結
  const callbackURL = loginLinkCallbackUrl(env.WEB_URL);

  const pool = new Pool({ connectionString: env.DATABASE_URL });

  try {
    // 先確認這個人存在並印出他的角色 —— 免得產生一條連到錯的人或空帳號的連結
    const { rows } = await pool.query(
      // role 是 public.user_role enum —— **一定要 ::text**。node-postgres 沒有自訂 enum
      // 陣列的解析器，不轉的話拿到的是字串 "{admin}" 而不是陣列，.join() 就會炸。
      `select u.id, u.name,
              coalesce(array_agg(r.role::text) filter (where r.role is not null), '{}')::text[] as roles
         from public.ba_user u
         left join public.user_roles r on r.user_id = u.id
        where u.email = $1
        group by u.id, u.name`,
      [email]
    );

    if (rows.length === 0) {
      console.error(`✖ 找不到 email 是 ${email} 的使用者，未產生任何連結。`);
      const { rows: candidates } = await pool.query(
        `select u.email from public.ba_user u
           join public.user_roles r on r.user_id = u.id
          where r.role = 'admin' order by u.email limit 10`
      );
      if (candidates.length > 0) {
        console.error('\n這個站上有 admin 角色的帳號：');
        for (const c of candidates) console.error(`  ${c.email}`);
      }
      process.exit(1);
    }

    const user = rows[0];
    if (user.roles.length === 0) {
      console.error(`✖ ${email} 沒有任何角色，登進去也看不到東西。未產生連結。`);
      process.exit(1);
    }

    let link: string | undefined;
    const auth = createAuth(env, (payload: MagicLinkPayload) => {
      link = payload.url;
    });

    await auth.api.signInMagicLink({
      body: { email, callbackURL },
      headers: new Headers(),
    });

    if (!link) {
      console.error('✖ Better Auth 沒有交出連結 —— magic-link plugin 可能沒掛上。');
      process.exit(1);
    }

    console.log(`\n✓ ${user.name} <${email}>　角色：${user.roles.join(', ')}`);
    console.log('\n' + '─'.repeat(60));
    console.log(link);
    console.log('─'.repeat(60));
    console.log('\n一次有效、24 小時過期。用完就失效，需要再跑一次這支指令。');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('✖ 產生登入連結失敗：', err instanceof Error ? err.message : err);
  process.exit(1);
});
