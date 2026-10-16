/**
 * 產生一組 VAPID 金鑰（P-256）給 Web Push 用（#1657，設計見 kb/wiki/architecture/web-push.md §2）。
 *
 *   npx tsx apps/api/src/scripts/generate-vapid-keys.ts
 *
 * **一份部署一組，自己產、自己保管（c12）。** 私鑰只印在你的終端機，不寫檔、不送任何地方：
 *   - VAPID_PRIVATE_KEY → `npx wrangler secret put VAPID_PRIVATE_KEY --env production`
 *   - VAPID_PUBLIC_KEY  → wrangler.toml 的 `[env.production.vars]`（不是機密）
 *
 * **不要輪替**：換金鑰 = 所有既有訂閱失效（瀏覽器訂閱時綁的是公鑰）。
 */
import { toB64u } from '../lib/web-push';

async function main(): Promise<void> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = toB64u(
    new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
  );
  const { d } = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;

  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${d}`);
}

void main();
