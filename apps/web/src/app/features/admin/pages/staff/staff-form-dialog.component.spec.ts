import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef, DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import { StaffService } from '@core/staff.service';
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
      email: 'teacher@example.com',
      phone: '',
      birthday: null,
      notes: '',
      campusIds: ['campus-1'],
      roles: ['admin'],
      permissions: [],
      subjectIds: [],
      status: 'active',
    });

    c.save();

    expect(staffServiceMock.create).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalledWith({
      data: { id: 'staff-1' },
      loginUrl: 'https://x/verify?token=t',
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
     * 表單預設 `roles: ['teacher']`（#663 的 ② 真正的成因）。取消老師角色之後，
     * 「請選擇教學科目」指向的欄位**已經從畫面上消失**了 ——
     * 留著那個錯誤就是一個指向不存在欄位的訊息。
     */
    it('取消老師角色時，教學科目的錯誤跟著消失', () => {
      comp().save();
      expect(comp().errors()['subjectIds']).toBeDefined();

      comp().toggleRole('teacher', false);

      expect(comp().errors()['subjectIds']).toBeUndefined();
    });
  });
});
