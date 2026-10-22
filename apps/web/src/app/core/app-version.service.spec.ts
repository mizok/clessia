import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AppVersionService, VERSION_CHECK_INTERVAL_MS } from './app-version.service';

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

/**
 * #1723：部署後提早知道有新版。抓線上的 index.html，比它引用的入口檔名（main-<雜湊>.js）
 * 跟自己載入的；開站一次、回到前景節流 60 秒。讀不到或解析不到就不亮。
 */
describe('AppVersionService.checkForNewVersion（#1723）', () => {
  let script: HTMLScriptElement;
  const page = (main: string) =>
    new Response(
      `<!doctype html><html><body><script src="${main}" type="module"></script></body></html>`,
    );

  function setup(fetchImpl: () => Promise<Response>) {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl);
    const version = TestBed.inject(AppVersionService);
    return { version, fetchMock };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const foreground = () => document.dispatchEvent(new Event('visibilitychange'));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T02:00:00Z'));
    script = document.createElement('script');
    script.setAttribute('src', 'main-OLD111.js');
    document.body.append(script);
  });
  afterEach(() => {
    script.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('開站就比一次：no-store、帶 ?v= 時間戳；同一個入口檔名不亮', async () => {
    const { version, fetchMock } = setup(async () => page('main-OLD111.js'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/\?v=\d+$/);
    expect(init).toEqual({ cache: 'no-store' });
    expect(version.isStale()).toBe(false);
  });

  it('入口檔名不一樣：亮提示條', async () => {
    const { version } = setup(async () => page('main-NEW222.js'));
    await settle();
    expect(version.isStale()).toBe(true);
  });

  it('解析不到入口檔名（錯誤頁、維護頁）、非 2xx、連不上：都不亮', async () => {
    for (const res of [
      async () => new Response('<html><body>維護中</body></html>'),
      async () => new Response(page('main-NEW222.js').body, { status: 503 }),
      async () => Promise.reject(new TypeError('Failed to fetch')),
    ]) {
      TestBed.resetTestingModule();
      vi.restoreAllMocks();
      const { version, fetchMock } = setup(res);
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(version.isStale()).toBe(false);
    }
  });

  it('回到前景：距離上次不到 60 秒不抓，滿 60 秒才抓', async () => {
    const { version, fetchMock } = setup(async () => page('main-OLD111.js'));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + VERSION_CHECK_INTERVAL_MS - 1);
    foreground();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(async () => page('main-NEW222.js'));
    vi.setSystemTime(Date.now() + 1);
    foreground();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(version.isStale()).toBe(true);
  });

  it('自己的入口檔名拿不到（dev server 的 main.js）：完全不抓', async () => {
    script.setAttribute('src', 'main.js');
    const { version, fetchMock } = setup(async () => page('main-NEW222.js'));
    await settle();
    foreground();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(version.isStale()).toBe(false);
  });
});
