import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { vi } from 'vitest';

import { AuthHandoffService, type CompleteResult } from '@core/auth-handoff.service';
import { LoginHandoffComponent } from './login-handoff.component';

/**
 * #2027 Safari 落地頁。**載入時不自動完成**（防交接劫持）：要輸入 App 上的 4 位數並按確認。
 */
describe('LoginHandoffComponent', () => {
  async function render(h: string | null, results: CompleteResult[] = [{ kind: 'done' }]) {
    const complete = vi.fn(async () => results.shift()!);
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
    const el = fixture.nativeElement as HTMLElement;
    const submit = async (code: string) => {
      const input = el.querySelector('input[name="pairCode"]') as HTMLInputElement;
      input.value = code;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { el, complete, submit, text: () => el.textContent ?? '' };
  }

  it('載入時**不**呼叫 complete；先問「把這次登入交給 App？」、要輸入號碼', async () => {
    const { complete, text, el } = await render('h1');
    expect(complete).not.toHaveBeenCalled();
    expect(text()).toContain('把這次登入交給 App？');
    expect(el.querySelector('input[name="pairCode"]')).not.toBeNull();
  });

  it('輸入號碼按確認 → 帶號碼 complete → 「已登入」請回到 App', async () => {
    const { complete, submit, text } = await render('h1');
    await submit('0427');
    expect(complete).toHaveBeenCalledWith('h1', '0427');
    expect(text()).toContain('已登入');
  });

  it('號碼不對 → 留在原頁、寫還剩幾次；再輸入對的就完成', async () => {
    const { complete, submit, text } = await render('h1', [
      { kind: 'mismatch', attemptsLeft: 3 },
      { kind: 'done' },
    ]);
    await submit('9999');
    expect(text()).toContain('號碼不對');
    expect(text()).toContain('還可以試 3 次');
    await submit('0427');
    expect(complete).toHaveBeenCalledTimes(2);
    expect(text()).toContain('已登入');
  });

  it('失效 → 「登入沒有完成」；網址沒有 h → 直接「登入沒有完成」、不呼叫', async () => {
    const failed = await render('h1', [{ kind: 'failed' }]);
    await failed.submit('0427');
    expect(failed.text()).toContain('登入沒有完成');
    TestBed.resetTestingModule();
    const missing = await render(null);
    expect(missing.complete).not.toHaveBeenCalled();
    expect(missing.text()).toContain('登入沒有完成');
  });
});
