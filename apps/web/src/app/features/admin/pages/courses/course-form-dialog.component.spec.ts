import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef, DialogService } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { OverlayContainerService } from '@core/overlay-container.service';
import { CoursesService } from '@core/courses.service';
import { SubjectManagerComponent } from '@shared/components/subject-manager/subject-manager.component';
import { CourseFormDialogComponent } from './course-form-dialog.component';

describe('CourseFormDialogComponent', () => {
  let fixture: ComponentFixture<CourseFormDialogComponent>;
  let component: CourseFormDialogComponent;
  const dialogOpenMock = vi.fn(() => ({ onClose: of(undefined) }));
  const coursesServiceMock = {
    create: vi.fn(() => of({ data: { id: 'course-1' } })),
    update: vi.fn(() => of({ data: { id: 'course-1' }, cancelledFutureSessions: 0 })),
  };
  const messageServiceMock = {
    add: vi.fn(),
  };
  const dialogRefMock = {
    close: vi.fn(),
  };

  beforeEach(async () => {
    coursesServiceMock.create.mockClear();
    coursesServiceMock.update.mockClear();
    messageServiceMock.add.mockClear();
    dialogRefMock.close.mockClear();
    dialogOpenMock.mockClear();

    await TestBed.configureTestingModule({
      imports: [CourseFormDialogComponent],
      providers: [
        { provide: CoursesService, useValue: coursesServiceMock },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
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
              course: null,
              campuses: [{ id: 'campus-1', name: '示範分校', isActive: true }],
              subjects: [{ id: 'subject-1', name: '國文', sortOrder: 0 }],
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CourseFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('blocks save when grade levels are empty', () => {
    (
      component as unknown as {
        formData: { set: (value: unknown) => void };
        save: () => void;
      }
    ).formData.set({
      campusId: 'campus-1',
      name: '國文先修班',
      subjectId: 'subject-1',
      description: '',
      isActive: true,
      gradeLevels: [],
      deactivateMode: 'keep_sessions',
    });

    (component as unknown as { save: () => void }).save();

    expect(coursesServiceMock.create).not.toHaveBeenCalled();
    expect(messageServiceMock.add).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warn', summary: '請至少選擇一個學段' }),
    );
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
