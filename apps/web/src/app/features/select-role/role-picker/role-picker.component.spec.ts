import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

import { AuthService, type UserRole } from '@core/auth.service';
import { RolePickerComponent } from './role-picker.component';

function stubAuth(roles: UserRole[], activeRole: UserRole | null = null) {
  return {
    roles: signal<UserRole[]>(roles),
    activeRole: signal<UserRole | null>(activeRole),
    profile: signal({ id: 'u1', display_name: '王主任', branch_id: null }),
    user: signal({ id: 'u1', email: 'a@example.com' }),
  };
}

async function setup(roles: UserRole[], activeRole: UserRole | null = null) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    imports: [RolePickerComponent],
    providers: [
      { provide: AuthService, useValue: stubAuth(roles, activeRole) },
      { provide: DynamicDialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(RolePickerComponent);
  await fixture.whenStable();
  return { fixture, close };
}

describe('RolePickerComponent（彈窗內容）', () => {
  it('只列出這個帳號真的有的角色', async () => {
    const { fixture } = await setup(['teacher', 'parent']);

    expect(fixture.componentInstance.roleOptions().map((o) => o.role)).toEqual([
      'teacher',
      'parent',
    ]);
  });

  it('選了角色就把它交還給開窗方 —— 導向邏輯不寫在彈窗裡', async () => {
    const { fixture, close } = await setup(['admin', 'teacher']);

    fixture.componentInstance.selectRole('teacher');

    expect(close).toHaveBeenCalledWith('teacher');
  });

  /**
   * 沒選角色就沒有下一步，所以這個彈窗沒有「關閉」的出口。
   * 這條測試存在是為了擋住「順手加一顆 X 比較好看」的未來修改。
   */
  it('沒有任何關閉按鈕 —— 沒選角色就沒有下一步', async () => {
    const { fixture } = await setup(['admin', 'teacher']);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[aria-label="關閉"]')).toBeNull();
    expect(host.querySelectorAll('button').length).toBe(2); // 兩個角色，沒有第三顆
  });

  it('目前的角色標示出來，讓切換角色的人知道自己在哪', async () => {
    const { fixture } = await setup(['admin', 'teacher'], 'admin');
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.role-picker__option--active')).toBeTruthy();
  });
});
