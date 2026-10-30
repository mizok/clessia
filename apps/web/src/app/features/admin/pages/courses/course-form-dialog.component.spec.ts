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
    // A6 `.fdlg__why`：不跳 toast，動作列左邊寫還差什麼
    expect((component as unknown as { missingHint: () => string | null }).missingHint()).toBe(
      '還沒填：適合年級',
    );
  });

  it('新增時科目先空著，狀態選「停用」會帶 isActive: false 建立（A6 .fdlg__opt）', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect((component as unknown as { missingHint: () => string | null }).missingHint()).toContain(
      '科目',
    );

    const off = [...el.querySelectorAll<HTMLLabelElement>('[role=radiogroup] label')].find(
      (l) => l.textContent?.trim() === '停用',
    );
    off!.querySelector('input')!.click();
    (
      component as unknown as { formData: { update: (fn: (f: object) => object) => void } }
    ).formData.update((f) => ({
      ...f,
      subjectId: 'subject-1',
      name: '國文先修班',
      gradeLevels: ['J1'],
    }));
    (component as unknown as { save: () => void }).save();

    expect(coursesServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: 'subject-1', isActive: false }),
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
