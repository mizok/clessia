import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { AttendanceRosterPanelComponent } from './attendance-roster-panel.component';
import { AttendanceService } from '@core/attendance.service';

describe('AttendanceRosterPanelComponent', () => {
  let fixture: ComponentFixture<AttendanceRosterPanelComponent>;
  let component: AttendanceRosterPanelComponent;

  const attendanceServiceMock = {
    roster: vi.fn(() =>
      of({
        eventId: 'event-1',
        takenAt: '2026-04-02T09:00:00Z',
        students: [
          {
            studentId: 'student-present',
            studentName: '王小明',
            grade: 'J1',
            school: '測試國中',
            recordId: 'record-1',
            status: 'present' as const,
          },
          {
            studentId: 'student-leave',
            studentName: '李小華',
            grade: 'J1',
            school: '測試國中',
            recordId: 'record-2',
            status: 'on_leave' as const,
          },
        ],
      }),
    ),
    batchUpdate: vi.fn(() =>
      of({
        updated: 1,
        takenAt: '2026-04-02T09:00:00Z',
      }),
    ),
  };

  const dialogRefMock = {
    close: vi.fn(),
  };

  beforeEach(async () => {
    attendanceServiceMock.roster.mockClear();
    attendanceServiceMock.batchUpdate.mockClear();
    dialogRefMock.close.mockClear();

    await TestBed.configureTestingModule({
      imports: [AttendanceRosterPanelComponent],
      providers: [
        { provide: AttendanceService, useValue: attendanceServiceMock },
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              eventId: 'event-1',
              className: '數學班 A',
              eventDate: '2026/04/02',
            },
          },
        },
        { provide: DynamicDialogRef, useValue: dialogRefMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AttendanceRosterPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('在修改點名時仍顯示請假學生，且不提供切換按鈕', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(attendanceServiceMock.roster).toHaveBeenCalledWith('event-1');
    expect(text).toContain('李小華');
    expect(text).toContain('請假中');
    expect(text).toContain('王小明');

    const leaveRow = fixture.nativeElement.querySelector('.roster-panel__row--on-leave');
    expect(leaveRow?.textContent).toContain('李小華');
    expect(leaveRow?.querySelector('.roster-panel__toggle')).toBeNull();
  });

  it('儲存時不會把請假學生送進 batch update', () => {
    (component as any).save();

    expect(attendanceServiceMock.batchUpdate).toHaveBeenCalledWith({
      eventId: 'event-1',
      updates: [{ studentId: 'student-present', status: 'present' }],
    });
    expect(dialogRefMock.close).toHaveBeenCalledWith({
      eventId: 'event-1',
      takenAt: '2026-04-02T09:00:00Z',
      presentCount: 1,
      absentCount: 0,
      onLeaveCount: 1,
    });
  });
});
