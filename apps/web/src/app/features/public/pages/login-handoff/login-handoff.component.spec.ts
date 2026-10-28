import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { vi } from 'vitest';

import { AuthHandoffService } from '@core/auth-handoff.service';
import { LoginHandoffComponent } from './login-handoff.component';

/** #2027 Safari 落地頁：標記交接（並登出 Safari，在 service 裡）→ 請使用者回 App */
describe('LoginHandoffComponent', () => {
  async function render(h: string | null, ok = true) {
    const complete = vi.fn(async () => ok);
    TestBed.configureTestingModule({
      imports: [LoginHandoffComponent],
      providers: [
        { provide: AuthHandoffService, useValue: { complete } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(h ? { h } : {}) } },
        },
      ],
    });
    const fixture = TestBed.createComponent(LoginHandoffComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    return { text: (fixture.nativeElement as HTMLElement).textContent ?? '', complete };
  }

  it('標記成功 → 「已登入」請回到 App', async () => {
    const { text, complete } = await render('h1');
    expect(complete).toHaveBeenCalledWith('h1');
    expect(text).toContain('已登入');
    expect(text).toContain('回到主畫面上的 App');
  });

  it('標記失敗、或網址沒有 h → 「登入沒有完成」', async () => {
    expect((await render('h1', false)).text).toContain('登入沒有完成');
    TestBed.resetTestingModule();
    const missing = await render(null);
    expect(missing.complete).not.toHaveBeenCalled();
    expect(missing.text).toContain('登入沒有完成');
  });
});
