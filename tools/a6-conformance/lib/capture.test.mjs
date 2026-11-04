// 稿那一側是空的（script 全掛、0 個 part）就不准往下比（#2212）：照樣出表會貼出假數字。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertDraftLoaded } from './capture.mjs';

test('A6 側 0 個 part：報錯、指出稿目錄與 ../shared/，並列出載入失敗的檔', () => {
  assert.throws(
    () =>
      assertDraftLoaded({
        parts: [],
        file: 'p-dashboard.html',
        failed: ['file:///x/shared/data.js'],
      }),
    (e) =>
      /0 個 part/.test(e.message) &&
      /\.\.\/shared\//.test(e.message) &&
      /p-dashboard\.html/.test(e.message) &&
      /shared\/data\.js/.test(e.message),
  );
});

test('A6 側有 part：不報錯', () => {
  assert.doesNotThrow(() =>
    assertDraftLoaded({ parts: [{ key: 'x' }], file: 'a.html', failed: [] }),
  );
});
