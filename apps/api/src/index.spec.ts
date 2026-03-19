import { describe, expect, it } from 'vitest';

import app from './index';

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
