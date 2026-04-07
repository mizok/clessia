import { describe, expect, it } from 'vitest';

import { DbUuidSchema } from './validation';

describe('DbUuidSchema', () => {
  it('accepts canonical Postgres UUID strings used by seed data', () => {
    const result = DbUuidSchema.safeParse('61000000-0000-0000-0000-000000000001');

    expect(result.success).toBe(true);
  });

  it('rejects malformed UUID strings', () => {
    const result = DbUuidSchema.safeParse('not-a-uuid');

    expect(result.success).toBe(false);
  });
});
