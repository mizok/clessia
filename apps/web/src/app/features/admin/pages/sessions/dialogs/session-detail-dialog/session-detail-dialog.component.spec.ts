import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';
import {
  SessionsService,
  type ScheduleChange,
  type Session,
} from '@core/sessions.service';
import { OverlayContainerService } from '@core/overlay-container.service';

import { SessionDetailDialogComponent } from './session-detail-dialog.component';

describe('SessionDetailDialogComponent', () => {
  let fixture: ComponentFixture<SessionDetailDialogComponent>;
  let component: SessionDetailDialogComponent;

  const session: Session = {
    id: 'session-1',
    classId: 'class-1',
    className: '國文 A',
    courseId: 'course-1',
    courseName: '國文班',
    campusId: 'campus-1',
    campusName: '示範分校',
    sessionDate: '2099-03-10',
    startTime: '09:00',
    endTime: '11:00',
    teacherId: 'teacher-2',
    teacherName: '李老師',
    status: 'scheduled',
    assignmentStatus: 'assigned',
    hasChanges: true,
  };

  const changes: ScheduleChange[] = [
    {
      id: 'change-1',
      changeType: 'substitute',
      originalSessionDate: null,
      originalStartTime: null,
      originalEndTime: null,
      newSessionDate: null,
      newStartTime: null,
      newEndTime: null,
      originalTeacherId: 'teacher-1',
      originalTeacherName: '王老師',
      substituteTeacherId: 'teacher-2',
      substituteTeacherName: '李老師',
      operationSource: 'single',
      reason: '老師請假',
      createdByName: '教務主任',
      createdAt: '2026-03-10T08:00:00.000Z',
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionDetailDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              session,
              changes,
              loadingChanges: false,
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
            getChanges: vi.fn(() => of({ data: [] })),
          },
        },
        {
          provide: OverlayContainerService,
          useValue: {},
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionDetailDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates with history changes carrying original teacher and operation source metadata', () => {
    expect(component).toBeTruthy();
    expect(component.sessionChanges()).toEqual(changes);
  });
});
