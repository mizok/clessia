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

describe('public system-time route CORS', () => {
  it('allows localhost development origins beyond port 4200', async () => {
    const response = await app.request('http://localhost/system-time', {
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
      'http://localhost/system-time',
      { headers: { Origin: 'https://clessia.pages.dev' } },
      prodEnv
    );

    expect(response.headers.get('access-control-allow-origin')).toBe('https://clessia.pages.dev');
  });

  it('放行 ALLOWED_ORIGINS 列出的額外來源', async () => {
    const response = await app.request(
      'http://localhost/system-time',
      { headers: { Origin: 'https://custom.example.com' } },
      prodEnv
    );

    expect(response.headers.get('access-control-allow-origin')).toBe('https://custom.example.com');
  });

  it('不發 allow-origin 給不在清單上的來源', async () => {
    const response = await app.request(
      'http://localhost/system-time',
      { headers: { Origin: 'https://evil.example.com' } },
      prodEnv
    );

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('/api/login', () => {
  it('returns 400 when account is empty regardless of loginType', async () => {
    const response = await app.request('http://localhost/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: '', password: 'anything', loginType: 'username' }),
    });
    expect(response.status).toBe(400);
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
