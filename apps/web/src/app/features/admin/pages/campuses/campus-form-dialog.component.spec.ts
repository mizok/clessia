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
  attendanceMode: null,
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
    expect(el.textContent).toContain('收款帳戶');

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

/**
 * #1314 SE3：A6 campusForm 的「狀態」與「出勤紀錄模式」。
 * 出勤模式跟機構預設同一個門檻 `manage_org_settings`（#1112）—— 沒有的人不出欄位、body 不帶 key
 * （帶了 API 403，改名也存不了）。選「沿用機構預設」送 null。
 */
describe('CampusFormDialogComponent —— 狀態與出勤模式（#1314 SE3）', () => {
  function setup(permissions: string[], campus: Campus | null = CAMPUS) {
    const update = vi.fn((_id: string, _input: unknown) => of({ data: CAMPUS }));
    const create = vi.fn((_input: unknown) => of({ data: CAMPUS }));
    TestBed.configureTestingModule({
      imports: [CampusFormDialogComponent],
      providers: [
        { provide: CampusesService, useValue: { update, create } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: campus ? { campus } : {} } },
        {
          provide: AuthService,
          useValue: { hasPermission: (p: string) => permissions.includes(p) },
        },
      ],
    });
    const fixture = TestBed.createComponent(CampusFormDialogComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const save = () => (fixture.componentInstance as unknown as { save: () => void }).save();
    return { el, fixture, update, create, save };
  }

  it('有 manage_org_settings：出現選單；選「沿用機構預設」送 null，選日到班送 daily_checkin', async () => {
    const { el, fixture, update, save } = setup(['manage_org_settings']);
    const select = el.querySelector('#campus-attendance-mode') as HTMLSelectElement;
    expect(select).not.toBeNull();

    save();
    expect(update.mock.calls[0]?.[1]).toMatchObject({ attendanceMode: null });

    select.value = 'daily_checkin';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    save();
    expect(update.mock.calls[1]?.[1]).toMatchObject({ attendanceMode: 'daily_checkin' });
  });

  it('沒有 manage_org_settings：沒有選單，body 不帶 attendanceMode', () => {
    const { el, update, save } = setup([]);

    expect(el.querySelector('#campus-attendance-mode')).toBeNull();
    save();
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('attendanceMode');
  });

  it('狀態選停用：送 isActive false', () => {
    const { el, fixture, update, save } = setup([]);
    const off = [...el.querySelectorAll<HTMLInputElement>('input[name="campus-status"]')].find(
      (r) => r.parentElement?.textContent?.includes('停用'),
    )!;
    expect(off.checked).toBe(false);

    off.click();
    fixture.detectChanges();
    save();
    expect(update.mock.calls[0]?.[1]).toMatchObject({ isActive: false });
  });

  it('新增時也有狀態，預設啟用；不出出勤模式（建立的 API 不收）', () => {
    const { el, create, save } = setup(['manage_org_settings'], null);
    expect(el.querySelector('#campus-attendance-mode')).toBeNull();

    (el.querySelector('input[pInputText]') as HTMLInputElement).value = '新分校';
    el.querySelector('input[pInputText]')!.dispatchEvent(new Event('input'));
    save();
    expect(create.mock.calls[0]?.[0]).toMatchObject({ name: '新分校', isActive: true });
  });
});
