import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef, DialogService } from 'primeng/dynamicdialog';
import { NEVER, of } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import { StaffService } from '@core/staff.service';
import { AuthService } from '@core/auth.service';
import { SubjectManagerComponent } from '@shared/components/subject-manager/subject-manager.component';
import { StaffFormDialogComponent } from './staff-form-dialog.component';

describe('StaffFormDialogComponent', () => {
  let fixture: ComponentFixture<StaffFormDialogComponent>;
  let component: StaffFormDialogComponent;
  const dialogOpenMock = vi.fn(() => ({ onClose: of(undefined) }));
  const closeMock = vi.fn();
  const staffServiceMock = {
    create: vi.fn(() => of({ data: { id: 'staff-1' }, loginUrl: 'https://x/verify?token=t' })),
    update: vi.fn(() => of({ data: { id: 'staff-1' } })),
  };

  beforeEach(async () => {
    dialogOpenMock.mockClear();
    closeMock.mockClear();
    staffServiceMock.create.mockClear();

    await TestBed.configureTestingModule({
      imports: [StaffFormDialogComponent],
      providers: [
        { provide: StaffService, useValue: staffServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: closeMock } },
        {
          provide: AuthService,
          useValue: { user: () => ({ id: 'me' }), hasPermission: () => true },
        },
        { provide: DialogService, useValue: { open: dialogOpenMock } },
        {
          provide: OverlayContainerService,
          useValue: {
            getContainer: () => 'body',
          },
        },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              staff: null,
              campuses: [{ id: 'campus-1', name: '示範分校' }],
              subjects: [{ id: 'subject-1', name: '國文', sortOrder: 0 }],
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StaffFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('opens subject manager with the overlay container', () => {
    (component as unknown as { openSubjectManager: () => void }).openSubjectManager();

    expect(dialogOpenMock).toHaveBeenCalledWith(
      SubjectManagerComponent,
      expect.objectContaining({
        appendTo: 'body',
      }),
    );
  });

  // 這個系統沒有密碼 —— loginUrl 是新員工唯一的進門方式。
  // PR #24 的後端回傳了它，但這裡 `ref.close(res.data)` 直接丟掉，
  // 頁面因此永遠開不出 QR。這條測試守住那個接縫。
  it('建立成功後把 loginUrl 一起交出去', () => {
    const c = component as unknown as {
      formData: { set: (v: unknown) => void };
      save: () => void;
    };
    c.formData.set({
      displayName: '王老師',
      nickname: ' 小王老師 ',
      email: 'teacher@example.com',
      phone: '0912345678',
      birthday: null,
      notes: '',
      campusIds: ['campus-1'],
      roles: ['admin'],
      subjectIds: [],
      status: 'active',
    });

    c.save();

    expect(staffServiceMock.create).toHaveBeenCalled();
    // #1665 Q6：對外暱稱去頭尾空白後送出
    expect((staffServiceMock.create as any).mock.calls[0][0].nickname).toBe('小王老師');
    // 新增管理員預設只給「日常行政」，其餘建完到權限設定改（#1314 ST2，計畫席 11-05 裁 (a)）
    expect((staffServiceMock.create as any).mock.calls[0][0].permissions).toEqual([
      'basic_operations',
    ]);
    expect(closeMock).toHaveBeenCalledWith({
      data: { id: 'staff-1' },
      loginUrl: 'https://x/verify?token=t',
    });
  });

  // 新增管理員的預設權限（#1314 ST2，計畫席 11-05 裁 (a)；審核席 #2324 二讀要求專門一條）
  describe('新增時的預設權限', () => {
    const create = (roles: string[], subjectIds: string[] = []) => {
      const c = component as unknown as {
        formData: { set: (v: unknown) => void };
        save: () => void;
      };
      c.formData.set({
        displayName: '新同事',
        nickname: '',
        email: 'new@example.com',
        phone: '0912345678',
        birthday: null,
        notes: '',
        campusIds: ['campus-1'],
        roles,
        subjectIds,
      });
      c.save();
      return (staffServiceMock.create as any).mock.calls.at(-1)[0] as { permissions: string[] };
    };

    it('新增管理員只給「日常行政」', () => {
      expect(create(['admin']).permissions).toEqual(['basic_operations']);
    });

    it('新增純老師不給任何權限（權限只掛在管理員角色上）', () => {
      expect(create(['teacher'], ['subject-1']).permissions).toEqual([]);
    });
  });

  /**
   * **#663：驗收條件不是「toast 有沒有出現」，是「不做任何額外操作能不能看出是哪一欄」。**
   *
   * 原本兩個回饋管道同時失效：toast 在畫面**對角**且壽命短於視線移動時間
   * （量測：等 1 秒看得到、等 4 秒什麼都沒有），欄位**沒有任何標記**。
   * 結果不是「提示不夠明顯」，是**驗證失敗這件事在畫面上不存在**。
   *
   * 所以這裡測的是**持久狀態**（`errors()`），不是 toast —— toast 只是輔助。
   */
  describe('驗證失敗要在欄位上留下持久標記（#663）', () => {
    const comp = () =>
      fixture.componentInstance as unknown as {
        errors: () => Record<string, string>;
        save: () => void;
        updateForm: (f: string, v: unknown) => void;
        toggleRole: (r: string, checked: boolean) => void;
        formData: () => { roles: string[] };
      };

    it('空表單送出後，錯誤留在欄位上（不是只有一閃而過的 toast）', () => {
      comp().save();

      const errs = comp().errors();
      expect(errs['displayName']).toBeDefined();
      expect(errs['email']).toBeDefined();
      expect(errs['campusIds']).toBeDefined();
      // A6 staff.html：電話必填；動作列左邊也寫出來
      expect(errs['phone']).toBeDefined();
      expect((comp() as unknown as { missingHint: () => string | null }).missingHint()).toContain(
        '電話',
      );
    });

    /**
     * **一次收集全部**，不是遇到第一個就停 —— 否則使用者要「修一個、再按一次、
     * 再發現下一個」，而每一輪都要重新經歷一次「看不到錯誤」。
     */
    it('一次收集全部錯誤，不是只回報第一個', () => {
      comp().save();

      expect(Object.keys(comp().errors()).length).toBeGreaterThan(1);
    });

    it('改動欄位就清掉它的錯誤 —— 錯誤是上次送出的狀態，不是永久標籤', () => {
      comp().save();
      expect(comp().errors()['displayName']).toBeDefined();

      comp().updateForm('displayName', '王小明');

      expect(comp().errors()['displayName']).toBeUndefined();
      // 其他欄位的錯誤還在
      expect(comp().errors()['campusIds']).toBeDefined();
    });

    /**
     * 取消老師角色之後，「請選擇教學科目」指向的欄位**已經從畫面上消失**了
     * （整區在 `@if (isTeacherRole())` 裡）—— 留著那個錯誤就是一個指向不存在
     * 欄位的訊息。
     */
    it('取消老師角色時，教學科目的錯誤跟著消失', () => {
      comp().toggleRole('teacher', true);
      comp().save();
      expect(comp().errors()['subjectIds']).toBeDefined();

      comp().toggleRole('teacher', false);

      expect(comp().errors()['subjectIds']).toBeUndefined();
    });

    /**
     * **#666：表單不預選任何角色。**
     *
     * 原本預設 `['teacher']`，於是每一個純行政都被靜默地記成老師 ——
     * 可用性測試席建的兩個純行政都變成 `老師 + 管理員`，而頁首統計把他們
     * 算進「90 老師」。**建立者不會發現**，他只是沒去取消一個預先勾好的框。
     *
     * 所以「沒選角色」必須是一個**會被擋下來、而且看得到是哪一欄**的狀態，
     * 不是一個悄悄替使用者決定的預設值。
     */
    it('新建表單不預選任何角色，未選角色送出會在角色欄留下錯誤', () => {
      expect(comp().formData().roles).toEqual([]);

      comp().save();

      expect(comp().errors()['roles']).toBe('請選擇角色');
      // 沒勾老師就不該要求教學科目 —— 那個欄位根本沒顯示
      expect(comp().errors()['subjectIds']).toBeUndefined();
      expect(staffServiceMock.create).not.toHaveBeenCalled();
    });
  });
});

/** 編輯表單不再帶權限（#1314 ST2 搬到權限設定）；角色勾選框依 API 規則提早停用（ST3／ST8） */
describe('StaffFormDialogComponent —— 編輯', () => {
  const update = vi.fn((_id: string, _input: unknown) => of({ data: { id: 'staff-1' } }));

  function setup(me: { id?: string; perms?: string[] } = {}) {
    update.mockClear();
    const perms = me.perms ?? ['*'];
    TestBed.configureTestingModule({
      imports: [StaffFormDialogComponent],
      providers: [
        { provide: StaffService, useValue: { update } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        {
          provide: AuthService,
          useValue: {
            user: () => ({ id: me.id ?? 'me' }),
            hasPermission: (p: string) => perms.includes(p) || perms.includes('*'),
          },
        },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: OverlayContainerService, useValue: { getContainer: () => 'body' } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              staff: {
                id: 'staff-1',
                userId: 'user-boss',
                displayName: '老闆',
                email: 'boss@example.com',
                campusIds: ['campus-1'],
                subjectIds: [],
                roles: ['admin'],
                permissions: ['*'],
              },
              campuses: [{ id: 'campus-1', name: '示範分校' }],
              subjects: [],
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(StaffFormDialogComponent);
    fixture.detectChanges();
    return {
      fixture,
      c: fixture.componentInstance as unknown as {
        save: () => void;
        toggleRole: (r: string, checked: boolean) => void;
      },
    };
  }

  it('編輯沒有電話的人員：照樣存得了，電話欄下面提示補上', () => {
    const { fixture } = setup();
    const c = fixture.componentInstance as unknown as {
      updateForm: (field: string, value: unknown) => void;
      save: () => void;
    };
    c.updateForm('phone', '');
    c.save();
    fixture.detectChanges();

    expect(update).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('還沒有電話，建議補上');
  });

  it('共用殼（#2290）：送出鈕在 form 外但指回表單；Enter（隱式送出）只送一次，送出中再按不重送', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    const form = el.querySelector('form')!;
    const submit = el.querySelector<HTMLButtonElement>('button[form="staff-form"]')!;

    expect(form.contains(submit)).toBe(false);
    expect(submit.form).toBe(form);
    update.mockReturnValueOnce(NEVER as never); // 讓請求停在送出中
    form.requestSubmit();
    form.requestSubmit();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('存檔不帶 permissions（API 不動）；角色沒變也不帶 roles', () => {
    const { c } = setup();
    c.save();

    const sent = update.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('permissions');
    expect(sent).not.toHaveProperty('roles');
  });

  it('角色有變才帶 roles', () => {
    const { c } = setup();
    c.toggleRole('teacher', true);
    // 老師要選科目，不然驗證擋下
    (c as unknown as { updateForm: (f: string, v: unknown) => void }).updateForm('subjectIds', [
      'subject-1',
    ]);
    c.save();

    expect(update.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ roles: ['admin', 'teacher'] }),
    );
  });

  const roleBox = (el: HTMLElement, role: string) =>
    el.querySelector<HTMLInputElement>(`#role_${role}`)!;
  const note = (el: HTMLElement) => el.querySelector('[data-testid="role-note"]')?.textContent;

  it('改自己（沒有 *）：兩個角色都停用並寫原因', async () => {
    const { fixture } = setup({ id: 'user-boss', perms: ['manage_roles'] });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(roleBox(el, 'admin').disabled).toBe(true);
    expect(roleBox(el, 'teacher').disabled).toBe(true);
    expect(note(el)).toContain('不能加上或拿掉自己的管理員角色');
  });

  it('改自己（持 *）：只有管理員停用，老師可以改', async () => {
    const { fixture } = setup({ id: 'user-boss', perms: ['*'] });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(roleBox(el, 'admin').disabled).toBe(true);
    expect(roleBox(el, 'teacher').disabled).toBe(false);
  });

  it('沒有 manage_roles：別人的角色只能看', async () => {
    const { fixture } = setup({ perms: ['manage_staff'] });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(roleBox(el, 'admin').disabled).toBe(true);
    expect(note(el)).toContain('你沒有「角色管理」權限');
  });

  it('Email 是表單裡的唯讀欄位、欄下寫為什麼不能改；編輯沒有副標（R5：使用者 11-05）', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    const email = el.querySelector<HTMLInputElement>('#staff-email')!;

    expect(email.readOnly).toBe(true);
    expect(email.value).toBe('boss@example.com');
    expect(el.querySelector('#' + email.getAttribute('aria-describedby'))?.textContent).toContain(
      '產生登入連結的查人鍵，不能改',
    );
    expect(el.querySelector('.dialog-header-inline__sub')).toBeNull();
  });

  it('沒有權限勾選區塊（搬到權限設定）', () => {
    const { fixture } = setup();
    expect((fixture.nativeElement as HTMLElement).querySelector('[id^="perm_"]')).toBeNull();
  });
});
