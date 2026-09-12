import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { LoginLinkDialogComponent } from './login-link-dialog.component';

/**
 * #666 之二：**這支對話框是為家長流程設計的，後來被人員流程重用了。**
 *
 * 檔頭註解逐字寫著「櫃檯當場掃是綁定成功率最高的時刻 —— **家長本人在場**、
 * 有真人可以帶著操作」，而建完一個坐辦公室的職員之後跳的也是這一個，
 * 措辭要求「請對方用自己的手機掃描」。
 *
 * 使用者裁定：**同一個能力、兩套措辭**。家長版**一字不動**，職員版換一句。
 * 所以 `audience` 預設就是 `'parent'` —— **不傳的呼叫端行為完全不變**。
 */
describe('LoginLinkDialogComponent 的對象措辭（#666）', () => {
  const PARENT_COPY = '請對方用自己的手機掃描下方 QR，登入後綁定 LINE。';
  const STAFF_COPY = '請同仁用手機掃描綁定，或複製連結傳給他';

  async function render(data: Record<string, unknown>): Promise<ComponentFixture<unknown>> {
    await TestBed.configureTestingModule({
      imports: [LoginLinkDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        {
          provide: DynamicDialogConfig,
          useValue: { data: { loginUrl: 'https://example.test/x', personName: '王小明', ...data } },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoginLinkDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  const noticeText = (f: ComponentFixture<unknown>) =>
    (f.nativeElement.querySelector('app-inline-notice')?.textContent ?? '').replace(/\s+/g, ' ');

  it('職員版換成「請同仁用手機掃描綁定，或複製連結傳給他」', async () => {
    const f = await render({ audience: 'staff' });

    expect(noticeText(f)).toContain(STAFF_COPY);
    expect(noticeText(f)).not.toContain('請對方用自己的手機');
  });

  /**
   * **反向對照 1**：家長版一字不動。
   * 裁定明講那條路是刻意設計的，**不要為了人員流程把它改壞**。
   */
  it('家長版一字不動', async () => {
    const f = await render({ audience: 'parent' });

    expect(noticeText(f)).toContain(PARENT_COPY);
  });

  /**
   * **反向對照 2**：**不傳 `audience` 就是家長版。**
   *
   * 這一條守的是「別把預設改成職員版」，也守著呼叫端 ——
   * `parents.page.ts:415` 沒有傳 `audience`，如果預設變了它會靜靜換掉文案。
   */
  it('沒有傳 audience 時是家長版 —— parents.page 就是這樣開的', async () => {
    const f = await render({});

    expect(noticeText(f)).toContain(PARENT_COPY);
  });

  /**
   * **反向對照 3**：兩個版本都要保留「連結會過期、只能用一次」。
   *
   * 那不是措辭是**事實** —— 拿掉它，職員不會知道這條連結 24 小時後就沒用了。
   */
  it('家長版保留「24 小時 / 只能使用一次」', async () => {
    const f = await render({ audience: 'parent' });

    expect(noticeText(f)).toContain('24 小時');
    expect(noticeText(f)).toContain('只能使用一次');
  });

  it('職員版也要保留「24 小時 / 只能使用一次」', async () => {
    const f = await render({ audience: 'staff' });

    expect(noticeText(f)).toContain('24 小時');
    expect(noticeText(f)).toContain('只能使用一次');
  });
});
