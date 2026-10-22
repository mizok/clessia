import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { PublicShellComponent } from './public-shell.component';

@Component({ template: '' })
class BlankComponent {}

/**
 * 手機橫向兩面（#1636）：哪一面在畫面上完全由網址決定 ——
 * `#form` 片段、登入錯誤的查詢參數、選擇身分頁。重新整理與瀏覽器返回鍵因此跟著同一個狀態走。
 */
async function setup(mobile: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  TestBed.configureTestingModule({
    imports: [PublicShellComponent],
    providers: [
      provideRouter([
        { path: 'login', component: BlankComponent },
        { path: 'trial', component: BlankComponent },
        { path: 'select-role', component: BlankComponent },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideNoopAnimations(),
    ],
  });
  const fixture = TestBed.createComponent(PublicShellComponent);
  const router = TestBed.inject(Router);
  const go = async (url: string) => {
    await router.navigateByUrl(url);
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const isRight = () =>
    (fixture.nativeElement as HTMLElement).querySelector('section')!.classList.contains('is-right');
  const hasBackBar = () =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].some((b) =>
      b.textContent?.includes('返回'),
    );
  return { go, isRight, hasBackBar, fixture };
}

describe('PublicShellComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('手機第一屏是品牌面；#form 移到表單面', async () => {
    const { go, isRight } = await setup(true);

    await go('/trial');
    expect(isRight()).toBe(false);

    await go('/trial#form');
    expect(isRight()).toBe(true);
  });

  it('登入失敗被導回來（?error=）直接落在表單面，錯誤訊息才看得到', async () => {
    const { go, isRight } = await setup(true);

    await go('/login?error=access_denied');

    expect(isRight()).toBe(true);
  });

  it('選擇身分一進頁就在表單面，而且沒有返回列（彈窗關不掉，返回是死路）', async () => {
    const { go, isRight, hasBackBar } = await setup(true);

    await go('/select-role');

    expect(isRight()).toBe(true);
    expect(hasBackBar()).toBe(false);
  });

  it('桌機不平移、沒有返回列', async () => {
    const { go, isRight, hasBackBar } = await setup(false);

    await go('/trial#form');

    expect(isRight()).toBe(false);
    expect(hasBackBar()).toBe(false);
  });
  // #1858：品牌面主標＝補習班名稱（GET /api/public/org）；讀不到就收著，不擋入口
  describe('補習班名稱', () => {
    const orgReq = () =>
      TestBed.inject(HttpTestingController).expectOne((r) => r.url.endsWith('/api/public/org'));
    const title = (el: HTMLElement) => el.querySelector('aside h2');

    it('回來就顯示、外層滑開', async () => {
      const { go, fixture } = await setup(false);
      await go('/login');
      orgReq().flush({ name: 'Demo 補習班' });
      await Promise.resolve(); // org() 是 Promise：flush 之後下一個 microtask 才套上
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(title(el)?.textContent?.trim()).toBe('Demo 補習班');
      expect(title(el)!.closest('.grid')!.classList).toContain('is-on');
    });

    it('404（沒開放公開頁）：不顯示名稱、入口照常', async () => {
      const { go, fixture } = await setup(false);
      await go('/login');
      orgReq().flush({ code: 'PUBLIC_DISABLED' }, { status: 404, statusText: 'Not Found' });
      fixture.detectChanges();
      await fixture.whenStable();

      const el = fixture.nativeElement as HTMLElement;
      expect(title(el)).toBeNull();
      expect(el.querySelector('aside .grid')!.classList).not.toContain('is-on');
      expect(el.querySelectorAll('nav a').length).toBeGreaterThan(0);
    });

    it('手機也有 copyright', async () => {
      const { go, fixture } = await setup(true);
      await go('/login');
      const c = [...(fixture.nativeElement as HTMLElement).querySelectorAll('aside p')].find((p) =>
        p.textContent?.includes('©'),
      )!;
      expect(c.className).not.toContain('hidden');
    });
  });
});
