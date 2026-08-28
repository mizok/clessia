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
});
