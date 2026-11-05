import { TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AuthService } from '@core/auth.service';
import { PERMISSIONS, StaffService, type HeldPermission } from '@core/staff.service';
import { PermissionDialogComponent } from './permission-dialog.component';

/**
 * 權限設定（#1314 ST2／ST3／ST8）。寫入只帶 `permissions`；停用規則同 API（`role-assignment.ts`、
 * `grantsWiderThanScope`），畫面只是提早說明。
 */
describe('PermissionDialogComponent', () => {
  const update = vi.fn((_id: string, _input: unknown) => of({ data: { id: 'staff-1' } }));
  const close = vi.fn();

  function setup(target: HeldPermission[], me: { id?: string; perms?: string[] } = {}) {
    update.mockClear();
    close.mockClear();
    const perms = me.perms ?? ['*'];
    TestBed.configureTestingModule({
      imports: [PermissionDialogComponent],
      providers: [
        { provide: StaffService, useValue: { update } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close } },
        {
          provide: AuthService,
          useValue: {
            user: () => ({ id: me.id ?? 'me' }),
            hasPermission: (p: string) => perms.includes(p) || perms.includes('*'),
          },
        },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              staff: {
                id: 'staff-1',
                userId: 'user-x',
                displayName: '張教務',
                permissions: target,
              },
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(PermissionDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const box = (p: string) =>
      el.querySelector<HTMLInputElement>(`[data-permission="${p}"] input`)!;
    const click = (p: string) => {
      box(p).click();
      fixture.detectChanges();
    };
    const save = () => el.querySelector<HTMLButtonElement>('[data-testid="permission-save"]');
    return { fixture, el, box, click, save };
  }

  const sent = () => (update.mock.calls[0]?.[1] as { permissions: string[] }).permissions;

  it('整張詞彙表都有一格，每格有中文名稱與說明（#772：manage_org_settings 授得出來）', () => {
    const { el } = setup([]);
    const items = [...el.querySelectorAll<HTMLElement>('[data-permission]')];

    expect(items.map((i) => i.dataset['permission'])).toEqual([...PERMISSIONS]);
    for (const item of items) {
      expect(item.querySelector('b')?.textContent?.trim()).toBeTruthy();
      expect(item.querySelector('small')?.textContent?.trim()).toBeTruthy();
    }
  });

  it('勾一項存檔：只帶 permissions，關掉時交回新資料', () => {
    const { click, save } = setup(['basic_operations']);
    click('view_reports');
    save()!.click();

    expect(update).toHaveBeenCalledWith('staff-1', {
      permissions: ['basic_operations', 'view_reports'],
    });
    expect(close).toHaveBeenCalledWith({ id: 'staff-1' });
  });

  it('`*`：每格都勾著，沒動就原樣送回；取消一項展開成逐項清單（#1829）', () => {
    const a = setup(['*']);
    expect(PERMISSIONS.every((p) => a.box(p).checked)).toBe(true);
    a.save()!.click();
    expect(sent()).toEqual(['*']);

    TestBed.resetTestingModule();
    const b = setup(['*']);
    b.click('manage_finance');
    b.save()!.click();
    expect(sent()).toEqual(PERMISSIONS.filter((p) => p !== 'manage_finance'));
  });

  it('ST3 打開自己：整張停用、寫原因、沒有儲存鈕', () => {
    const { el, box, save } = setup(['basic_operations'], { id: 'user-x' });

    expect(el.querySelector('[data-testid="permission-lock"]')?.textContent).toContain(
      '任何人都不能改自己的權限',
    );
    expect(PERMISSIONS.every((p) => box(p).disabled)).toBe(true);
    expect(save()).toBeNull();
  });

  it('ST8 沒有 manage_roles：只能看', () => {
    const { el, box, save } = setup(['basic_operations'], { perms: ['manage_staff'] });

    expect(el.querySelector('[data-testid="permission-lock"]')?.textContent).toContain(
      '你沒有「角色管理」權限，只能查看',
    );
    expect(box('basic_operations').disabled).toBe(true);
    expect(save()).toBeNull();
  });

  it('我自己沒有的權限：不能勾上、寫原因；已勾的照樣能取消', () => {
    const { el, box } = setup(['manage_finance'], {
      perms: ['manage_roles', 'basic_operations', 'all_campuses'],
    });
    const hint = (p: string) => el.querySelector(`[data-permission="${p}"] small`)?.textContent;

    expect(box('view_reports').disabled).toBe(true);
    expect(hint('view_reports')).toContain('你沒有這個權限，不能發給別人');
    expect(box('manage_finance').disabled).toBe(false);
    expect(box('basic_operations').disabled).toBe(false);
  });

  it('我受分校限制、對方有跨分校：整張停用（原樣送回 API 也會擋）', () => {
    const { el, save } = setup(['all_campuses'], { perms: ['manage_roles', 'all_campuses_x'] });

    expect(el.querySelector('[data-testid="permission-lock"]')?.textContent).toContain(
      '你的範圍受分校限制',
    );
    expect(save()).toBeNull();
  });

  it('我受分校限制、對方持 *：寫「全部權限」，不寫跨分校', () => {
    const { el } = setup(['*'], { perms: ['manage_roles'] });

    const lock = el.querySelector('[data-testid="permission-lock"]')?.textContent;
    expect(lock).toContain('他有全部權限');
    expect(lock).not.toContain('跨分校');
  });
});
