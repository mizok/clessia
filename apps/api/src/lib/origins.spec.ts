import { describe, expect, it } from 'vitest';

import { isAllowedOrigin, resolveTrustedOrigins } from './origins';

describe('origin allowlist', () => {
  it('allows localhost and 127.0.0.1 on any port for local development', () => {
    expect(isAllowedOrigin('http://localhost:4200')).toBe(true);
    expect(isAllowedOrigin('http://localhost:58871')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4300')).toBe(true);
  });

  it('rejects untrusted non-local origins', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
  });

  it('builds trusted origins from static allowlist, configured web url, and request origin', () => {
    expect(
      resolveTrustedOrigins({
        requestOrigin: 'http://localhost:58871',
        webUrl: 'http://localhost:4200',
      }),
    ).toEqual([
      'https://clessia.pages.dev',
      'http://localhost:4200',
      'http://localhost:58871',
    ]);
  });
});
