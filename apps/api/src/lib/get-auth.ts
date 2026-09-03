import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';

import { createAuth, type Auth } from '../auth';
import { waitUntilFrom } from './wait-until';
import type { AppEnv } from '../index';

/**
 * 這個請求的 Better Auth 實例 —— 每請求建一次，同請求所有呼叫點共用。
 *
 * **不能做成模組層 singleton**：Workers 不允許跨請求使用 I/O 物件
 * （`Cannot perform I/O on behalf of a different request`）。所以方向是
 * per-request 建池、請求結束收尾，見 `kb/wiki/architecture/auth-pool-lifecycle.md`。
 *
 * capture 走 `magicLinkCapture` 這個**每請求的可變槽**，而不是建立實例時綁死的
 * callback —— 綁死的話 `mintLoginLinkForRequest` 就沒辦法共用這個實例（authMiddleware
 * 早就先建好一個沒有 capture 的了），攔不到 url。
 */
export function getAuth(c: Context<AppEnv>): Auth {
  const cached = c.get('auth');
  if (cached) return cached;

  const auth = createAuth(c.env, (payload) => c.get('magicLinkCapture')?.(payload));
  c.set('auth', auth);
  return auth;
}

/**
 * 請求結束後關掉這個請求開的連線池。**必須掛在所有其他 middleware 之前**，
 * 否則 `/api/auth/*` 那條路開的池收不到。
 *
 * 收尾不能寫在 `getAuth` 裡：`pool.end()` 是**呼叫當下**就把 pool 標成 ending
 * （pg-pool 的 `end()` 同步設 `this.ending = true`，之後任何 `connect()` 直接丟
 * `Cannot use a pool after calling end on the pool`），而 `waitUntil()` 只延長
 * isolate 的壽命、不會延後 promise 的執行。所以「建立時就註冊 waitUntil(pool.end())」
 * 等於建完就關，第一個 auth 查詢就炸。要等 `await next()` 回來才動它。
 */
export const authPoolCleanup = createMiddleware<AppEnv>(async (c, next) => {
  await next();

  const auth = c.get('auth');
  if (!auth) return;

  // 這時 response 已經成形，沒有人會再用這個池，關它一定安全。
  const closing = auth.pool.end().catch(() => undefined);

  // `c.executionCtx` 在沒有 ExecutionContext 時會丟例外（測試的 app.request()、
  // 部分本機情境）。那些環境沒有 isolate 凍結的問題，`end()` 上面已經開始跑了，
  // 不必也不能 waitUntil。這一支原本是全 repo 唯一處理對的地方，現在收斂成共用的。
  waitUntilFrom(c)?.(closing);
});
