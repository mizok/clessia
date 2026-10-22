import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

import { AuthService, type UserRole } from '@core/auth.service';
import { AccountSettingsDialogComponent } from './account-settings-dialog.component';

/**
 * #1844（使用者 10-22 選 A）：不能自助啟用家長身份 —— 綁孩子只有行政能做，改由行政在家長頁一次設定。
 * 這裡只剩一行說明，不再有按鈕，也不再打已經移除的 `POST /api/me/activate-parent`。
 */
describe('AccountSettingsDialogComponent —— 家長身份改由行政設定（#1844）', () => {
  function setup(roles: UserRole[]) {
    TestBed.configureTestingModule({
      imports: [AccountSettingsDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            roles: signal(roles),
            refreshRoles: vi.fn(),
            profile: () => null,
            user: () => null,
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountSettingsDialogComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/me')).flush({});
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, http };
  }

  it('還沒有家長身分：只有一行「請洽補習班行政」，沒有啟用按鈕、不打任何啟用的 API', () => {
    const { el, http } = setup(['teacher']);
    expect(el.textContent).toContain('請洽補習班行政把你設為家長');
    expect(el.textContent).not.toContain('啟用家長身份');
    http.verify();
  });

  it('已經有家長身分：這一區不顯示', () => {
    const { el } = setup(['teacher', 'parent']);
    expect(el.textContent).not.toContain('請洽補習班行政');
  });
});

/** #1665 Q6′：本人可以改自己的對外暱稱；暱稱存在 staff 列上，所以只對人員身分顯示 */
describe('AccountSettingsDialogComponent —— 對外暱稱（#1665）', () => {
  async function setup(roles: UserRole[], nickname: string | null) {
    TestBed.configureTestingModule({
      imports: [AccountSettingsDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            roles: signal(roles),
            refreshRoles: vi.fn(),
            profile: () => null,
            user: () => null,
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountSettingsDialogComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/me')).flush({ nickname });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = () => el.querySelector<HTMLInputElement>('#account-nickname');
    return { fixture, http, input };
  }

  it('老師：帶出現有暱稱；儲存送去頭尾空白的值，清空送 null', async () => {
    const { fixture, http, input } = await setup(['teacher'], '王老師');
    await fixture.whenStable();
    expect(input()?.value).toBe('王老師');

    const save = (value: string) => {
      (fixture.componentInstance as unknown as { nickname: string }).nickname = value;
      (fixture.componentInstance as unknown as { saveNickname: () => void }).saveNickname();
      return http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/api/me')).request.body;
    };
    expect(save('  大文老師 ')).toEqual({ nickname: '大文老師' });
    expect(save('   ')).toEqual({ nickname: null });
  });

  it('只有家長身分：不顯示暱稱欄（沒有 staff 列可以寫）', async () => {
    const { input } = await setup(['parent'], null);
    expect(input()).toBeNull();
  });
});
