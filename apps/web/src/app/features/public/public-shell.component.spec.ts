import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
  return { go, isRight, hasBackBar };
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
});
