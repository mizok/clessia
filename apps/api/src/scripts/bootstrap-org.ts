/**
 * 開一個乾淨的站：建立組織 + 第一個管理員。零 demo 資料。
 *
 *   ORG_NAME="向上補習班" ORG_SLUG=xiangshang \
 *   ADMIN_EMAIL=owner@example.com ADMIN_NAME="王主任" \
 *   npx tsx apps/api/src/scripts/bootstrap-org.ts
 *
 * 環境變數同 apps/api 的執行期設定（DATABASE_URL / BETTER_AUTH_SECRET / …）。
 *
 * **為什麼不是 SQL**：`ba_*` 由 Better Auth 獨佔寫入（憲法 c2），密碼雜湊格式是它的內部
 * 細節。走 `admin.createUser()` 才不會在它換演算法時默默壞掉。
 *
 * **為什麼不是 API endpoint**：一支「建立組織並給我管理員權限」的公開端點，
 * 就算加了一次性檢查也是攻擊面。開站是部署行為，不是執行期功能。
 *
 * 冪等：組織 slug 已存在就中止，不覆寫任何東西。
 */
import { Pool } from 'pg';
import { createAuth } from '../auth';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✖ 缺少環境變數 ${name}`);
    process.exit(1);
  }
  return v;
}

/** slug 會出現在網址與匯出檔名，限制字元避免之後處理跳脫 */
function validateSlug(slug: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
    console.error(`✖ ORG_SLUG 只能用小寫英數與連字號、且開頭是字母：${slug}`);
    process.exit(1);
  }
  return slug;
}

async function main() {
  const orgName = required('ORG_NAME');
  const orgSlug = validateSlug(required('ORG_SLUG'));
  const adminEmail = required('ADMIN_EMAIL');
  const adminName = required('ADMIN_NAME');
  const adminPassword = process.env['ADMIN_PASSWORD'] ?? generatePassword();

  const env = {
    DATABASE_URL: required('DATABASE_URL'),
    BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET'),
    BETTER_AUTH_URL: required('BETTER_AUTH_URL'),
    WEB_URL: process.env['WEB_URL'] ?? '',
    ALLOWED_ORIGINS: process.env['ALLOWED_ORIGINS'] ?? '',
    // 開站腳本不走 OAuth，留空即可 —— socialProvidersFromEnv 會回傳空 map
    LINE_CLIENT_ID: process.env['LINE_CLIENT_ID'] ?? '',
    LINE_CLIENT_SECRET: process.env['LINE_CLIENT_SECRET'] ?? '',
  };

  const pool = new Pool({ connectionString: env.DATABASE_URL });

  try {
    const existing = await pool.query('select id from public.organizations where slug = $1', [orgSlug]);
    if (existing.rowCount && existing.rowCount > 0) {
      console.error(`✖ slug「${orgSlug}」的組織已存在，未做任何變更。`);
      process.exit(1);
    }

    const orgResult = await pool.query(
      'insert into public.organizations (name, slug) values ($1, $2) returning id',
      [orgName, orgSlug],
    );
    const orgId: string = orgResult.rows[0].id;
    console.log(`✓ 組織已建立：${orgName}（${orgSlug}）`);

    // 走 Better Auth 建帳號 —— ba_* 不得由應用程式碼直接寫入（c2）
    const auth = createAuth(env);
    const created = await (auth.api as unknown as {
      createUser: (a: unknown) => Promise<{ user: { id: string } }>;
    }).createUser({
      body: { name: adminName, email: adminEmail, password: adminPassword, data: { display_name: adminName } },
      asResponse: false,
    });
    const userId = created.user.id;

    // orgId 是 Better Auth 的 additionalField，createUser 不吃，補上去
    await pool.query('update public.ba_user set "orgId" = $1 where id = $2', [orgId, userId]);

    await pool.query(
      `insert into public.user_roles (user_id, role, permissions) values ($1, 'admin', '["*"]'::jsonb)`,
      [userId],
    );

    console.log(`✓ 管理員已建立：${adminName} <${adminEmail}>`);
    console.log('\n' + '─'.repeat(52));
    console.log(`  網址帳號：${adminEmail}`);
    console.log(`  密碼：    ${adminPassword}`);
    console.log('─'.repeat(52));
    console.log('\n這組密碼只顯示這一次，沒有存在任何地方。請立刻交給對方並請他登入後修改。');
  } finally {
    await pool.end();
  }
}

function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(12)))
    .map((n) => chars[n % chars.length])
    .join('');
}

main().catch((err) => {
  console.error('✖ 開站失敗：', err instanceof Error ? err.message : err);
  process.exit(1);
});
