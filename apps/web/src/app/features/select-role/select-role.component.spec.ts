import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';

import { AuthService, type UserRole } from '@core/auth.service';
import { SelectRoleComponent } from './select-role.component';

/**
 * 這頁是「路由骨架 + 彈窗長相」：`/select-role` 仍是唯一入口（LINE callbackURL、
 * guest.guard、role.guard、shell 的切換角色都指向它，#34 修好的無限重導向不回歸），
 * 但使用者看到的是彈窗。
 *
 * PrimeNG 的 dialog 依賴樹是**動態 import** 的 —— 那是初始 bundle 維持 575 kB 的
 * 唯一理由，所以「彈窗真的開得起來」必須有測試守著，不能只靠人工點。
 *
 * 沒有「離開」測試了：彈窗不可略過（沒選角色就沒有下一步），這是刻意的設計改變。
 * 角色清單本身的行為在 role-picker.component.spec.ts。
 */
function stubAuth(roles: UserRole[]) {
  return {
    roles: signal<UserRole[]>(roles),
    activeRole: signal<UserRole | null>(null),
    profile: signal({ id: 'u1', display_name: '王主任', branch_id: null }),
    user: signal({ id: 'u1', email: 'a@example.com' }),
    navigateToRoleShell: vi.fn(),
  };
}

async function setup(roles: UserRole[] = ['admin', 'teacher']) {
  const auth = stubAuth(roles);
  TestBed.configureTestingModule({
    imports: [SelectRoleComponent],
    providers: [
      provideRouter([]),
      provideAnimationsAsync(),
      providePrimeNG({}),
      { provide: AuthService, useValue: auth },
    ],
  });
  const fixture = TestBed.createComponent(SelectRoleComponent);
  fixture.detectChanges();
  // 真的去載模組，不是 mock —— 等到彈窗出現為止，這正是這組測試要守的東西
  await waitFor(() => !!pickerEl());
  fixture.detectChanges();
  return { fixture, auth };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

function pickerEl(): HTMLElement | null {
  return document.body.querySelector('.role-picker');
}

describe('SelectRoleComponent（薄殼 + 動態載入的彈窗）', () => {
  afterEach(() => {
    document.body.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
  });

  it('進場就把角色彈窗開起來 —— 動態 import 的路徑是活的', async () => {
    await setup();

    expect(pickerEl()).toBeTruthy();
  });

  /**
   * 沒選角色就沒有下一步。Esc 若能關掉，使用者會落在一個只剩品牌底、
   * 什麼都不能做的空白頁上。
   */
  it('Esc 關不掉彈窗', async () => {
    await setup();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(pickerEl()).toBeTruthy();
  });

  it('點 backdrop 關不掉彈窗', async () => {
    await setup();

    (document.body.querySelector('.p-dialog-mask') as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(pickerEl()).toBeTruthy();
  });

  it('彈窗回傳角色後，導向交給 AuthService —— 邏輯只有一份', async () => {
    const { fixture, auth } = await setup();

    fixture.componentInstance.onRoleChosen('teacher');

    expect(auth.navigateToRoleShell).toHaveBeenCalledWith('teacher');
  });
});
