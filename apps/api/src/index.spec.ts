import { describe, expect, it } from 'vitest';

import app from './index';

const testEnv = {
  ENVIRONMENT: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  WEB_URL: 'http://localhost:4200',
  BETTER_AUTH_SECRET: 'test-secret',
  BETTER_AUTH_URL: 'http://localhost:8787',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:54322/postgres',
  ALLOWED_ORIGINS: '',
};

/** 模擬正式部署：前端在自己的網域上，跟 API 不同源 */
const prodEnv = {
  ...testEnv,
  ENVIRONMENT: 'production',
  WEB_URL: 'https://clessia.pages.dev',
  ALLOWED_ORIGINS: 'https://custom.example.com',
};

// `/api/system-time` **必須維持公開** —— 它註冊在 `app.use('/api/*', authMiddleware)`
// 之前。搬到 /api 前綴是因為正式站只有 `/api/*` 會進 Worker（先前掛在 `/system-time`
// 的版本在正式站回的是 SPA 的 index.html）。
describe('public system-time route CORS', () => {
  it('allows localhost development origins beyond port 4200', async () => {
    const response = await app.request('http://localhost/api/system-time', {
      headers: {
        Origin: 'http://localhost:4201',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:4201');
  });

  // 迴歸測試：允許清單一度只在模組載入時從 process.env 讀，而 Workers 的環境變數
  // 在 request-scoped 的 c.env 上 —— 清單永遠是空的，正式站前端整個被 CORS 擋。
  // 這幾條一定要**帶 env 呼叫**，否則測不到那段接線。
  it('放行部署設定的 WEB_URL 來源', async () => {
    const response = await app.request(
      'http://localhost/api/system-time',
      { headers: { Origin: 'https://clessia.pages.dev' } },
      prodEnv,
    );

    expect(response.headers.get('access-control-allow-origin')).toBe('https://clessia.pages.dev');
  });

  it('放行 ALLOWED_ORIGINS 列出的額外來源', async () => {
    const response = await app.request(
      'http://localhost/api/system-time',
      { headers: { Origin: 'https://custom.example.com' } },
      prodEnv,
    );

    expect(response.headers.get('access-control-allow-origin')).toBe('https://custom.example.com');
  });

  it('不發 allow-origin 給不在清單上的來源', async () => {
    const response = await app.request(
      'http://localhost/api/system-time',
      { headers: { Origin: 'https://evil.example.com' } },
      prodEnv,
    );

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

// 密碼登入整條路已移除（scrypt 超過 Workers 的 10ms CPU 上限）。
// 這幾條守住「它真的沒了」—— 留著任何一條密碼路徑，CPU 問題就原封不動。
describe('密碼登入的路徑都不存在', () => {
  // 回 401 而不是 404：/api/* 的 authMiddleware 先接住它。
  // 重點不是狀態碼，是「這條路不會給你 session」。
  it('POST /api/login 不再登入任何人', async () => {
    const response = await app.request(
      'http://localhost/api/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: 'a@b.co', password: 'x', loginType: 'email' }),
      },
      testEnv,
    );

    expect(response.status).not.toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('Better Auth 的 /sign-in/email 不再接受請求', async () => {
    const response = await app.request(
      'http://localhost/api/auth/sign-in/email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.co', password: 'x' }),
      },
      testEnv,
    );

    expect(response.status).not.toBe(200);
  });

  it('username plugin 的 /sign-in/username 也不在了', async () => {
    const response = await app.request(
      'http://localhost/api/auth/sign-in/username',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'root', password: 'x' }),
      },
      testEnv,
    );

    expect(response.status).not.toBe(200);
  });
});

describe('GET /api/me', () => {
  it('returns 401 when not authenticated', async () => {
    const response = await app.request('http://localhost/api/me', undefined, testEnv);
    expect(response.status).toBe(401);
  });
});

describe('PATCH /api/me', () => {
  it('returns 401 when not authenticated', async () => {
    const response = await app.request(
      'http://localhost/api/me',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Test' }),
      },
      testEnv,
    );
    expect(response.status).toBe(401);
  });
});

describe('POST /api/me/activate-parent', () => {
  it('returns 401 when not authenticated', async () => {
    const response = await app.request(
      'http://localhost/api/me/activate-parent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName: 'Test', grade: 'P1' }),
      },
      testEnv,
    );
    expect(response.status).toBe(401);
  });
});

// 純函式對了不代表接上了 —— #19 的 CORS 事故就是「函式寫對但沒接上 c.env」。
describe('magic-link 產生端點對外封鎖', () => {
  it('POST /api/auth/sign-in/magic-link 回 404', async () => {
    const response = await app.request(
      'http://localhost/api/auth/sign-in/magic-link',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      testEnv,
    );

    expect(response.status).toBe(404);
  });

  it('兌換端點沒有被一起擋掉', async () => {
    const response = await app.request(
      'http://localhost/api/auth/magic-link/verify?token=whatever',
      undefined,
      testEnv,
    );

    expect(response.status).not.toBe(404);
  });
});

// 產生登入連結 = 產生一個能登入的憑證。掛載層必須是 ADMIN_ONLY。
describe('POST /api/login-links 的准入', () => {
  it('未登入回 401', async () => {
    const response = await app.request(
      'http://localhost/api/login-links',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'someone' }),
      },
      testEnv,
    );

    expect(response.status).toBe(401);
  });
});
