import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { LeaveFormDialogComponent } from './leave-form-dialog.component';
import { StudentsService } from '@core/students.service';
import { LeaveService } from '@core/leave.service';
import { ReferenceDataService } from '@core/reference-data.service';
import type { Campus } from '@core/campuses.service';

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
  const referenceDataServiceMock = {
    campuses: signal<Campus[]>([
      {
        id: 'campus-1',
        orgId: 'org-1',
        name: '示範分校',
        address: null,
        phone: null,
        isActive: true,
        paymentInfo: null,
        createdAt: '2026-04-09T00:00:00.000Z',
        updatedAt: '2026-04-09T00:00:00.000Z',
      },
    ]),
    loadCampuses: vi.fn(),
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
    referenceDataServiceMock.loadCampuses.mockClear();

    await TestBed.configureTestingModule({
      imports: [LeaveFormDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: dialogRefMock },
        { provide: StudentsService, useValue: studentsServiceMock },
        { provide: ReferenceDataService, useValue: referenceDataServiceMock },
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

// #1005：同一個表單的編輯模式（`data.leave` 有值）
describe('LeaveFormDialogComponent 編輯模式', () => {
  const close = vi.fn();
  const leaveServiceMock = {
    create: vi.fn(),
    update: vi.fn(() => of({ id: 'leave-1', studentName: '劉靖雯' })),
  };
  const leave = {
    id: 'leave-1',
    studentId: 'student-1',
    studentName: '劉靖雯',
    startDate: '2026-04-02',
    endDate: '2026-04-03',
    startTime: '09:30:00',
    endTime: null,
    reason: '感冒',
  };

  let fixture: ComponentFixture<LeaveFormDialogComponent>;
  let dialog: any;

  beforeEach(async () => {
    close.mockReset();
    leaveServiceMock.create.mockReset();
    leaveServiceMock.update.mockClear();
    await TestBed.configureTestingModule({
      imports: [LeaveFormDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { leave } } },
        { provide: StudentsService, useValue: { list: vi.fn() } },
        {
          provide: ReferenceDataService,
          useValue: { campuses: signal<Campus[]>([]), loadCampuses: vi.fn() },
        },
        { provide: LeaveService, useValue: leaveServiceMock },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LeaveFormDialogComponent);
    dialog = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('學生唯讀、不顯示搜尋框；表單帶入原值', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-student-autocomplete')).toBeNull();
    expect(el.textContent).toContain('劉靖雯');
    expect(dialog.reason).toBe('感冒');
    expect(dialog.startTime.getHours()).toBe(9);
    expect(dialog.endTime).toBeNull();
  });

  it('儲存 → 呼叫 update（不是 create），帶新日期與原因，並以結果關閉', () => {
    dialog.endDate = new Date(2026, 3, 5);
    dialog.reason = '改成事假';

    dialog.submit();

    expect(leaveServiceMock.create).not.toHaveBeenCalled();
    expect(leaveServiceMock.update).toHaveBeenCalledWith('leave-1', {
      startDate: '2026-04-02',
      endDate: '2026-04-05',
      startTime: '09:30',
      endTime: null,
      reason: '改成事假',
    });
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ id: 'leave-1' }));
  });

  it('409 重疊時把後端訊息顯示在表單裡，不關閉', () => {
    leaveServiceMock.update.mockReturnValueOnce(
      throwError(() => ({ error: { message: '該學生在 2026-04-04 ~ 2026-04-06 已有請假紀錄' } })),
    );

    dialog.submit();

    expect(dialog.errorMessage()).toContain('已有請假紀錄');
    expect(close).not.toHaveBeenCalled();
  });
});
