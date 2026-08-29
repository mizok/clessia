import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AuthService, type UserRole } from '@core/auth.service';
import { SelectRoleComponent } from './select-role.component';

/**
 * 這頁從 DynamicDialog 改成路由頁（`/select-role`）之後，「離開」不再是 `ref.close()`。
 * 沒有 activeRole 的人是被 guard 趕來這裡的 —— 給他一個「關閉」而不給去處，
 * 等於把人鎖在一個沒有出口的畫面上。
 */
function stubAuth(over: { roles?: UserRole[]; activeRole?: UserRole | null } = {}) {
  return {
    roles: signal<UserRole[]>(over.roles ?? ['admin', 'teacher']),
    activeRole: signal<UserRole | null>(over.activeRole ?? null),
    profile: signal({ id: 'u1', display_name: '王主任', branch_id: null }),
    user: signal({ id: 'u1', email: 'a@example.com' }),
    navigateToRoleShell: vi.fn(),
    signOut: vi.fn(),
  };
}

async function setup(auth: ReturnType<typeof stubAuth>) {
  TestBed.configureTestingModule({
    imports: [SelectRoleComponent],
    providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
  });
  const fixture = TestBed.createComponent(SelectRoleComponent);
  await fixture.whenStable();
  return fixture;
}

describe('SelectRoleComponent（路由頁）', () => {
  it('只列出這個帳號真的有的角色', async () => {
    const auth = stubAuth({ roles: ['teacher', 'parent'] });
    const fixture = await setup(auth);

    const labels = fixture.componentInstance.roleOptions().map((o) => o.role);
    expect(labels).toEqual(['teacher', 'parent']);
  });

  it('選了角色就交給 auth.navigateToRoleShell —— 導向邏輯只有一份', async () => {
    const auth = stubAuth();
    const fixture = await setup(auth);

    fixture.componentInstance.selectRole('teacher');

    expect(auth.navigateToRoleShell).toHaveBeenCalledWith('teacher');
  });

  it('還沒選過角色時，離開這頁等於登出 —— 否則使用者無處可去', async () => {
    const auth = stubAuth({ activeRole: null });
    const fixture = await setup(auth);

    fixture.componentInstance.leave();

    expect(auth.signOut).toHaveBeenCalled();
  });

  it('已經有角色時（從 shell 進來切換），離開回到原本的 shell', async () => {
    const auth = stubAuth({ activeRole: 'admin' });
    const fixture = await setup(auth);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.leave();

    expect(navigate).toHaveBeenCalledWith(['/admin']);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
