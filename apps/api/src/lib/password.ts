import { scrypt } from 'node:crypto';

/**
 * Verifies a plain-text password against a Better Auth scrypt hash.
 *
 * Better Auth hash format: `saltHex:keyHex`
 * - saltHex: 32 hex chars (16-byte salt passed AS HEX STRING to scrypt — not decoded)
 * - keyHex: 128 hex chars (64-byte derived key)
 * - scrypt params: N=16384, r=16, p=1
 * - Password is NFKC-normalized before hashing
 */
export async function verifyPassword(
  inputPassword: string,
  storedHash: string,
): Promise<boolean> {
  const colonIndex = storedHash.indexOf(':');
  if (colonIndex === -1) return false;

  const saltHex = storedHash.slice(0, colonIndex);
  const keyHex = storedHash.slice(colonIndex + 1);

  if (!saltHex || !keyHex) return false;

  try {
    const normalizedPassword = inputPassword.normalize('NFKC');
    // Salt is passed as the hex string itself (not decoded to bytes) — matches Better Auth
    // maxmem: 128 * N * r * 2 = ~64MB, required to avoid RangeError on some runtimes
    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        normalizedPassword,
        saltHex,
        64,
        { N: 16384, r: 16, p: 1, maxmem: 128 * 1024 * 1024 },
        (err, key) => {
          if (err) reject(err);
          else resolve(key);
        },
      );
    });
    return derivedKey.toString('hex') === keyHex;
  } catch {
    return false;
  }
}
