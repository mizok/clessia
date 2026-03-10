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
  let dialogConfigValue: {
    data: {
      session: Session;
      changes: ScheduleChange[];
      loadingChanges: boolean;
    };
  };
  const getChangesSpy = vi.fn(() => of({ data: [] }));

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
    {
      id: 'change-2',
      changeType: 'reschedule',
      originalSessionDate: '2099-03-10',
      originalStartTime: '09:00',
      originalEndTime: '11:00',
      newSessionDate: '2099-03-17',
      newStartTime: '10:00',
      newEndTime: '12:00',
      originalTeacherId: null,
      originalTeacherName: null,
      substituteTeacherId: null,
      substituteTeacherName: null,
      operationSource: 'batch',
      reason: '配合模擬考調整',
      createdByName: '排課系統',
      createdAt: '2026-03-09T08:00:00.000Z',
    },
  ];

  beforeEach(async () => {
    dialogConfigValue = {
      data: {
        session,
        changes,
        loadingChanges: false,
      },
    };
    getChangesSpy.mockReset();
    getChangesSpy.mockReturnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [SessionDetailDialogComponent],
      providers: [
        {
          provide: DynamicDialogConfig,
          useValue: dialogConfigValue,
        },
        {
          provide: DynamicDialogRef,
          useValue: { close: vi.fn() },
        },
        {
          provide: SessionsService,
          useValue: {
            getChanges: getChangesSpy,
          },
        },
        {
          provide: OverlayContainerService,
          useValue: {},
        },
      ],
    }).compileComponents();
  });

  function createComponent(): void {
    fixture = TestBed.createComponent(SessionDetailDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('creates with history changes carrying original teacher and operation source metadata', () => {
    createComponent();
    expect(component).toBeTruthy();
    expect(
      (component as unknown as { sessionChanges: () => ScheduleChange[] }).sessionChanges(),
    ).toEqual(changes);
  });

  it('renders summary heading and timeline cards with substitute, reschedule and batch source details', () => {
    createComponent();

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('課堂摘要');
    expect(text).toContain('異動時間線');
    expect(text).toContain('王老師 → 李老師');
    expect(text).toContain('03/10 09:00 - 11:00 -> 03/17 10:00 - 12:00');
    expect(text).toContain('批次操作');
  });

  it('renders an empty state block when there is no history change', () => {
    dialogConfigValue.data.changes = [];
    createComponent();

    expect(fixture.nativeElement.querySelector('.session-detail__empty')).not.toBeNull();
  });
});
