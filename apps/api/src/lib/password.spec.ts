import { describe, expect, it } from 'vitest';
import { verifyPassword } from './password';

describe('verifyPassword', () => {
  it('returns true for correct password against stored hash', async () => {
    // This hash is the scrypt hash of 'Test123' used in seed.sql
    // Format: saltHex:keyHex — 32 hex chars salt (16 bytes), 128 hex chars key (64 bytes)
    const storedHash =
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6:6ad04372a2a78a5adde77793f33e0a316de3077333eb0704947f8213c2adac9fdf3713001d762b95d0c259fa048006a2b79b994c79c7de0d380668f31695ce75';
    const result = await verifyPassword('Test123', storedHash);
    expect(result).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const storedHash =
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6:6ad04372a2a78a5adde77793f33e0a316de3077333eb0704947f8213c2adac9fdf3713001d762b95d0c259fa048006a2b79b994c79c7de0d380668f31695ce75';
    const result = await verifyPassword('WrongPassword', storedHash);
    expect(result).toBe(false);
  });

  it('returns false for malformed hash (no colon separator)', async () => {
    const result = await verifyPassword('Test123', 'notavalidhash');
    expect(result).toBe(false);
  });
});
