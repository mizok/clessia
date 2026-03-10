import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { SessionsService } from '@core/sessions.service';
import { StaffService } from '@core/staff.service';
import { CoursesService } from '@core/courses.service';

import { SessionAssignDialogComponent } from './session-assign-dialog.component';

describe('SessionAssignDialogComponent', () => {
  let component: SessionAssignDialogComponent;
  let fixture: ComponentFixture<SessionAssignDialogComponent>;
  const staffListSpy = vi.fn();
  const courseGetSpy = vi.fn();

  beforeEach(async () => {
    staffListSpy.mockReset();
    courseGetSpy.mockReset();
    staffListSpy.mockReturnValue(of({ data: [] }));
    courseGetSpy.mockReturnValue(of({ data: { subjectId: 'subject-math' } }));

    await TestBed.configureTestingModule({
      imports: [SessionAssignDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              session: {
                id: '00000000-0000-0000-0000-000000000001',
                classId: '00000000-0000-0000-0000-000000000002',
                className: '測試班級',
                courseId: 'course-math',
                campusId: 'campus-a',
                sessionDate: '2026-03-08',
                startTime: '09:00',
                endTime: '11:00',
                teacherId: null,
                teacherName: null,
                status: 'scheduled',
                assignmentStatus: 'unassigned',
              },
            },
          },
        },
        {
          provide: DynamicDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: SessionsService,
          useValue: {
            batchAssignTeacher: vi.fn(() =>
              of({ updated: 1, skippedConflicts: 0, skippedNotEligible: 0, conflicts: [], dryRun: false }),
            ),
          },
        },
        {
          provide: StaffService,
          useValue: {
            list: staffListSpy,
          },
        },
        {
          provide: CoursesService,
          useValue: {
            get: courseGetSpy,
          },
        },
        {
          provide: MessageService,
          useValue: { add: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionAssignDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load teachers with campus and course subject filter when dialog has no preloaded teachers', async () => {
    await fixture.whenStable();
    expect(staffListSpy).toHaveBeenCalledWith({ role: 'teacher', campusId: 'campus-a' });
    expect(courseGetSpy).toHaveBeenCalledWith('course-math');
  });

  it('should skip loading teachers when preloaded teachers are provided', async () => {
    staffListSpy.mockClear();
    courseGetSpy.mockClear();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [SessionAssignDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              session: {
                id: '00000000-0000-0000-0000-000000000001',
                classId: '00000000-0000-0000-0000-000000000002',
                className: '測試班級',
                courseId: 'course-math',
                campusId: 'campus-a',
                sessionDate: '2026-03-08',
                startTime: '09:00',
                endTime: '11:00',
                teacherId: null,
                teacherName: null,
                status: 'scheduled',
                assignmentStatus: 'unassigned',
              },
              teachers: [
                {
                  id: 'teacher-1',
                  displayName: '王老師',
                  campusIds: ['campus-a'],
                  subjectIds: ['subject-math'],
                  roles: ['teacher'],
                  isActive: true,
                },
              ],
            },
          },
        },
        {
          provide: DynamicDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: SessionsService,
          useValue: {
            batchAssignTeacher: vi.fn(() =>
              of({
                updated: 1,
                skippedConflicts: 0,
                skippedNotEligible: 0,
                conflicts: [],
                dryRun: false,
              }),
            ),
          },
        },
        {
          provide: StaffService,
          useValue: {
            list: staffListSpy,
          },
        },
        {
          provide: CoursesService,
          useValue: {
            get: courseGetSpy,
          },
        },
        {
          provide: MessageService,
          useValue: { add: vi.fn() },
        },
      ],
    }).compileComponents();

    const secondFixture = TestBed.createComponent(SessionAssignDialogComponent);
    await secondFixture.whenStable();

    expect(staffListSpy).not.toHaveBeenCalled();
    expect(courseGetSpy).not.toHaveBeenCalled();
  });
});
