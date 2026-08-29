import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';

import { AuthService, type UserRole } from '@core/auth.service';
import { DeviceService } from '@core/device.service';
import { ShellLayoutComponent } from './shell-layout.component';

/**
 * Header 的角色徽章是**多角色使用者最常用的切換入口**。
 *
 * #34 把它從彈窗改成 `routerLink="/select-role"`，於是切個身分要走一整趟頁面 ——
 * 那是退步。現在改成就地開 popover：零導航、零動態載入。
 *
 * `/select-role` 路由與它的彈窗**不受影響** —— 那條路服務的是登入後的初選與 guard
 * 的落點，跟 header 的快速切換是兩個場景。
 */
/** shell-layout 底下的 InheritSizeDirective 需要它；jsdom 沒有（專案既有慣例是各 spec 自備） */
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function stubAuth(roles: UserRole[], activeRole: UserRole | null) {
  return {
    roles: signal<UserRole[]>(roles),
    activeRole: signal<UserRole | null>(activeRole),
    profile: signal({ id: 'u1', display_name: '王主任', branch_id: null }),
    user: signal({ id: 'u1', email: 'a@example.com' }),
    permissions: signal<string[]>(['*']),
    hasPermission: () => true,
    navigateToRoleShell: vi.fn(),
    signOut: vi.fn(),
  };
}

async function setup(roles: UserRole[], activeRole: UserRole | null, touch = false) {
  const auth = stubAuth(roles, activeRole);
  TestBed.configureTestingModule({
    imports: [ShellLayoutComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideAnimationsAsync(),
      providePrimeNG({}),
      { provide: AuthService, useValue: auth },
      { provide: DeviceService, useValue: { isTouchDevice: signal(touch) } },
    ],
  });
  const fixture = TestBed.createComponent(ShellLayoutComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, auth };
}

function badge(fixture: { nativeElement: HTMLElement }): HTMLElement | null {
  return fixture.nativeElement.querySelector('.shell-header__role-badge');
}

function switchItems(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll('.role-switch__item'));
}

describe('ShellLayoutComponent —— header 的角色快速切換', () => {
  let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      originalResizeObserver;
  });

  afterEach(() => {
    document.body.querySelectorAll('.p-popover').forEach((n) => n.remove());
  });

  it('多角色：點徽章就地開 popover，列出「其他」角色（不含目前這個）', async () => {
    const { fixture } = await setup(['admin', 'teacher', 'parent'], 'admin');

    badge(fixture)?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(switchItems().map((b) => b.textContent?.trim())).toEqual(['任課老師', '家長']);
  });

  it('點清單裡的角色 → 交給 auth.navigateToRoleShell，不經過任何路由跳轉', async () => {
    const { fixture, auth } = await setup(['admin', 'teacher'], 'admin');

    badge(fixture)?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    switchItems()[0]?.click();

    expect(auth.navigateToRoleShell).toHaveBeenCalledWith('teacher');
  });

  /** 只有一個角色的人沒有東西可切，徽章是純顯示 —— 不該長得像可以點。 */
  it('單角色：徽章不是按鈕', async () => {
    const { fixture } = await setup(['teacher'], 'teacher');

    expect(badge(fixture)?.tagName).toBe('SPAN');
  });

  it('徽章不再導向 /select-role —— 那趟頁面就是這次要修掉的退步', async () => {
    const { fixture } = await setup(['admin', 'teacher'], 'admin');

    expect(badge(fixture)?.getAttribute('href')).toBeNull();
    expect(badge(fixture)?.getAttribute('ng-reflect-router-link')).toBeNull();
  });
});
