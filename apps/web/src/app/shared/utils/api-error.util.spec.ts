import { HttpErrorResponse } from '@angular/common/http';

import { extractErrorMessage } from './api-error.util';

/**
 * 這支要治的是 `[object Object]` 出現在 toast 上——tester 在餐費「確認名單」
 * 400 時撞到的。根因見 apps/api/src/index.ts 沒有設 `defaultHook`：
 * `@hono/zod-openapi` 驗證失敗時預設回 `{ success: false, error: ZodError }`，
 * `error` 是物件不是字串，跟這個專案自己 `{ error: string, code? }` 的慣例
 * （#371/#392）長得像但不是同一種形狀，全站 29 處 `err.error?.error` 都會中招。
 */
describe('extractErrorMessage', () => {
  it('這個專案的慣例形狀：{ error: string } → 直接取字串', () => {
    const err = new HttpErrorResponse({ status: 400, error: { error: '這個班已經額滿' } });
    expect(extractErrorMessage(err)).toBe('這個班已經額滿');
  });

  it('陷阱：Zod 驗證失敗的形狀 { success: false, error: { message, name } } —— 不能直接塞進畫面', () => {
    const err = new HttpErrorResponse({
      status: 400,
      error: {
        success: false,
        error: { name: 'ZodError', message: '[{"code":"too_small","path":["rows"]}]' },
      },
    });
    const result = extractErrorMessage(err);
    expect(result).not.toBe('[object Object]');
    expect(typeof result).toBe('string');
  });

  it('API 完全沒回 JSON（連線中斷 / 502 網頁）→ 給人看得懂的預設，不是 undefined 或 [object Object]', () => {
    const err = new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') });
    const result = extractErrorMessage(err);
    expect(result).not.toBe('[object Object]');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('error 是純文字（沒有巢狀 error 欄位）也接得住', () => {
    const err = new HttpErrorResponse({ status: 400, error: '請求格式錯誤' });
    expect(extractErrorMessage(err)).toBe('請求格式錯誤');
  });

  it('沒有任何可用內容時用呼叫端給的預設訊息', () => {
    const err = new HttpErrorResponse({ status: 500, error: null });
    expect(extractErrorMessage(err, '寫入失敗，請稍後再試')).toBe('寫入失敗，請稍後再試');
  });

  it('不是 HttpErrorResponse 的任意值也不會炸，回預設訊息', () => {
    expect(extractErrorMessage(new Error('boom'), '發生錯誤')).toBe('發生錯誤');
    expect(extractErrorMessage(undefined, '發生錯誤')).toBe('發生錯誤');
  });
});
