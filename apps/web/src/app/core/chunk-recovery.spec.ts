import { describe, expect, it, beforeEach, vi } from 'vitest';
import { isChunkLoadFailure, RELOAD_FLAG } from './chunk-recovery';

describe('isChunkLoadFailure —— 靠形狀認，不靠名字', () => {
  // **這一組是規格不是樣本。** 專案用的是 esbuild + 原生 `import()`，
  // 所以沒有 webpack 的 `ChunkLoadError`；而 `_redirects` 的 SPA fallback
  // 會把要不到的 chunk 重寫成 index.html（200 + text/html），連 404 都沒有。
  // 各家瀏覽器的措辭都不一樣，全部都要認得。
  it.each([
    ['Chrome：動態 import 失敗', 'Failed to fetch dynamically imported module: /chunk-A1B2.js'],
    ['Firefox：同一件事、不同措辭', 'error loading dynamically imported module: /chunk-A1B2.js'],
    ['Safari：更短', 'Importing a module script failed.'],
    [
      'SPA fallback 把 JS 換成 HTML',
      'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    ],
  ])('%s', (_label, message) => {
    expect(isChunkLoadFailure(new TypeError(message))).toBe(true);
  });

  it('webpack 時代的名字也認（將來換 builder 不會靜靜失效）', () => {
    const err = new Error('Loading chunk 42 failed.');
    err.name = 'ChunkLoadError';
    expect(isChunkLoadFailure(err)).toBe(true);
  });

  // **反例比正例重要。** 一個什麼都說 true 的偵測會讓每個錯誤都觸發重載，
  // 那比原本的空白畫面更糟 —— 使用者會掉進重載迴圈。
  it.each([
    ['一般的 TypeError', new TypeError("Cannot read properties of undefined (reading 'id')")],
    ['HTTP 錯誤', new Error('Http failure response for /api/students: 500')],
    ['字面上有 module 但不是載入失敗', new Error('module is not defined')],
    ['null', null],
    ['字串', 'Failed to fetch dynamically imported module'],
  ])('不該攔：%s', (_label, error) => {
    expect(isChunkLoadFailure(error)).toBe(false);
  });

  it('巢狀在 rejection 裡的也認得（全域監聽器包一層）', () => {
    const inner = new TypeError('Failed to fetch dynamically imported module: /x.js');
    expect(isChunkLoadFailure({ rejection: inner })).toBe(true);
  });
});

describe('防迴圈旗標', () => {
  beforeEach(() => sessionStorage.clear());

  it('旗標存 sessionStorage 而不是 localStorage —— 關掉分頁就重置', async () => {
    const { markReloadAttempted, hasReloadBeenAttempted } = await import('./chunk-recovery');
    markReloadAttempted();
    expect(hasReloadBeenAttempted()).toBe(true);
    expect(sessionStorage.getItem(RELOAD_FLAG)).not.toBeNull();
    expect(localStorage.getItem(RELOAD_FLAG)).toBeNull();
  });

  it('時間窗內再失敗 → 擋住（這是防迴圈的核心）', async () => {
    const { markReloadAttempted, hasReloadBeenAttempted, RELOAD_WINDOW_MS } = await import(
      './chunk-recovery'
    );
    markReloadAttempted();
    // 剛重載完，CDN 邊緣還在發舊的 index.html → 又失敗一次。不能再重載。
    expect(hasReloadBeenAttempted(Date.now() + RELOAD_WINDOW_MS - 1)).toBe(true);
  });

  it('時間窗過了 → 可以再救一次（同一個 session 裡的第二次部署）', async () => {
    const { markReloadAttempted, hasReloadBeenAttempted, RELOAD_WINDOW_MS } = await import(
      './chunk-recovery'
    );
    markReloadAttempted();
    expect(hasReloadBeenAttempted(Date.now() + RELOAD_WINDOW_MS + 1)).toBe(false);
  });

  it('旗標的值壞掉時往「不要重載」倒', async () => {
    const { hasReloadBeenAttempted, RELOAD_FLAG: flag } = await import('./chunk-recovery');
    sessionStorage.setItem(flag, '不是數字');
    expect(hasReloadBeenAttempted()).toBe(true);
  });

  it('sessionStorage 不可用時不能炸掉（無痕模式 / 阻擋 cookie）', async () => {
    // 被阻擋的瀏覽器是**讀寫都丟** —— 只 mock setItem 模擬不出真實情況，
    // 那樣 getItem 仍然成功回 null，測到的是一個不存在的狀態。
    const deny = () => {
      throw new DOMException('denied');
    };
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(deny);
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(deny);

    const { markReloadAttempted, hasReloadBeenAttempted } = await import('./chunk-recovery');
    expect(() => markReloadAttempted()).not.toThrow();
    // 讀不到旗標時**當成已經試過**：存不了旗標的瀏覽器如果還照常重載，
    // 就會變成無限迴圈 —— 寧可讓使用者看到錯誤自己按重整。
    expect(hasReloadBeenAttempted()).toBe(true);

    setSpy.mockRestore();
    getSpy.mockRestore();
  });
});
