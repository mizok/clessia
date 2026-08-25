import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { SessionsService } from '@core/sessions.service';
import { SessionRescheduleDialogComponent } from './session-reschedule-dialog.component';

describe('SessionRescheduleDialogComponent', () => {
  let fixture: ComponentFixture<SessionRescheduleDialogComponent>;
  let component: SessionRescheduleDialogComponent;
  const sessionsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [
          {
            id: 'session-campus',
            classId: 'class-2',
            className: '英文 A',
            courseId: 'course-2',
            courseName: '英文 八年級重點進階班',
            campusId: 'campus-1',
            campusName: '示範分校01',
            sessionDate: '2026-03-23',
            startTime: '09:00',
            endTime: '11:00',
            teacherId: 'teacher-2',
            teacherName: '李語涵',
            status: 'scheduled',
            assignmentStatus: 'assigned',
            hasChanges: false,
          },
          {
            id: 'session-teacher',
            classId: 'class-3',
            className: '數學 B',
            courseId: 'course-3',
            courseName: '數學 九年級會考總複習班',
            campusId: 'campus-2',
            campusName: '示範分校02',
            sessionDate: '2026-03-23',
            startTime: '13:00',
            endTime: '15:00',
            teacherId: 'teacher-1',
            teacherName: '王宥廷',
            status: 'scheduled',
            assignmentStatus: 'assigned',
            hasChanges: false,
          },
        ],
      }),
    ),
    reschedule: vi.fn(),
  };

  beforeEach(async () => {
    sessionsServiceMock.list.mockClear();

    await TestBed.configureTestingModule({
      imports: [SessionRescheduleDialogComponent],
      providers: [
        { provide: SessionsService, useValue: sessionsServiceMock },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              session: {
                id: 'session-1',
                classId: 'class-1',
                className: '國文 A',
                courseId: 'course-1',
                courseName: '國文 七年級基礎先修班',
                campusId: 'campus-1',
                campusName: '示範分校01',
                sessionDate: '2026-03-16',
                startTime: '09:00',
                endTime: '11:00',
                teacherId: 'teacher-1',
                teacherName: '王宥廷',
                status: 'scheduled',
                assignmentStatus: 'assigned',
                hasChanges: false,
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionRescheduleDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('splits same-day sessions into campus and teacher context lists', () => {
    (
      component as unknown as {
        form: { get: (name: string) => { setValue: (value: Date) => void } | null };
      }
    ).form
      .get('newSessionDate')
      ?.setValue(new Date('2026-03-23'));

    const campusSessions = (
      component as unknown as {
        targetCampusSessions: () => Array<{ className: string }>;
      }
    ).targetCampusSessions();
    const teacherSessions = (
      component as unknown as {
        targetTeacherSessions: () => Array<{ className: string }>;
      }
    ).targetTeacherSessions();

    expect(sessionsServiceMock.list).toHaveBeenCalledWith({
      from: '2026-03-23',
      to: '2026-03-23',
    });
    expect(campusSessions.map((session) => session.className)).toEqual(['英文 A']);
    expect(teacherSessions.map((session) => session.className)).toEqual(['數學 B']);
  });
});
