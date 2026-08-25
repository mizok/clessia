import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '@core/auth.service';

import { LinkLineComponent } from './link-line.component';

interface Harness {
  linkLine: () => Promise<void>;
  skip: () => void;
  submitting: () => boolean;
  error: () => string | null;
}

function setup(linkResult: string | null | Error) {
  const auth = {
    linkLine: vi.fn(() =>
      linkResult instanceof Error ? Promise.reject(linkResult) : Promise.resolve(linkResult),
    ),
  };

  TestBed.configureTestingModule({
    imports: [LinkLineComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: auth },
    ],
  });

  const fixture: ComponentFixture<LinkLineComponent> = TestBed.createComponent(LinkLineComponent);
  return { fixture, auth, c: fixture.componentInstance as unknown as Harness };
}

describe('LinkLineComponent', () => {
  it('按下綁定會把使用者交給 LINE', async () => {
    const { auth, c } = setup(null);

    await c.linkLine();

    expect(auth.linkLine).toHaveBeenCalled();
  });

  it('失敗時顯示訊息並解鎖', async () => {
    const { c } = setup('綁定失敗');

    await c.linkLine();

    expect(c.error()).toBe('綁定失敗');
    expect(c.submitting()).toBe(false);
  });

  it('丟例外時也要解鎖', async () => {
    const { c } = setup(new Error('offline'));

    await c.linkLine();

    expect(c.submitting()).toBe(false);
    expect(c.error()).toBeTruthy();
  });

  // 破窗進來的人（供應商幫客戶處理問題）不會想把自己的 LINE 綁上客戶的帳號
  it('「稍後再說」直接進系統，不強迫綁定', () => {
    const { fixture, c } = setup(null);
    const router = TestBed.inject(Router);
    const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();

    c.skip();

    expect(spy).toHaveBeenCalledWith(['/select-role']);
  });
});
