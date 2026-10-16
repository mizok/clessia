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
 * #1631：啟用家長身份成功後，畫面要**立刻**反映 —— 用 API 回傳的角色，不重抓 /api/me
 * （重抓可能讀到 API 身分快取裡的舊角色，整區不變，使用者以為沒有作用）。
 */
describe('AccountSettingsDialogComponent —— 啟用家長身份（#1631）', () => {
  function setup() {
    const roles = signal<UserRole[]>(['admin']);
    const auth = {
      roles,
      adoptRoles: vi.fn((r: UserRole[]) => roles.set(r)),
      refreshRoles: vi.fn(),
      profile: () => null,
      user: () => null,
    };
    const add = vi.fn();
    TestBed.configureTestingModule({
      imports: [AccountSettingsDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
        { provide: MessageService, useValue: { add } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(AccountSettingsDialogComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/api/me')).flush({});
    const activate = () =>
      (fixture.componentInstance as unknown as { activateParent: () => void }).activateParent();
    return { fixture, http, auth, add, activate };
  }

  it('成功：採用回傳的角色、跳 toast、整區消失（不能再按一次），不重抓 /api/me', () => {
    const { fixture, http, auth, add, activate } = setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('啟用家長身份');

    activate();
    http
      .expectOne((r) => r.url.endsWith('/api/me/activate-parent'))
      .flush({
        roles: ['admin', 'parent'],
      });
    fixture.detectChanges();

    expect(auth.adoptRoles).toHaveBeenCalledWith(['admin', 'parent']);
    expect(auth.refreshRoles).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    expect(el.textContent).not.toContain('啟用家長身份');
    http.verify();
  });

  it('失敗：角色不變、顯示錯誤、按鈕還在', () => {
    const { fixture, http, auth, add, activate } = setup();
    const el = fixture.nativeElement as HTMLElement;

    activate();
    http
      .expectOne((r) => r.url.endsWith('/api/me/activate-parent'))
      .flush({ error: 'x' }, { status: 500, statusText: 'err' });
    fixture.detectChanges();

    expect(auth.adoptRoles).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(el.textContent).toContain('啟用失敗');
    expect(el.textContent).toContain('啟用家長身份');
  });
});
