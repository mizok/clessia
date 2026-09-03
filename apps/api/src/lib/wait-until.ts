import type { Context } from 'hono';

/**
 * 這個請求的 `waitUntil`，**沒有 ExecutionContext 時回 `undefined` 而不是丟例外**。
 *
 * Workers 上一定有 ExecutionContext；沒有的情境是測試的 `app.request()`
 * 與部分本機執行路徑。而 Hono 的 `c.executionCtx` 是一個**會丟例外的 getter**：
 *
 * ```js
 * get executionCtx() {
 *   if (this.#executionCtx) return this.#executionCtx;
 *   throw new Error('This context has no ExecutionContext');
 * }
 * ```
 *
 * ⚠️ **所以 `c.executionCtx?.waitUntil` 沒有任何保護作用** —— 可選鏈是在取到值
 * *之後*才判斷 null/undefined，而這裡在取值的當下就丟了。repo 裡有幾處寫成
 * `?.` 的（`class-logs.ts`、`contact-book.ts`…），那是**假的安全感**：
 * 它們跟不加 `?.` 的行為一模一樣。唯一有效的是 try/catch。
 *
 * 收斂成這一支之前，同一件事在 repo 裡有三種寫法：直取（83 處）、
 * 可選鏈（假保護）、try/catch（只有 `lib/get-auth.ts` 一處是對的）。
 */
export function waitUntilFrom(c: Context): ((promise: Promise<unknown>) => void) | undefined {
  try {
    const ctx = c.executionCtx;
    return ctx.waitUntil.bind(ctx);
  } catch {
    // 沒有 ExecutionContext。呼叫端的 promise 仍然會被建立與執行，
    // 只是不保證在 response 送出後還能跑完 —— 在沒有 isolate 凍結的環境裡那不是問題。
    return undefined;
  }
}
