import { HttpErrorResponse } from '@angular/common/http';

/**
 * 從 API 錯誤回應裡取出一句人看得懂的話，永遠回字串，永遠不把物件直接塞進畫面。
 *
 * 這個專案的錯誤回應**有兩種不同形狀**，呼叫端常常只認得其中一種：
 * - **業務邏輯拋的**：`{ error: string, code? }`（`apps/api/src/index.ts` 的 `onError`
 *   與大多數 route 手寫的 `c.json({ error: '...' }, 4xx)`）
 * - **Zod 驗證失敗的**：`{ success: false, error: ZodError }`——**`error` 是物件不是
 *   字串**，因為全 API 沒有任何一處設定 `defaultHook`（`@hono/zod-openapi` 的預設
 *   行為）。既有的 `err.error?.error` 寫法在這種形狀下會塞進畫面，Angular 模板把
 *   物件轉成字串顯示就是 `[object Object]`——tester 在餐費「確認名單」撞到的就是這個。
 *
 * 這支只治前端這一半（不管上游哪種形狀，畫面上一定是一句話）。後端讓兩種形狀
 * 收斂成一種是另一個題目，不在這支處理範圍。
 */
export function extractErrorMessage(err: unknown, fallback = '請稍後再試'): string {
  if (!(err instanceof HttpErrorResponse)) return fallback;

  const body: unknown = err.error;

  if (typeof body === 'string' && body.trim().length > 0) return body;

  if (body && typeof body === 'object') {
    const inner = (body as Record<string, unknown>)['error'];

    if (typeof inner === 'string' && inner.trim().length > 0) return inner;

    // Zod 驗證失敗的形狀：inner 是 { name: 'ZodError', message: string }
    if (inner && typeof inner === 'object') {
      const message = (inner as Record<string, unknown>)['message'];
      if (typeof message === 'string' && message.trim().length > 0) return message;
    }

    const message = (body as Record<string, unknown>)['message'];
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }

  return fallback;
}
