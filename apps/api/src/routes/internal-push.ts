import { Hono } from 'hono';
import { Pool } from 'pg';

import type { AppEnv } from '../index';
import { resolveDatabaseUrl } from '../lib/database-url';
import { DEFAULT_PUSH_BATCH_SIZE, runPush } from '../lib/push-run';
import { getCurrentTaipeiDateString } from '../lib/taipei-date';

/**
 * `POST /api/internal/push/run` —— 推播排程（#1661，設計稿 web-push.md §5）。
 *
 * Workers 的 `scheduled()` 在行程內呼叫它；自架用系統 cron 打同一支（c12）。**掛在 authMiddleware 之前**，
 * 唯一的門是 `CRON_SECRET`：沒設 → 404（這份部署沒開排程，跟 PUBLIC_ORG_SLUG 同一個慣例），
 * 帶錯 → 401。它不收任何「推給誰」的參數 —— 密鑰外洩能做的也只有提早觸發今天本來就要送的提醒，
 * 而且被去重鍵擋住。
 */

const enc = new TextEncoder();

/**
 * 固定時間比較：兩邊各做一次 HMAC 再逐 byte 比。`crypto.subtle.timingSafeEqual` 是 Workers 專屬，
 * Node 沒有 —— 這個寫法兩邊都能跑（c12）。
 */
export async function secretMatches(given: string, expected: string): Promise<boolean> {
  const key = (await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])) as CryptoKey;
  const [a, b] = await Promise.all(
    [given, expected].map(
      async (s) => new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(s))),
    ),
  );
  let diff = 0;
  for (let i = 0; i < a!.length; i++) diff |= a![i]! ^ b![i]!;
  return diff === 0;
}

const app = new Hono<AppEnv>();

app.post('/run', async (c) => {
  const env = c.env;
  if (!env?.CRON_SECRET) return c.json({ error: 'Not Found' }, 404);
  if (!(await secretMatches(c.req.header('authorization') ?? '', `Bearer ${env.CRON_SECRET}`))) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    console.error('[push] CRON_SECRET 設了但 VAPID 沒設齊');
    return c.json({ error: '推播尚未設定完成', code: 'PUSH_NOT_CONFIGURED' }, 500);
  }

  // 自己開一個小池，不經 Better Auth（省掉建它的 CPU —— 免費方案一次 Cron 只有 10ms）
  const pool = new Pool({ connectionString: resolveDatabaseUrl(env), max: 1 });
  try {
    const result = await runPush(pool, {
      today: getCurrentTaipeiDateString(),
      // ponytail: 校準旋鈕。免費方案用預設 10（#1657 實測）；自架或升級後可以調大
      batchSize: Number(env.PUSH_BATCH_SIZE) || DEFAULT_PUSH_BATCH_SIZE,
      vapid: { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
      subject: env.VAPID_SUBJECT,
    });
    console.log('[push] run', JSON.stringify(result));
    return c.json(result, 200);
  } catch (err) {
    console.error('[push] run failed:', err instanceof Error ? err.message : err);
    return c.json({ error: '推播排程失敗', code: 'PUSH_RUN_FAILED' }, 500);
  } finally {
    await pool.end().catch(() => undefined);
  }
});

export default app;
