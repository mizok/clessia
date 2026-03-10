import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { vi } from 'vitest';

import { ClassFormDialogComponent } from './class-form-dialog.component';
import { ClassesService } from '@core/classes.service';

describe('ClassFormDialogComponent', () => {
  let fixture: ComponentFixture<ClassFormDialogComponent>;
  let component: ClassFormDialogComponent;
  let classesServiceMock: Partial<ClassesService>;
  let messageServiceMock: Pick<MessageService, 'add'>;
  const dialogRefMock = { close: vi.fn() };

  beforeEach(async () => {
    classesServiceMock = {
      checkScheduleConflicts: vi.fn().mockReturnValue(of({ conflicts: [] })),
      create: vi.fn().mockReturnValue(of({ data: { id: 'class-1' } as any })),
      update: vi.fn().mockReturnValue(of({ data: { id: 'class-1' } as any })),
      deleteSchedule: vi.fn().mockReturnValue(of({ success: true })),
      addSchedule: vi.fn().mockReturnValue(
        of({
          data: {
            id: 'sch-1',
            classId: 'class-1',
            weekday: 1,
            startTime: '09:00:00',
            endTime: '11:00:00',
            teacherId: null,
            effectiveTo: null,
          },
        }),
      ),
    };

    messageServiceMock = {
      add: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ClassFormDialogComponent],
      providers: [
        { provide: ClassesService, useValue: classesServiceMock },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              cls: null,
              course: {
                id: 'course-1',
                campusId: 'campus-1',
                subjectId: 'subject-1',
                name: '測試課程',
              },
              staff: [],
              campuses: [],
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should block save when schedule entries overlap in same weekday', () => {
    (component as any).formData.set({
      name: '測試班級',
      maxStudents: 20,
      nextClassId: null,
      isActive: true,
    });
    (component as any).scheduleEntries.set([
      { weekday: 1, startTime: '09:00', endTime: '11:00', teacherId: null, effectiveTo: null },
      { weekday: 1, startTime: '10:00', endTime: '12:00', teacherId: null, effectiveTo: null },
    ]);

    (component as any).save();

    expect((classesServiceMock.create as any)).not.toHaveBeenCalled();
    expect((component as any).formValidationMessage()).toContain('時段重疊');
  });

  it('should not close dialog when add schedule API fails', async () => {
    (classesServiceMock.addSchedule as any).mockReturnValueOnce(
      throwError(() => ({ error: { error: '時段重疊' } })),
    );

    (component as any).formData.set({
      name: '測試班級',
      maxStudents: 20,
      nextClassId: null,
      isActive: true,
    });
    (component as any).scheduleEntries.set([
      { weekday: 1, startTime: '09:00', endTime: '11:00', teacherId: null, effectiveTo: null },
    ]);

    (component as any).save();
    await fixture.whenStable();

    expect(dialogRefMock.close).not.toHaveBeenCalled();
    expect(messageServiceMock.add).toHaveBeenCalled();
  });
});
