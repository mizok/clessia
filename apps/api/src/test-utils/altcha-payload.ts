import { createChallenge, solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2';

import { altchaSecrets } from '../routes/public/application-common';

/**
 * 公開表單 spec 用（#1665）：真的出一題、真的解，用 API 同一把衍生金鑰簽，
 * 只把難度調到 1（正式參數要算好幾秒）。驗證那一端走正式路徑，沒有 mock。
 */
export async function altchaPayload(
  opts: { secret?: string; hmacKey?: string; expiresAt?: number; tamper?: boolean } = {},
): Promise<string> {
  const challenge = await createChallenge({
    algorithm: 'PBKDF2/SHA-256',
    cost: 1,
    counter: 3,
    deriveKey,
    expiresAt: opts.expiresAt ?? Math.floor(Date.now() / 1000) + 600,
    ...(await altchaSecrets({
      BETTER_AUTH_SECRET: opts.secret ?? 'test-secret',
      ALTCHA_HMAC_KEY: opts.hmacKey,
    })),
  });
  const solution = await solveChallenge({ challenge, deriveKey });
  if (opts.tamper) challenge.parameters.cost = 2;
  return btoa(JSON.stringify({ challenge, solution }));
}
