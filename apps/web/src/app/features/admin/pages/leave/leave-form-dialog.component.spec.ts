import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

import { LeaveFormDialogComponent } from './leave-form-dialog.component';
import { StudentsService } from '@core/students.service';
import { CampusesService } from '@core/campuses.service';
import { LeaveService } from '@core/leave.service';

describe('LeaveFormDialogComponent', () => {
  let fixture: ComponentFixture<LeaveFormDialogComponent>;
  let component: LeaveFormDialogComponent;

  const dialogRefMock = {
    close: vi.fn(),
  };
  const studentsServiceMock = {
    list: vi.fn(() =>
      of({
        data: [],
        summary: { total: 0, activeCount: 0 },
        meta: { total: 0, page: 1, pageSize: 30, totalPages: 0 },
      }),
    ),
  };
  const campusesServiceMock = {
    list: vi.fn(() =>
      of({
        data: [{ id: 'campus-1', name: '示範分校' }],
        meta: { total: 1, page: 1, pageSize: 100, totalPages: 1 },
      }),
    ),
  };
  const leaveServiceMock = {
    create: vi.fn(() =>
      of({
        id: 'leave-1',
        studentName: '出勤測試學生01',
      }),
    ),
  };

  beforeEach(async () => {
    dialogRefMock.close.mockReset();
    leaveServiceMock.create.mockClear();

    await TestBed.configureTestingModule({
      imports: [LeaveFormDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: CampusesService, useValue: campusesServiceMock },
        { provide: LeaveService, useValue: leaveServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LeaveFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('blocks submit when autocomplete model is not a selected student object', () => {
    const dialog = component as any;

    dialog.selectedStudent = '出勤測試學生01';
    dialog.startDate = new Date('2026-04-02');
    dialog.endDate = new Date('2026-04-02');

    dialog.submit();

    expect(leaveServiceMock.create).not.toHaveBeenCalled();
    expect(dialog.errorMessage()).toBe('請從建議清單選擇一位學生');
  });

  it('submits separate start/end dates and times', () => {
    const dialog = component as any;

    dialog.selectedStudent = {
      id: 'student-1',
      name: '出勤測試學生01',
      grade: 'J1',
      school: '測試國中',
    };
    dialog.startDate = new Date('2026-04-02');
    dialog.endDate = new Date('2026-04-03');
    dialog.startTime = new Date('2026-04-02T09:30:00');
    dialog.endTime = new Date('2026-04-03T18:00:00');
    dialog.reason = '家庭事假';

    dialog.submit();

    expect(leaveServiceMock.create).toHaveBeenCalledWith({
      studentId: 'student-1',
      startDate: '2026-04-02',
      endDate: '2026-04-03',
      startTime: '09:30',
      endTime: '18:00',
      reason: '家庭事假',
    });
  });

  it('renders the shared student autocomplete field', () => {
    expect(fixture.nativeElement.querySelector('app-student-autocomplete')).not.toBeNull();
  });

  it('searches students by name only in the leave dialog', () => {
    const dialog = component as any;

    dialog.searchStudents('劉');

    expect(studentsServiceMock.list).toHaveBeenLastCalledWith({
      search: '劉',
      campusId: undefined,
      grade: undefined,
      isActive: true,
      pageSize: 30,
      searchScope: 'student_name',
    });
  });
});
