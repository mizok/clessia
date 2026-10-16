import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AppVersionService } from './app-version.service';

/**
 * #1718：按鈕或元件裡的 `import()` 撞到舊版 chunk。導覽失敗會自動重載一次，這裡不重載 ——
 * 按鈕觸發的當下畫面上可能有使用者選好的檔案、填好的表單，重載會沒收它們。只亮提示條。
 */
describe('AppVersionService.recoverFromImportFailure（#1718）', () => {
  const chunk = () =>
    new TypeError('Failed to fetch dynamically imported module: https://x/chunk-ABC.js');

  function setup() {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return TestBed.inject(AppVersionService);
  }

  afterEach(() => vi.restoreAllMocks());

  it('chunk 失敗：亮提示條、回 true（呼叫端不顯示業務錯誤）', () => {
    const version = setup();
    expect(version.recoverFromImportFailure(chunk())).toBe(true);
    expect(version.isStale()).toBe(true);
  });

  it('不自動重載', () => {
    const version = setup();
    const reload = vi.spyOn(version, 'reloadNow');
    version.recoverFromImportFailure(chunk());
    expect(reload).not.toHaveBeenCalled();
  });

  it('其他錯誤：回 false、不動提示條', () => {
    const version = setup();
    expect(version.recoverFromImportFailure(new TypeError('Failed to fetch'))).toBe(false);
    expect(version.recoverFromImportFailure(new Error('檔案讀取失敗'))).toBe(false);
    expect(version.recoverFromImportFailure('Failed to fetch dynamically imported module')).toBe(
      false,
    );
    expect(version.isStale()).toBe(false);
  });
});
