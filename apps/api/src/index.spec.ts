import { describe, expect, it } from 'vitest';

import app from './index';

const testEnv = {
  ENVIRONMENT: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  WEB_URL: 'http://localhost:4200',
  BETTER_AUTH_SECRET: 'test-secret',
  BETTER_AUTH_URL: 'http://localhost:8787',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:54322/postgres',
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
