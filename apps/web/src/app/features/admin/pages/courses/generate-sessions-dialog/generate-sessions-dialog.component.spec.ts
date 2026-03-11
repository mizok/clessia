import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { BrowserStateService } from '@core/browser-state.service';
import { ClassesService } from '@core/classes.service';
import { GenerateSessionsDialogComponent } from './generate-sessions-dialog.component';

describe('GenerateSessionsDialogComponent', () => {
  let fixture: ComponentFixture<GenerateSessionsDialogComponent>;
  let component: GenerateSessionsDialogComponent;
  const dialogRefMock = {
    close: vi.fn(),
  };

  const classesServiceMock = {
    previewSessions: vi.fn(() =>
      of({
        data: [
          {
            sessionDate: '2026-03-16',
            startTime: '18:00:00',
            endTime: '20:00:00',
            teacherId: 'teacher-1',
            teacherName: '張老師',
            weekday: 1,
            exists: false,
          },
        ],
      }),
    ),
    generateSessions: vi.fn(),
  };

  beforeEach(async () => {
    classesServiceMock.previewSessions.mockClear();
    classesServiceMock.generateSessions.mockReset();
    dialogRefMock.close.mockClear();

    await TestBed.configureTestingModule({
      imports: [GenerateSessionsDialogComponent],
      providers: [
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        {
          provide: BrowserStateService,
          useValue: {
            isMobile: () => false,
          },
        },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              cls: {
                id: 'class-1',
                campusId: 'campus-1',
                courseId: 'course-1',
                campusName: '示範分校',
                courseName: '數學課',
                name: '班級 A',
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GenerateSessionsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders responsive table in preview step', () => {
    (
      component as unknown as {
        generateFrom: { set: (value: Date) => void };
        generateTo: { set: (value: Date) => void };
        preview: () => void;
      }
    ).generateFrom.set(new Date('2026-03-16'));
    (
      component as unknown as {
        generateFrom: { set: (value: Date) => void };
        generateTo: { set: (value: Date) => void };
        preview: () => void;
      }
    ).generateTo.set(new Date('2026-03-31'));

    (component as unknown as { preview: () => void }).preview();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-responsive-table')).not.toBeNull();
  });

  it('closes with refresh after generation result when user dismisses the dialog', () => {
    (
      component as unknown as {
        generationResult: { set: (value: unknown) => void };
        cancel: () => void;
      }
    ).generationResult.set({
      createdAssigned: 1,
      createdUnassigned: 0,
      skippedExisting: 0,
      skippedNoTeacher: 0,
      totalPlanned: 1,
    });

    (component as unknown as { cancel: () => void }).cancel();

    expect(dialogRefMock.close).toHaveBeenCalledWith('refresh');
  });
});
