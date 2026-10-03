import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { AuthService } from '@core/auth.service';
import { CampusesService, type Campus } from '@core/campuses.service';
import { CampusFormDialogComponent } from './campus-form-dialog.component';

const CAMPUS: Campus = {
  id: 'cp-1',
  orgId: 'org-1',
  name: '中正',
  address: null,
  phone: null,
  isActive: true,
  paymentInfo: '中正專戶',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

/**
 * #1073：分校的帳戶資訊覆寫。改它要 `manage_finance`（改帳號＝改家長匯款的去向）——
 * 沒有那個權限的管理員看不到欄位，送出的 body 也不帶這個 key（帶了 API 會 403，整張表單存不了）。
 */
describe('CampusFormDialogComponent —— 帳戶資訊（#1073）', () => {
  function setup(permissions: string[]) {
    const update = vi.fn((_id: string, _input: unknown) => of({ data: CAMPUS }));
    TestBed.configureTestingModule({
      imports: [CampusFormDialogComponent],
      providers: [
        { provide: CampusesService, useValue: { update, create: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: { campus: CAMPUS } } },
        {
          provide: AuthService,
          useValue: {
            hasPermission: (p: string) => permissions.includes(p) || permissions.includes('*'),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(CampusFormDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const save = () => (fixture.componentInstance as unknown as { save: () => void }).save();
    return { el, update, save };
  }

  it('有 manage_finance：看得到欄位（帶分校目前的值），儲存送 paymentInfo', () => {
    const { el, update, save } = setup(['manage_finance']);

    const textarea = el.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    expect(el.textContent).toContain('帳戶資訊');

    save();
    expect(update).toHaveBeenCalledWith(
      'cp-1',
      expect.objectContaining({ paymentInfo: '中正專戶' }),
    );
  });

  it('沒有 manage_finance：沒有欄位，body 不帶 paymentInfo', () => {
    const { el, update, save } = setup(['manage_org_settings']);

    expect(el.querySelector('textarea')).toBeNull();

    save();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('paymentInfo');
  });
});
