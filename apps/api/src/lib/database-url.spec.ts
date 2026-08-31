import { describe, expect, it } from 'vitest';

import { resolveDatabaseUrl } from './database-url';

describe('resolveDatabaseUrl', () => {
  it('prefers the Hyperdrive binding over DATABASE_URL', () => {
    expect(
      resolveDatabaseUrl({
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive/local' },
        DATABASE_URL: 'postgres://origin/direct',
      }),
    ).toBe('postgres://hyperdrive/local');
  });

  it('falls back to DATABASE_URL when there is no binding', () => {
    // wrangler dev 沒設 localConnectionString、以及 server.ts 的 Node 自架路徑（c12）
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgres://origin/direct' })).toBe(
      'postgres://origin/direct',
    );
  });

  it('falls back when the binding exists but hands back nothing usable', () => {
    // 綁錯或本機 stub 出來的空字串，比沒有 binding 更容易被當成有效值
    expect(
      resolveDatabaseUrl({
        HYPERDRIVE: { connectionString: '   ' },
        DATABASE_URL: 'postgres://origin/direct',
      }),
    ).toBe('postgres://origin/direct');
  });

  it('throws instead of letting pg silently connect to a default local database', () => {
    expect(() => resolveDatabaseUrl({})).toThrow('沒有資料庫連線來源');
  });
});
