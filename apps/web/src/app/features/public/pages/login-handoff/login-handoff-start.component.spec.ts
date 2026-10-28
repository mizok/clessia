import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { vi } from 'vitest';

import { AuthService } from '@core/auth.service';
import { LoginHandoffStartComponent } from './login-handoff-start.component';

/**
 * #2063：外部瀏覽器的發起頁。OAuth 在**這個瀏覽器**發起，state cookie 才跟回呼同一個瀏覽器；
 * 落地網址只帶交接 id。
 */
describe('LoginHandoffStartComponent', () => {
  async function render(h: string | null, result: string | null = null) {
    const signInWithLine = vi.fn(async () => result);
    TestBed.configureTestingModule({
      imports: [LoginHandoffStartComponent],
      providers: [
        { provide: AuthService, useValue: { signInWithLine } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(h ? { h } : {}) } },
        },
      ],
    });
    const fixture = TestBed.createComponent(LoginHandoffStartComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, signInWithLine };
  }

  it('進頁就在這個瀏覽器發起 LINE 登入，落地是 /login/handoff?h=（只帶 id）', async () => {
    const { signInWithLine } = await render('h1');
    expect(signInWithLine).toHaveBeenCalledTimes(1);
    expect(signInWithLine).toHaveBeenCalledWith(`${window.location.origin}/login/handoff?h=h1`);
  });

  it('發起失敗：顯示訊息，按鈕還在可以再按', async () => {
    const { el, signInWithLine } = await render('h1', 'LINE 登入失敗，請稍後再試或聯繫補習班');
    expect(el.querySelector('[data-testid="handoff-start-error"]')?.textContent).toContain(
      'LINE 登入失敗',
    );
    el.querySelector<HTMLButtonElement>('button')!.click();
    await Promise.resolve();
    expect(signInWithLine).toHaveBeenCalledTimes(2);
  });

  it('沒有 ?h=：不發起，請他回 App 重按', async () => {
    const { el, signInWithLine } = await render(null);
    expect(signInWithLine).not.toHaveBeenCalled();
    expect(el.textContent).toContain('連結不完整');
  });
});
