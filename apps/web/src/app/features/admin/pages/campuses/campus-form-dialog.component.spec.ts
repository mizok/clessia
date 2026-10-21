import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { MessageService } from 'primeng/api';

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

function setup(permissions: string[], campus: Campus | null = CAMPUS) {
  const update = vi.fn((_id: string, _input: unknown) => of({ data: CAMPUS }));
  const create = vi.fn((_input: unknown) => of({ data: CAMPUS }));
  const add = vi.fn();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const proto = HTMLDialogElement.prototype as any;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  TestBed.configureTestingModule({
    imports: [CampusFormDialogComponent],
    providers: [
      { provide: CampusesService, useValue: { update, create } },
      { provide: MessageService, useValue: { add } },
      {
        provide: AuthService,
        useValue: {
          hasPermission: (p: string) => permissions.includes(p) || permissions.includes('*'),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(CampusFormDialogComponent);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentInstance.open(campus);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const cmp = fixture.componentInstance as any;
  const save = () => cmp.save();
  const type = (id: string, value: string) => {
    const input = el.querySelector(`#${id}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  return { el, fixture, cmp, update, create, add, closed, save, type };
}

/**
 * #1073：分校的帳戶資訊覆寫。改它要 `manage_finance`（改帳號＝改家長匯款的去向）——
 * 沒有那個權限的管理員看不到欄位，送出的 body 也不帶這個 key（帶了 API 會 403，整張表單存不了）。
 */
describe('CampusFormDialogComponent —— 帳戶資訊（#1073）', () => {
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
 * #1314 SE3：A6 campusForm 的標題、狀態、出勤紀錄模式、底部提示。
 * 出勤模式跟機構預設同一個門檻 `manage_org_settings`（#1112）—— 沒有的人不出欄位、body 不帶 key。
 */
describe('CampusFormDialogComponent —— A6 campusForm（#1314 SE3）', () => {
  it('標題照稿：編輯「編輯分校：名稱」；新增「新增分校」＋副標', () => {
    expect(setup([]).el.querySelector('h2')!.textContent!.trim()).toBe('編輯分校：中正');
    TestBed.resetTestingModule();
    const { el } = setup([], null);
    expect(el.querySelector('h2')!.textContent!.trim()).toBe('新增分校');
    expect(el.textContent).toContain('建好之後就可以在這個分校開課');
  });

  it('有 manage_org_settings：出現選單；「沿用機構預設」送 null，選日到班送 daily_checkin', () => {
    const { el, cmp, update, save } = setup(['manage_org_settings']);
    expect(el.textContent).toContain('出勤紀錄模式');

    save();
    expect(update.mock.calls[0]?.[1]).toMatchObject({ attendanceMode: null });

    cmp.attendanceMode.set('daily_checkin');
    cmp.loading.set(false);
    save();
    expect(update.mock.calls[1]?.[1]).toMatchObject({ attendanceMode: 'daily_checkin' });
  });

  it('編輯：出勤模式帶分校目前的值 —— 只改電話就存，不會悄悄改回沿用預設', () => {
    const { update, save, type } = setup(['manage_org_settings'], {
      ...CAMPUS,
      attendanceMode: 'per_session',
    });
    type('campus-phone', '02-1234-5678');
    save();
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      phone: '02-1234-5678',
      attendanceMode: 'per_session',
    });
  });

  it('沒有 manage_org_settings：沒有選單，body 不帶 attendanceMode', () => {
    const { el, update, save } = setup([]);

    expect(el.textContent).not.toContain('出勤紀錄模式');
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

  it('新增：狀態預設啟用；有權限就出出勤模式與帳戶（A6 新增表單就有）；成功關掉並帶回那一筆', () => {
    const { el, create, closed, add, save, type } = setup(['*'], null);
    expect(el.textContent).toContain('出勤紀錄模式');
    expect(el.querySelector('textarea')).not.toBeNull();

    type('campus-name', ' 新分校 ');
    save();
    expect(create.mock.calls[0]?.[0]).toEqual({
      name: '新分校',
      address: null,
      phone: null,
      isActive: true,
      attendanceMode: null,
      paymentInfo: null,
    });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ summary: '已新增分校「新分校」' }));
    expect(closed).toHaveBeenCalledWith(CAMPUS);
  });

  it('新增、沒有細部權限：不出兩欄，body 不帶 key', () => {
    const { el, create, save, type } = setup([], null);
    expect(el.textContent).not.toContain('出勤紀錄模式');
    expect(el.querySelector('textarea')).toBeNull();
    type('campus-name', '新分校');
    save();
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('attendanceMode');
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('paymentInfo');
  });

  it('名稱沒填：送出鈕不鎖、寫出還差什麼，不送請求', () => {
    const { el, create, fixture, save, type } = setup([], null);
    type('campus-name', '   ');
    save();
    fixture.detectChanges();
    expect(create).not.toHaveBeenCalled();
    expect(el.textContent).toContain('還沒填：分校名稱');
  });

  it('失敗：訊息寫在底部，不關、填的不清；取消關掉帶 null', () => {
    const { el, fixture, cmp, create, closed, save, type } = setup([], null);
    create.mockReturnValueOnce(
      throwError(() => ({ error: { error: '此組織已有同名分校' } })) as never,
    );
    type('campus-name', '中正');
    save();
    fixture.detectChanges();
    expect(el.textContent).toContain('此組織已有同名分校');
    expect(closed).not.toHaveBeenCalled();
    expect((el.querySelector('#campus-name') as HTMLInputElement).value).toBe('中正');

    cmp.close();
    expect(closed).toHaveBeenCalledWith(null);
  });
});
