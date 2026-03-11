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
  const staffServiceMock = {
    create: vi.fn(() => of({ data: { id: 'staff-1' } })),
    update: vi.fn(() => of({ data: { id: 'staff-1' } })),
  };

  beforeEach(async () => {
    dialogOpenMock.mockClear();

    await TestBed.configureTestingModule({
      imports: [StaffFormDialogComponent],
      providers: [
        { provide: StaffService, useValue: staffServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
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
});
